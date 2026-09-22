import { byokSummary, parseByok, type ByokConfig } from "@/lib/byok";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getStore } from "@/lib/db";
import type { UserRecord } from "@/lib/db/types";

export function readByok(user: UserRecord | null): ByokConfig | null {
  if (!user?.byokEncrypted) return null;
  const plaintext = decryptSecret(user.byokEncrypted);
  if (!plaintext) return null;
  try {
    return parseByok(JSON.parse(plaintext));
  } catch {
    return null;
  }
}

export async function writeByok(userId: string, patch: Partial<ByokConfig>): Promise<ByokConfig> {
  const store = getStore();
  const user = await store.getUser(userId);
  const current = readByok(user) ?? {};
  const next: ByokConfig = {
    judge: patch.judge ?? current.judge,
    llm: patch.llm ?? current.llm,
  };
  await store.setUserByok(userId, encryptSecret(JSON.stringify(next)));
  return next;
}

export async function clearByok(userId: string): Promise<void> {
  await getStore().setUserByok(userId, null);
}

export function summarizeByok(value: ByokConfig | null) {
  return byokSummary(value);
}
