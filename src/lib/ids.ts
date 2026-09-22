import { randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** 每日额度用的自然日（Asia/Shanghai），保证配额在本地零点重置。 */
export function dayKey(date: Date = new Date(), timeZone = "Asia/Shanghai"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function topicKeyOf(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[、。，；：？！“”‘’（）《》〈〉【】—…·～「」『』"'.!?,;:()<>[\]{}]/g, "")
    .slice(0, 60);
}
