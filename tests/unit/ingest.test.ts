import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { detectFileKind, extractMaterialFromFile, pageAt, titleFromFileName } from "@/lib/ingest";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))));

describe("上传文件识别", () => {
  it("按内容而不是扩展名判断类型", () => {
    expect(detectFileKind(fixture("sample.pdf"), "随便叫什么.bin").kind).toBe("pdf");
    expect(detectFileKind(fixture("sample.docx"), "笔记.docx").kind).toBe("docx");
    // PK 开头但不是 docx：不能当成 Word 硬解
    expect(detectFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "archive.zip").supported).toBe(false);
    // 旧版 .doc 是 OLE 复合文档，明确拒绝而不是报一个看不懂的错
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(detectFileKind(ole, "旧笔记.doc")).toEqual({
      kind: "doc",
      label: "旧版 Word（.doc）",
      supported: false,
    });
  });

  it("纯文本按扩展名或可读内容识别", () => {
    const text = new TextEncoder().encode("光合作用分为光反应和暗反应两个阶段。");
    expect(detectFileKind(text, "笔记.md").kind).toBe("text");
    expect(detectFileKind(text, "无扩展名").kind).toBe("text");
    // 含 NUL 字节判定为二进制
    expect(detectFileKind(new Uint8Array([0x41, 0x00, 0x42]), "x.dat").supported).toBe(false);
  });

  it("标题取文件名去掉扩展名", () => {
    expect(titleFromFileName("生物必修一.pdf")).toBe("生物必修一");
    expect(titleFromFileName("/tmp/agent 面试.docx")).toBe("agent 面试");
    expect(titleFromFileName(".gitignore")).toBe("未命名材料");
  });
});

describe("PDF 解析", () => {
  it("逐页提取文字并记录页码区间", async () => {
    const { result, sourceMap } = await extractMaterialFromFile({
      buffer: fixture("sample.pdf"),
      fileName: "RAG 笔记.pdf",
    });

    expect(result.kind).toBe("pdf");
    expect(result.title).toBe("RAG 笔记");
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain("Retrieval is the first stage of RAG.");
    expect(result.text).toContain("Reranking rescores the recalled passages.");
    // 换行被还原：句子之间不能粘成一整行
    expect(result.text.split("\n").length).toBeGreaterThanOrEqual(6);

    const secondPageStart = result.text.indexOf("Reranking");
    expect(secondPageStart).toBeGreaterThan(0);
    expect(pageAt(sourceMap, result.text.indexOf("Retrieval"))).toBe(1);
    expect(pageAt(sourceMap, secondPageStart)).toBe(2);
  });

  it("解析结果太短时给出面向用户的错误", async () => {
    const pdf = fixture("sample.pdf");
    await expect(
      extractMaterialFromFile({ buffer: pdf.slice(0, 200), fileName: "broken.pdf" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Word 解析", () => {
  it("提取 .docx 正文，并如实说明没有页码", async () => {
    const { result, sourceMap } = await extractMaterialFromFile({
      buffer: fixture("sample.docx"),
      fileName: "Agent 笔记.docx",
    });

    expect(result.kind).toBe("docx");
    expect(result.text).toContain("Agent 循环由观察、思考、行动三步组成。");
    expect(result.text).toContain("工具调用让模型输出结构化意图");
    expect(result.pageCount).toBeNull();
    expect(result.pages).toBeNull();
    expect(result.warnings.join()).toContain("页码");
    expect(sourceMap.pages).toBeNull();
  });
});

describe("上传边界", () => {
  it("空文件与不支持的类型都会被拒绝", async () => {
    await expect(
      extractMaterialFromFile({ buffer: new Uint8Array(), fileName: "empty.pdf" }),
    ).rejects.toThrow("文件是空的");

    await expect(
      extractMaterialFromFile({
        buffer: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        fileName: "old.doc",
      }),
    ).rejects.toThrow("另存为 .docx");
  });

  it("超长纯文本被截断到材料上限", async () => {
    const long = new TextEncoder().encode("光".repeat(130_000));
    const { result } = await extractMaterialFromFile({ buffer: long, fileName: "long.txt" });
    expect(result.text.length).toBe(120_000);
  });
});
