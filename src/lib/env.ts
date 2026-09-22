/** 读取环境变量：空字符串视为未设置。 */
export function env(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function envOr(name: string, fallback: string): string {
  return env(name) ?? fallback;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`缺少必需的环境变量 ${name}`);
  }
  return value;
}

export function booleanEnv(name: string, fallback = false): boolean {
  const value = env(name);
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
