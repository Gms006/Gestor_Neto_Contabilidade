export function mapProcessStatus(raw?: string | null, progress?: number | null): "EM_ANDAMENTO" | "CONCLUIDO" | "OUTRO" {
  const r = (raw ?? "").trim().toUpperCase();
  if (r === "C" || progress === 100) return "CONCLUIDO";
  if (r === "A" || (progress ?? 0) < 100) return "EM_ANDAMENTO";
  return "OUTRO";
}

export function formatISO(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString();
}
