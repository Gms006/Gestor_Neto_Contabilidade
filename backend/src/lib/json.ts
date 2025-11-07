export function safeStringify(obj: unknown): string | null {
  try {
    return obj == null ? null : JSON.stringify(obj);
  } catch {
    return null;
  }
}

export function safeParse<T = any>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
