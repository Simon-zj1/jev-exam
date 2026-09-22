import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import { MemoryStore } from "@/lib/db/memory";
import { PostgresStore, type AnyPgDatabase } from "@/lib/db/postgres";
import * as schema from "@/lib/db/schema";
import type { Store } from "@/lib/db/types";

let cachedStore: Store | null = null;
let bootstrapDone = false;

export type StoreDriver = "postgres" | "memory";

export function storeDriver(): StoreDriver {
  return env("DATABASE_URL") ? "postgres" : "memory";
}

export function getStore(): Store {
  if (cachedStore) return cachedStore;

  const url = env("DATABASE_URL");
  if (!url) {
    cachedStore = new MemoryStore();
    return cachedStore;
  }

  const client = postgres(url, { max: 5, idle_timeout: 20 });
  const db = drizzle(client, { schema });
  cachedStore = new PostgresStore(db as unknown as AnyPgDatabase);
  return cachedStore;
}

/** 测试注入用：传 null 恢复默认。 */
export function setStoreForTests(store: Store | null): void {
  cachedStore = store;
  bootstrapDone = false;
}

/**
 * 初始化邀请码：INITIAL_INVITE_CODES=CODE1,CODE2（每个默认可用 3 次）。
 * 每次进程启动只执行一次。
 */
export async function bootstrapStore(store: Store = getStore()): Promise<void> {
  if (bootstrapDone) return;
  bootstrapDone = true;
  const codes = env("INITIAL_INVITE_CODES");
  if (!codes) return;
  for (const raw of codes.split(",")) {
    const code = raw.trim();
    if (!code) continue;
    await store.upsertInviteCode(code, 3, null);
  }
}
