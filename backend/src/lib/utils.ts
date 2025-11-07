export function mapProcessStatus(statusRaw?: string, progress?: number): "CONCLUIDO"|"EM_ANDAMENTO"|"OUTRO" {
  const s = (statusRaw ?? "").toLowerCase();
  if (s.includes("conclu") || progress === 100) return "CONCLUIDO";
  if (s.includes("andamento") || (typeof progress === "number" && progress < 100)) return "EM_ANDAMENTO";
  return "OUTRO";
}
