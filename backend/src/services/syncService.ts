import { endOfDay, format, startOfDay, subMonths } from 'date-fns';
import { buildUrl, fetchAllPages, fetchWithRetry } from '../clients/acessoriasClient.js';
import { logger } from '../lib/logger.js';
import {
  listCompanyExternalIds,
  upsertCompaniesBatch,
} from '../repositories/companyRepo.js';
import { upsertDeliveriesBatch } from '../repositories/deliveryRepo.js';
import {
  resolveProcessExternalId,
  upsertProcessesBatch,
} from '../repositories/processRepo.js';
import { pickDate } from '../repositories/helpers.js';
import { getCursor, setCursor, touchCursor } from '../repositories/syncCursorRepo.js';

type Raw = Record<string, unknown>;

export type SyncOptions = {
  full?: boolean;
  monthsHistory?: number;
  statuses?: string[] | 'ALL';
  includeDeliveries?: boolean;
};

const LAST_DH_FIELDS = ['DtLastDH', 'dtLastDH', 'LastDH', 'lastDh'];
const DEFAULT_MONTHS_HISTORY = (() => {
  const raw = process.env.SYNC_MONTHS_HISTORY;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
})();

function extractLastDh(payload: Raw): Date | null {
  return pickDate(LAST_DH_FIELDS.map((field) => payload[field]));
}

function resolveMonthsHistory(full?: boolean, monthsHistory?: number) {
  if (full) {
    return monthsHistory ?? DEFAULT_MONTHS_HISTORY;
  }
  if (Number.isFinite(monthsHistory) && monthsHistory && monthsHistory > 0) {
    return monthsHistory;
  }
  return DEFAULT_MONTHS_HISTORY;
}

const STATUS_MAP: Record<string, 'inprogress' | 'concluded'> = {
  a: 'inprogress',
  aberto: 'inprogress',
  open: 'inprogress',
  inprogress: 'inprogress',
  andamento: 'inprogress',
  em_andamento: 'inprogress',
  c: 'concluded',
  concluido: 'concluded',
  concluded: 'concluded',
  closed: 'concluded',
};

function resolveStatuses(input?: string[] | 'ALL'): ('inprogress' | 'concluded')[] {
  if (!input || input === 'ALL') {
    return ['inprogress', 'concluded'];
  }
  const list = Array.isArray(input) ? input : [input];
  const set = new Set<'inprogress' | 'concluded'>();
  for (const value of list) {
    const key = value?.toString().trim().toLowerCase();
    if (!key) continue;
    const mapped = STATUS_MAP[key];
    if (mapped) {
      set.add(mapped);
    }
  }
  if (set.size === 0) {
    return ['inprogress', 'concluded'];
  }
  return Array.from(set);
}

async function syncCompanies(): Promise<number> {
  logger.info({ resource: 'companies' }, 'Sincronização de empresas iniciada');
  const companies = await fetchAllPages<Raw>((page: number) =>
    buildUrl('companies', { ident: 'ListAll', query: { Pagina: page } })
  );
  const total = await upsertCompaniesBatch(companies);
  await touchCursor('companies');
  logger.info({ resource: 'companies', total }, 'Sincronização de empresas concluída');
  return total;
}

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
  return details;
}

async function syncProcesses(opts: SyncOptions): Promise<number> {
  const statuses = resolveStatuses(opts.statuses);
  let totalPersisted = 0;
  let latestDh: Date | null = null;

  for (const status of statuses) {
    const query = status ? { Pagina: 1, ProcStatus: status } : { Pagina: 1 };
    logger.info({ resource: 'processes', status: status ?? 'all' }, 'Listando processos');
    const processes = await fetchAllPages<Raw>((page: number) =>
      buildUrl('processes', {
        ident: 'ListAll',
        query: { ...query, Pagina: page },
      })
    );

    if (processes.length === 0) {
      continue;
    }

    const details = await fetchProcessDetails(processes);
    const { processes: persisted } = await upsertProcessesBatch(processes, details);
    totalPersisted += persisted;

    for (const payload of processes) {
      const candidate = extractLastDh(payload);
      if (candidate && (!latestDh || candidate > latestDh)) {
        latestDh = candidate;
      }
    }

    for (const detail of details.values()) {
      if (!detail) continue;
      const candidate = extractLastDh(detail);
      if (candidate && (!latestDh || candidate > latestDh)) {
        latestDh = candidate;
      }
    }
  }

  const cursorValue = latestDh ? latestDh.toISOString() : new Date().toISOString();
  await setCursor('processes', cursorValue, new Date());
  logger.info({ resource: 'processes', total: totalPersisted }, 'Sincronização de processos concluída');
  return totalPersisted;
}

async function syncDeliveries(opts: SyncOptions): Promise<number> {
  const includeDeliveries = opts.includeDeliveries ?? true;
  if (!includeDeliveries) {
    return 0;
  }

  const monthsHistory = resolveMonthsHistory(opts.full, opts.monthsHistory);
  const now = new Date();
  const dtInitial = format(startOfDay(subMonths(now, monthsHistory)), 'yyyy-MM-dd');
  const dtFinal = format(endOfDay(now), 'yyyy-MM-dd');

  const { cursor } = await getCursor('deliveries');
  const lastDh = cursor ? new Date(cursor) : null;
  const dtLastDhParam = lastDh ? format(lastDh, 'yyyy-MM-dd HH:mm:ss') : undefined;

  const identifiers = await listCompanyExternalIds();
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

    for (const payload of deliveries) {
      const candidate = extractLastDh(payload);
      if (candidate && (!latestDh || candidate > latestDh)) {
        latestDh = candidate;
      }
    }
  }

  const cursorValue = latestDh ? latestDh.toISOString() : new Date().toISOString();
  await setCursor('deliveries', cursorValue, new Date());
  logger.info({ resource: 'deliveries', total }, 'Sincronização de entregas concluída');
  return total;
}

export async function syncAll(opts: SyncOptions = {}) {
  logger.info({ opts }, 'Iniciando sincronização completa');
  const companies = await syncCompanies();
  const processes = await syncProcesses(opts);
  const deliveries = await syncDeliveries(opts);
  logger.info({ companies, processes, deliveries }, 'Sincronização completa finalizada');
  return { companies, processes, deliveries };
}

export async function getMeta() {
  const [companies, processes, deliveries] = await Promise.all([
    getCursor('companies'),
    getCursor('processes'),
    getCursor('deliveries'),
  ]);

  return {
    companies,
    processes,
    deliveries,
  };
}
