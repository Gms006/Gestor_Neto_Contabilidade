import { endOfMonth, startOfMonth, subDays, subMonths } from "date-fns";
import { getProcess, listCompanies, listDeliveries, listProcesses } from "../clients/acessoriasClient";
import { fmtDate, fmtDH } from "../lib/date";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { upsertCompaniesBatch } from "../repositories/companyRepo";
import { upsertDeliveriesBatch } from "../repositories/deliveryRepo";
import { resolveProcessExternalId, upsertProcessesBatch } from "../repositories/processRepo";
import { getCursor, setCursor, touchCursor } from "../repositories/syncCursorRepo";

export type SyncOptions = {
  full?: boolean;
  monthsHistory?: number;
  statuses?: string[] | "ALL";
  includeDeliveries?: boolean;
};

const SAFETY_DAYS = 1;
const DEFAULT_MONTHS_HISTORY = 6;

function resolveStatuses(input?: string[] | "ALL"): string[] {
  if (!input || input === "ALL") {
    return ["A", "C"];
  }
  const list = Array.isArray(input) ? input : [input];
  return Array.from(
    new Set(
      list
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value.length > 0)
    )
  );
}

function computeSinceDate(full: boolean, monthsHistory: number, cursor: string | null): string | null {
  if (full) {
    return null;
  }
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) {
      const safeDate = subDays(parsed, SAFETY_DAYS);
      return fmtDate(safeDate);
    }
  }
  const fallback = subMonths(new Date(), monthsHistory);
  return fmtDate(fallback);
}

async function syncCompanies(): Promise<number> {
  logger.info({ resource: "companies" }, "Iniciando sincronização de empresas");
  const companies = await listCompanies({ withObligations: true });
  const count = await upsertCompaniesBatch(companies);
  await touchCursor("companies");
  logger.info({ resource: "companies", count }, "Sincronização de empresas concluída");
  return count;
}

async function syncProcesses(opts: SyncOptions): Promise<number> {
  const { full = false, monthsHistory = DEFAULT_MONTHS_HISTORY } = opts;
  const statuses = resolveStatuses(opts.statuses);
  const { cursor } = await getCursor("processes");
  const sinceDate = computeSinceDate(full, monthsHistory, cursor);

  let total = 0;

  for (const status of statuses) {
    const filters: Record<string, string> = { ProcStatus: status };
    if (sinceDate) {
      filters.ProcInicio = sinceDate;
    }

    logger.info({ resource: "processes", status, filters }, "Listando processos");
    const summaries = await listProcesses(filters);
    const detailsMap = new Map<string, Record<string, unknown> | null>();

    for (const summary of summaries) {
      const externalId = resolveProcessExternalId(summary);
      if (!externalId) {
        logger.warn({ summary }, "Resumo de processo sem identificador externo");
        continue;
      }

      try {
        const detail = await getProcess(externalId);
        detailsMap.set(externalId, detail);
      } catch (error) {
        logger.error({ err: (error as Error).message, externalId }, "Falha ao obter detalhes do processo");
        detailsMap.set(externalId, null);
      }
    }

    const { processes } = await upsertProcessesBatch(summaries, detailsMap);
    total += processes;
    logger.info({ resource: "processes", status, batch: summaries.length, persisted: processes }, "Processos sincronizados");
  }

  await setCursor("processes", new Date().toISOString(), new Date());
  logger.info({ resource: "processes", total }, "Sincronização de processos concluída");
  return total;
}

async function syncDeliveries(opts: SyncOptions): Promise<number> {
  if (!opts.includeDeliveries) {
    return 0;
  }

  const { full = false, monthsHistory = DEFAULT_MONTHS_HISTORY } = opts;
  const now = new Date();
  const rangeStart = full ? subMonths(startOfMonth(now), monthsHistory) : startOfMonth(now);
  const rangeEnd = endOfMonth(now);

  const dtInitial = fmtDate(rangeStart);
  const dtFinal = fmtDate(rangeEnd);

  const { cursor } = await getCursor("deliveries");
  const lastDh = !full && cursor ? fmtDH(subDays(new Date(cursor), SAFETY_DAYS)) : undefined;

  const companies = await prisma.company.findMany({ select: { externalId: true } });
  let total = 0;

  for (const company of companies) {
    if (!company.externalId) continue;
    try {
      const deliveries = await listDeliveries(company.externalId, dtInitial, dtFinal, lastDh);
      const processed = await upsertDeliveriesBatch(company.externalId, deliveries);
      total += processed;
      logger.info(
        { resource: "deliveries", company: company.externalId, processed },
        "Entregas sincronizadas"
      );
    } catch (error) {
      logger.error(
        { err: (error as Error).message, company: company.externalId },
        "Falha ao sincronizar entregas da empresa"
      );
    }
  }

  await setCursor("deliveries", new Date().toISOString(), new Date());
  logger.info({ resource: "deliveries", total }, "Sincronização de entregas concluída");
  return total;
}

export async function syncAll(opts: SyncOptions = {}) {
  logger.info({ opts }, "Iniciando sincronização completa");

  const companies = await syncCompanies();
  const processes = await syncProcesses(opts);
  const deliveries = await syncDeliveries(opts);

  logger.info({ companies, processes, deliveries }, "Sincronização completa finalizada");
  return { companies, processes, deliveries };
}

export async function getMeta() {
  const [companies, processes, deliveries] = await Promise.all([
    getCursor("companies"),
    getCursor("processes"),
    getCursor("deliveries"),
  ]);

  return {
    companies,
    processes,
    deliveries,
  };
}
