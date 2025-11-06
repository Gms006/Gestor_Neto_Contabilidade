import { endOfMonth, startOfMonth, subDays, subMonths } from "date-fns";
import dayjs from "dayjs";
import { AcessoriasClient, getProcess, listCompanies, listDeliveries } from "../clients/acessoriasClient";
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
const DEFAULT_MONTHS_HISTORY = (() => {
  const raw = process.env.SYNC_MONTHS_HISTORY;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
})();

async function fetchProcessDetails(summaries: Raw[]): Promise<Map<string, Raw | null>> {
  const details = new Map<string, Raw | null>();
  for (const summary of summaries) {
    const externalId = resolveProcessExternalId(summary);
    if (!externalId) {
      continue;
    }
    try {
      const detail = await fetchWithRetry<Raw>(buildUrl('processes', { ident: externalId }));
      details.set(externalId, detail);
    } catch (error) {
      logger.warn({ externalId, err: (error as Error).message }, 'Falha ao obter detalhes do processo');
      details.set(externalId, null);
    }
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

async function syncCompanies(): Promise<number> {
  logger.info({ resource: "companies" }, "Iniciando sincronização de empresas");
  const companies = await listCompanies({ withObligations: true });
  const count = await upsertCompaniesBatch(companies);
  await touchCursor("companies");
  logger.info({ resource: "companies", count }, "Sincronização de empresas concluída");
  return count;
}

export async function syncProcessesFull(
  client: AcessoriasClient,
  monthsHistory = 6,
  statusesInput: string[] = (process.env.PROCESS_STATUS_LIST || "A,C").split(",")
): Promise<number> {
  const to = dayjs();
  const from = to.subtract(monthsHistory, "month");
  const useDates = process.env.USE_PROCESS_DATE_FILTERS === "1";

  const normalizedStatuses = statusesInput
    .map((value) => value.trim().toUpperCase())
    .filter((value): value is "A" | "C" => value === "A" || value === "C");
  const fallbackStatuses: Array<"A" | "C"> = ["A", "C"];
  const statuses: Array<"A" | "C"> =
    normalizedStatuses.length > 0 ? normalizedStatuses : fallbackStatuses;

  let totalPersisted = 0;

  for (const status of statuses) {
    let page = 1;
    logger.info({ resource: "processes", status }, "Iniciando listagem de processos");

    for (;;) {
      const raw = await client.listProcessesSmart({
        status,
        from: from.format("YYYY-MM-DD"),
        to: to.format("YYYY-MM-DD"),
        useDates,
        page,
        pageSize: 100,
      });

      const rowsRaw = raw as Record<string, unknown>;
      const rows = (
        Array.isArray((rowsRaw as any)?.items)
          ? ((rowsRaw as any).items as Record<string, unknown>[])
          : Array.isArray((rowsRaw as any)?.data)
          ? ((rowsRaw as any).data as Record<string, unknown>[])
          : Array.isArray(raw)
          ? (raw as Record<string, unknown>[])
          : []
      ).filter(Boolean);

      if (!rows.length) {
        logger.info({ resource: "processes", status, page }, "Nenhum processo retornado nesta página");
        break;
      }

      const detailsMap = new Map<string, Record<string, unknown> | null>();
      for (const summary of rows) {
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

      const { processes } = await upsertProcessesBatch(rows, detailsMap);
      totalPersisted += processes;

      logger.info({
        resource: "processes",
        status,
        page,
        batch: rows.length,
        persisted: processes,
      }, "Processos sincronizados");

      if (rows.length < 100) {
        break;
      }
      page += 1;
    }
  }

  return totalPersisted;
}

async function syncProcesses(opts: SyncOptions): Promise<number> {
  const { monthsHistory = DEFAULT_MONTHS_HISTORY } = opts;
  const statuses = resolveStatuses(opts.statuses);
  const baseUrl = process.env.ACESSORIAS_API_BASE ?? "https://api.acessorias.com";
  const token =
    process.env.ACESSORIAS_TOKEN ?? process.env.ACESSORIAS_API_TOKEN ?? "";

  const client = new AcessoriasClient(baseUrl, token);
  logger.info({ resource: "processes", monthsHistory, statuses }, "Iniciando sincronização de processos");

  const total = await syncProcessesFull(client, monthsHistory, statuses);

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
  let latestDh: Date | null = lastDh;

  for (const ident of identifiers) {
    if (!ident) continue;
    logger.info({ resource: 'deliveries', ident }, 'Listando entregas');
    const deliveries = await fetchAllPages<Raw>((page: number) =>
      buildUrl('deliveries', {
        ident,
        query: {
          Pagina: page,
          DtInitial: dtInitial,
          DtFinal: dtFinal,
          ...(dtLastDhParam ? { DtLastDH: dtLastDhParam } : {}),
        },
      })
    );

    if (deliveries.length === 0) {
      continue;
    }

    await upsertDeliveriesBatch(ident, deliveries);
    total += deliveries.length;

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
