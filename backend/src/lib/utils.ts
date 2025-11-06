// src/lib/utils.ts

export type ProcessStatus = 'CONCLUIDO' | 'EM_ANDAMENTO' | 'OUTRO';

/**
 * Mapeia o status bruto do processo e o progresso para um status padronizado.
 * @param statusRaw Status bruto vindo da API (ex: "Concluído", "Em andamento").
 * @param progress Progresso em porcentagem (0 a 100).
 * @returns Status padronizado ('CONCLUIDO', 'EM_ANDAMENTO', 'OUTRO').
 */
function normalize(input?: string | null): string {
  if (!input) return "";
  return input
    .normalize("NFD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, "")
    .toLowerCase()
    .trim();
}

const CONCLUDED_KEYWORDS = [
  "concluido",
  "concluida",
  "finalizado",
  "finalizada",
  "finalizadas",
  "finalizados",
  "encerrado",
  "encerrada",
  "final",
  "entregue",
  "completo",
  "completa",
];

const IN_PROGRESS_KEYWORDS = [
  "em andamento",
  "andamento",
  "pendente",
  "pendencia",
  "aguardando",
  "aguardo",
  "em execucao",
  "execucao",
  "processando",
  "em analise",
  "analise",
  "aberto",
  "aberta",
  "abertos",
  "abertas",
  "em aberto",
];

export function mapProcessStatus(
  statusRaw: string | null | undefined,
  progress: number | null | undefined
): ProcessStatus {
  const normalized = normalize(statusRaw);
  const prog = progress ?? 0;

  if (prog >= 100 || CONCLUDED_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "CONCLUIDO";
  }

  if (IN_PROGRESS_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "EM_ANDAMENTO";
  }

  if (prog > 0 && prog < 100) {
    return "EM_ANDAMENTO";
  }

  return "OUTRO";
}
