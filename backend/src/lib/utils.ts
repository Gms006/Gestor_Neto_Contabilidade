// src/lib/utils.ts

export type ProcessStatus = 'CONCLUIDO' | 'EM_ANDAMENTO' | 'OUTRO';

/**
 * Mapeia o status bruto do processo e o progresso para um status padronizado.
 * @param statusRaw Status bruto vindo da API (ex: "Concluído", "Em andamento").
 * @param progress Progresso em porcentagem (0 a 100).
 * @returns Status padronizado ('CONCLUIDO', 'EM_ANDAMENTO', 'OUTRO').
 */
export function mapProcessStatus(statusRaw: string | null | undefined, progress: number | null | undefined): ProcessStatus {
  const raw = (statusRaw || '').toLowerCase();
  const prog = progress ?? 0;

  // Regra 1: Se o status bruto indica conclusão ou progresso >= 100
  if (raw.includes('concluído') || raw.includes('finalizado') || prog >= 100) {
    return 'CONCLUIDO';
  }

  // Regra 2: Se o status bruto indica andamento ou progresso > 0 e < 100
  if (raw.includes('em andamento') || (prog > 0 && prog < 100)) {
    return 'EM_ANDAMENTO';
  }

  // Regra 3: Caso contrário
  return 'OUTRO';
}
