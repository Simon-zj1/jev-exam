import { createHash } from "node:crypto";
import { MAX_MATERIAL_CHARS } from "@/lib/config";
import { getStore } from "@/lib/db";
import type { MaterialRecord, UserRecord } from "@/lib/db/types";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertQuota, recordUsage } from "@/lib/quota";
import { estimateTokens } from "@/lib/text";

export type CreateMaterialInput = {
  title: string;
  rawText: string;
};

export async function createMaterialForUser(
  user: UserRecord,
  input: CreateMaterialInput,
): Promise<MaterialRecord> {
  const title = input.title.trim();
  const rawText = input.rawText.trim();

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
  });

  await recordUsage(user.id, { material: 1 });
  return material;
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
