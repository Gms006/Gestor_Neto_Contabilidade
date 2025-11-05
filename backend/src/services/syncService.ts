import { subMonths, subSeconds, startOfMonth, endOfMonth } from "date-fns";
import { listCompanies, listProcesses, listDeliveries } from "../clients/acessoriasClient";
import { fmtDH, fmtDate } from "../lib/date";
import { logger } from "../lib/logger";
import {
  getSyncState,
  setSyncState,
  upsertCompaniesBatch,
  upsertProcessesBatch,
  upsertDeliveriesBatch,
} from "../repositories/acessoriasRepo";

export type SyncOptions = {
  full?: boolean;
  monthsHistory?: number;
  statuses?: string[] | "ALL";
};

const SAFETY_WINDOW_SECONDS = 90;

async function getLastDhDate(key: string, monthsHistory = 6): Promise<Date> {
  const stored = await getSyncState(key);
  if (stored) {
    const parsed = new Date(stored);
    if (!Number.isNaN(parsed.getTime())) {
      return subSeconds(parsed, SAFETY_WINDOW_SECONDS);
    }
  }
  const fallback = subMonths(new Date(), Math.max(0, monthsHistory));
  return subSeconds(fallback, SAFETY_WINDOW_SECONDS);
}

async function syncCompanies(): Promise<number> {
  let page = 1;
  let total = 0;

  while (true) {
    const batch = await listCompanies(page);
    if (!batch.length) {
      break;
    }
    await upsertCompaniesBatch(batch);
    total += batch.length;
    logger.info({ resource: "companies", page, batch: batch.length }, "Página sincronizada");
    page += 1;
  }

  await setSyncState("companies:last_dh", new Date().toISOString());
  logger.info({ resource: "companies", total }, "syncCompanies concluído");
  return total;
}

function resolveStatuses(input?: string[] | "ALL"): string[] {
  if (!input || input === "ALL") {
    return ["A", "C"];
  }
  const list = Array.isArray(input) ? input : [input];
  return Array.from(new Set(list.map((code) => code.trim().toUpperCase()).filter(Boolean)));
}

async function syncProcesses(opts: SyncOptions): Promise<number> {
  const { full = false, monthsHistory = 6, statuses } = opts;
  const statusList = resolveStatuses(statuses);
  const lastDhDate = await getLastDhDate("processes:last_dh", monthsHistory);
  const dtLastDh = full ? undefined : fmtDH(lastDhDate);

  let totalProcesses = 0;
  let totalSteps = 0;

  for (const statusCode of statusList) {
    let page = 1;
    while (true) {
      const batch = await listProcesses({
        page,
        ProcStatus: statusCode,
        DtLastDH: dtLastDh,
      });
      if (!batch.length) {
        break;
      }
      const { processes, steps } = await upsertProcessesBatch(batch);
      totalProcesses += processes;
      totalSteps += steps;
      logger.info(
        { resource: "processes", status: statusCode, page, batch: batch.length },
        "Página sincronizada"
      );
      page += 1;
    }
  }

  await setSyncState("processes:last_dh", new Date().toISOString());
  logger.info(
    { resource: "processes", totalProcesses, totalSteps, statuses: statusList },
    "syncProcesses concluído"
  );
  return totalProcesses;
}

async function syncDeliveries(opts: SyncOptions): Promise<number> {
  const { full = false, monthsHistory = 6 } = opts;
  const now = new Date();
  const dtInitial = fmtDate(startOfMonth(now));
  const dtFinal = fmtDate(endOfMonth(now));
  const lastDhDate = await getLastDhDate("deliveries:last_dh", monthsHistory);
  const dtLastDh = fmtDH(full ? now : lastDhDate);

  let page = 1;
  let total = 0;

  while (true) {
    const batch = await listDeliveries({
      page,
      DtInitial: dtInitial,
      DtFinal: dtFinal,
      DtLastDH: dtLastDh,
    });
    if (!batch.length) {
      break;
    }
    await upsertDeliveriesBatch(batch);
    total += batch.length;
    logger.info({ resource: "deliveries", page, batch: batch.length }, "Página sincronizada");
    page += 1;
  }

  await setSyncState("deliveries:last_dh", new Date().toISOString());
  logger.info({ resource: "deliveries", total }, "syncDeliveries concluído");
  return total;
}

export async function syncAll(opts: SyncOptions = {}) {
  const { full = false } = opts;
  logger.info({ full, opts }, "Iniciando syncAll");

  let companies = 0;
  try {
    companies = await syncCompanies();
  } catch (error: any) {
    logger.warn({ err: error?.message }, "Falha ao sincronizar companies");
  }

  const processes = await syncProcesses(opts);
  const deliveries = await syncDeliveries(opts);

  const finishedAt = new Date().toISOString();
  await setSyncState("global:last_sync", finishedAt);

  logger.info({ companies, processes, deliveries, finishedAt }, "syncAll concluído");
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
