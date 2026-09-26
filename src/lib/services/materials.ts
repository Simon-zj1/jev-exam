import { createHash } from "node:crypto";
import { MAX_MATERIAL_CHARS } from "@/lib/config";
import { getStore } from "@/lib/db";
import type { MaterialRecord, UserRecord } from "@/lib/db/types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import type { SourceMap } from "@/lib/ingest/types";
import { assertQuota, recordUsage } from "@/lib/quota";
import { estimateTokens } from "@/lib/text";

export type CreateMaterialInput = {
  title: string;
  rawText: string;
  /** 由上传解析得到的页面映射；粘贴文本时为 null */
  sourceMap?: SourceMap | null;
};

export async function createMaterialForUser(
  user: UserRecord,
  input: CreateMaterialInput,
): Promise<MaterialRecord> {
  const title = input.title.trim();
  const rawText = input.rawText.trim();
  // 页面映射的偏移是相对解析结果算的；这里 trim 掉了开头空白就要同步平移，
  // 否则「第 3 页」会指向错误的区间（错位不会报错，只会安静地指错）。
  const sourceMap = shiftSourceMap(input.sourceMap ?? null, input.rawText.length - input.rawText.trimStart().length);

  if (!title) throw new ValidationError("请填写材料标题");
  if (rawText.length < 80) throw new ValidationError("材料内容太短，至少需要 80 个字符");
  if (rawText.length > MAX_MATERIAL_CHARS) {
    throw new ValidationError(`材料过长，单次最多 ${MAX_MATERIAL_CHARS} 个字符`);
  }

  await assertQuota(user.id, { material: 1 });

  const material = await getStore().createMaterial({
    userId: user.id,
    title,
    rawText,
    tokenCount: estimateTokens(rawText),
    contentHash: createHash("sha256").update(rawText).digest("hex").slice(0, 32),
    sourceMap,
  });

  await recordUsage(user.id, { material: 1 });
  return material;
}

function shiftSourceMap(sourceMap: SourceMap | null, removedLeading: number): SourceMap | null {
  if (!sourceMap || removedLeading === 0 || !sourceMap.pages) return sourceMap;
  return {
    ...sourceMap,
    pages: sourceMap.pages.map((page) => ({
      ...page,
      charStart: Math.max(0, page.charStart - removedLeading),
      charEnd: Math.max(0, page.charEnd - removedLeading),
    })),
  };
}

export async function listMaterialsForUser(user: UserRecord): Promise<MaterialRecord[]> {
  return getStore().listMaterials(user.id);
}

export async function getMaterialForUser(
  user: UserRecord,
  materialId: string,
): Promise<MaterialRecord> {
  const material = await getStore().getMaterial(materialId);
  if (!material) throw new NotFoundError("材料不存在");
  if (material.userId !== user.id) throw new ForbiddenError();
  return material;
}

export async function deleteMaterialForUser(user: UserRecord, materialId: string): Promise<void> {
  await getMaterialForUser(user, materialId);
  await getStore().deleteMaterial(materialId, user.id);
}
