export function mapProcessStatus(raw?: string | null, progress?: number | null): "EM_ANDAMENTO" | "CONCLUIDO" | "OUTRO" {
  const r = (raw ?? "").trim().toUpperCase();
  if (r === "C" || progress === 100) return "CONCLUIDO";
  if (r === "A" || (progress ?? 0) < 100) return "EM_ANDAMENTO";
  return "OUTRO";
}
