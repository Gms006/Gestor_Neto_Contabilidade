// src/services/syncService.ts
import { logger } from "../lib/logger";
import {
  listCompanies,
  listProcesses,
  listDeliveries,
} from "../clients/acessoriasClient";
import {
  upsertEmpresasBatch, // Atualizado para PT
  upsertProcessosBatch, // Atualizado para PT
  upsertEntregasBatch, // Atualizado para PT
 // Novo
  getSyncState,
  setSyncState,
} from "../repositories/acessoriasRepo";
import { subSeconds } from "date-fns"; // Para janela de segurança

type SyncOptions = {
  full?: boolean;
  monthsHistory?: number;      // janelinha de histórico na primeira carga incremental
  statuses?: string[] | "ALL"; // se a API aceitar filtro de status
};

const NOW_ISO = () => new Date().toISOString();

// Janela de segurança: updated_after = last_confirmed - 90s
const SAFETY_WINDOW_SECONDS = 90;

async function getLastDhOrFallback(key: string, monthsHistory = 6): Promise<string> {
  // tenta pegar do SyncState; se não houver, volta "agora - N meses"
  const val = await getSyncState(key);
  let lastConfirmedDate: Date;

  if (val) {
    lastConfirmedDate = new Date(val);
  } else {
    const d = new Date();
    d.setMonth(d.getMonth() - Math.max(0, monthsHistory));
    lastConfirmedDate = d;
  }

  // Aplica janela de segurança: last_confirmed - 90s
  const updatedAfter = subSeconds(lastConfirmedDate, SAFETY_WINDOW_SECONDS);
  return updatedAfter.toISOString();
}

// O syncCompaniesFull original foi removido, pois a listCompanies já usa o fetchWithRetry
// e a documentação não indica DtLastDH para empresas.
async function syncCompanies(opts: SyncOptions): Promise<number> {
  const companies = await listCompanies();
  await upsertEmpresasBatch(companies); // Atualizado para PT
  logger.info({ total: companies.length }, "syncCompanies concluído");
  await setSyncState("companies:last_dh", NOW_ISO());
  return companies.length;
}

async function syncProcesses(opts: SyncOptions): Promise<number> {
  const { full = false, monthsHistory = 6, statuses = "ALL" } = opts;
  let params: Record<string, any> = {};

  if (!full) {
    const lastDh = await getLastDhOrFallback("processes:last_dh", monthsHistory);
    params.DtLastDH = lastDh; // Corrigido para DtLastDH
  }

  if (statuses && statuses !== "ALL") {
    // O parâmetro correto é ProcStatus (singular) e aceita letras (ex: A, C, S)
    // Se o front enviar uma lista, precisa ser convertida para o formato correto.
    // Por enquanto, assumimos que o front envia o formato correto ou "ALL".
    // Se for uma lista, vamos juntar com vírgula (CSV) ou usar o primeiro elemento.
    // Como a doc sugere ProcStatus=A, vamos assumir que o front envia a string correta.
    params.ProcStatus = Array.isArray(statuses) ? statuses.join(',') : statuses;
  }

  const processes = await listProcesses(params);
  const { totalProcesses, totalEtapas } = await upsertProcessosBatch(processes); // upsertProcessosBatch deve retornar o total de etapas também

  logger.info({ totalProcesses, full }, "syncProcesses concluído");
  await setSyncState("processes:last_dh", NOW_ISO());
  return totalProcesses;
}

async function syncDeliveries(opts: SyncOptions): Promise<number> {
  const { full = false, monthsHistory = 6 } = opts;
  let params: Record<string, any> = {};

  if (!full) {
    const lastDh = await getLastDhOrFallback("deliveries:last_dh", monthsHistory);
    params.DtLastDH = lastDh; // Corrigido para DtLastDH
  }

  const deliveries = await listDeliveries(params);
  await upsertEntregasBatch(deliveries); // Atualizado para PT

  logger.info({ total: deliveries.length, full }, "syncDeliveries concluído");
  await setSyncState("deliveries:last_dh", NOW_ISO());
  return deliveries.length;
}

export async function syncAll(opts: SyncOptions = {}): Promise<{
  companies: number;
  processes: number;
  deliveries: number;
  finishedAt: string;
}> {
  const { full = false } = opts;

  logger.info({ full, opts }, "Iniciando syncAll");

  let companies = 0;
  try {
    companies = await syncCompanies(opts); // Usando a nova função syncCompanies
  } catch (e: any) {
    logger.warn({ err: e?.message }, "Companies não sincronizadas (erro). Seguindo…");
  }

  const processes = await syncProcesses(opts);
  const deliveries = await syncDeliveries(opts);

  const finishedAt = NOW_ISO();
  await setSyncState("global:last_sync", finishedAt);

  logger.info({ companies, processes, deliveries }, "syncAll concluído");
  return { companies, processes, deliveries, finishedAt };
}

export async function getMeta() {
  return {
    lastSync: await getSyncState("global:last_sync"),
    lastDh: {
      companies: await getSyncState("companies:last_dh"),
      processes: await getSyncState("processes:last_dh"),
      deliveries: await getSyncState("deliveries:last_dh"),
    },
  };
}
