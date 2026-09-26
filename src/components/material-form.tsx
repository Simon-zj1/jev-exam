"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/config";

const SAMPLE = `检索是 RAG 的第一阶段，决定模型能看到什么证据。
向量检索：把文本编码成向量，用相似度做语义召回。
关键词检索：用 BM25 之类的算法补足专有名词与精确匹配。
重排：用 Rerank 模型对召回结果重新打分，提升 Top-K 精度。
分块：块太大引入噪声，太小割裂语义，通常按语义边界切分并保留重叠。
Agent：由模型驱动、可以调用工具并根据结果继续行动的循环系统。
ReAct：把推理与行动交替进行，观察工具结果后再决定下一步。
工具调用：把外部能力以函数签名暴露给模型，模型输出结构化参数，由代码执行并回传。
记忆：短期记忆放在对话上下文，长期记忆落到向量库，按相关性检索后再注入。
规划：把复杂目标拆成子任务，配合执行后的反思，而不是一次性长篇推理。
评测：离线用标注集，线上看人工反馈与失败案例回流，没有评测就没有迭代依据。
幻觉：模型生成与事实不符的内容，可用检索约束、工具校验和置信度门控缓解。
微调与 RAG：RAG 改知识，微调改行为与格式，二者解决的不是同一个问题。
上下文工程：控制进入模型的信息量与顺序，稳定规则在前，易变内容在后。`;

export function MaterialForm() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [sourceMap, setSourceMap] = useState<unknown>(null);
  const [extractInfo, setExtractInfo] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** 上传解析只填表单，不落库：用户可以先改标题、删掉解析错的段落再保存。 */
  async function extractFile(file: File): Promise<void> {
    // 先在本地拦一次，省掉一次必然失败的往返（服务端仍会再校验）
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`文件 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 ${MAX_UPLOAD_LABEL} 上限。`);
      return;
    }
    setParsing(true);
    setError(null);
    setExtractInfo(null);
    setWarnings([]);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/materials/extract", { method: "POST", body: form });
      const payload = (await response.json()) as {
        extraction?: {
          title: string;
          text: string;
          kind: string;
          pageCount: number | null;
          warnings: string[];
          charCount: number;
          fileName: string;
        };
        sourceMap?: unknown;
        error?: string;
      };
      if (!response.ok || !payload.extraction) {
        setError(payload.error ?? "解析失败");
        return;
      }
      const { extraction } = payload;
      setTitle((current) => current.trim() || extraction.title);
      setRawText(extraction.text);
      setSourceMap(payload.sourceMap ?? null);
      setWarnings(extraction.warnings);
      setExtractInfo(
        `已解析 ${extraction.fileName}：${extraction.charCount} 字符${
          extraction.pageCount ? ` · ${extraction.pageCount} 页` : ""
        }。请检查下方正文，确认无误后再保存。`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setParsing(false);
    }
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const response = await fetch("/api/materials", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, rawText, sourceMap }),
          });
          const payload = (await response.json()) as { material?: { id: string }; error?: string };
          if (!response.ok || !payload.material) {
            setError(payload.error ?? "上传失败");
            return;
          }
          router.push(`/materials/${payload.material.id}`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setPending(false);
        }
      }}
    >
      <div
        className={`dropzone${dragging ? " dropzone--active" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void extractFile(file);
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void extractFile(file);
            event.target.value = "";
          }}
        />
        <div>
          <strong>上传文件解析</strong>
          <div className="small muted">
            支持 PDF、Word（.docx）、纯文本（.txt / .md），单个文件不超过 {MAX_UPLOAD_LABEL}。
            扫描件与图片型 PDF 提取不到文字，会明确提示。
          </div>
        </div>
        <button type="button" disabled={parsing} onClick={() => fileInput.current?.click()}>
          {parsing ? "解析中…" : "选择文件"}
        </button>
      </div>

      {extractInfo ? <div className="banner banner--info">{extractInfo}</div> : null}
      {warnings.map((warning) => (
        <div className="banner banner--warn small" key={warning}>
          {warning}
        </div>
      ))}

      <div className="field">
        <label htmlFor="title">材料标题</label>
        <input
          id="title"
          type="text"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：生物必修一 · 光合作用"
        />
      </div>
      <div className="field">
        <label htmlFor="rawText">粘贴学习材料（纯文本 / Markdown，至少 80 字）</label>
        <textarea
          id="rawText"
          required
          value={rawText}
          onChange={(event) => {
            setRawText(event.target.value);
            // 手工改过正文后页码映射就不再可靠，宁可丢掉页码也不能给出错误的页
            if (sourceMap) {
              setSourceMap(null);
              setExtractInfo("正文已手动修改，页码定位已重置（出处仍可定位到原文句子）。");
            }
          }}
          placeholder="把要考的原文粘进来，出题与评分点都会严格基于这段材料。"
        />
        <div className="row row--between small muted" style={{ marginTop: 6 }}>
          <span>{rawText.length} 字符</span>
          <button
            type="button"
            onClick={() => {
              setRawText(SAMPLE);
              // 手写内容没有页面映射，清掉避免沿用上一次上传的页码
              setSourceMap(null);
              setExtractInfo(null);
              setWarnings([]);
            }}
          >
            填入示例材料
          </button>
        </div>
      </div>
      {error ? <div className="banner banner--err">{error}</div> : null}
      <button className="btn-primary" type="submit" disabled={pending}>
        {pending ? "保存中…" : "保存材料"}
      </button>
    </form>
  );
}
