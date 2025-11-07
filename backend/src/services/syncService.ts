import { differenceInCalendarDays, isValid, startOfDay, subDays } from "date-fns";
import { isAxiosError } from "axios";
import {
  listProcessesAll,
  listDeliveriesListAll,
  listDeliveriesById,
  pageThrough,
  ProcStatus,
} from "../clients/acessoriasClient";
import { mapProcessStatus } from "../lib/utils";
import { logger } from "../lib/logger";
import {
  findCompanyByExternalId,
  findProcessByExternalId,
  getSyncCursor,
  listCompanies,
  saveSyncCursor,
  upsertCompany,
  upsertDelivery,
  upsertProcess,
} from "../repositories/acessoriasRepo";
import { pickDate, pickNumber, pickString } from "../repositories/helpers";
import { safeParse } from "../lib/json";

type RawRecord = Record<string, unknown>;

type ParsedCompany = {
  externalId: string | null;
  name: string | null;
  identifier: string | null;
  email: string | null;
  raw: unknown;
};

type ParsedProcess = {
  externalId: string;
  title: string;
  statusRaw: string | null;
  progress: number | null;
  company: ParsedCompany | null;
  raw: RawRecord;
};

type ParsedDelivery = {
  externalId: string;
  name: string | null;
  status: string | null;
  dueDate: Date | null;
  processExternalId: string | null;
  company: ParsedCompany | null;
  raw: RawRecord;
};

const PROCESS_ID_FIELDS = ["ProcID", "procId", "ProcCod", "procCod", "ID", "id", "externalId", "Identificador", "identificador"];
const PROCESS_TITLE_FIELDS = ["Title", "title", "ProcNome", "procNome", "Nome", "nome", "Descricao", "descricao"];
const PROCESS_STATUS_FIELDS = ["ProcStatus", "procStatus", "Status", "status", "Situacao", "situacao"];
const PROCESS_PROGRESS_FIELDS = ["ProcProgress", "procProgress", "Progress", "progress", "Percentual", "percentual"];
const PROCESS_COMPANY_FIELDS = [
  "EmpCod",
  "empresaId",
  "EmpresaId",
  "companyId",
  "CompanyId",
  "EmpresaIdentificador",
  "empresaIdentificador",
  "Identificador",
  "identificador",
  "CNPJ",
  "cnpj",
  "CPF",
  "cpf",
];

const COMPANY_NAME_FIELDS = ["Nome", "name", "RazaoSocial", "razaoSocial", "Fantasia", "fantasia"];
const COMPANY_IDENTIFIER_FIELDS = ["Identificador", "identificador", "CNPJ", "cnpj", "CPF", "cpf"];
const COMPANY_EMAIL_FIELDS = ["Email", "email", "ContatoEmail", "contatoEmail"];

const DELIVERY_ID_FIELDS = ["ID", "id", "EntregaID", "entregaId", "externalId", "Identificador", "identificador"];
const DELIVERY_NAME_FIELDS = ["Nome", "nome", "Title", "title", "Entrega", "entrega", "Descricao", "descricao"];
const DELIVERY_STATUS_FIELDS = ["Status", "status", "Situacao", "situacao", "EntregaStatus", "entregaStatus"];
const DELIVERY_DUE_DATE_FIELDS = ["DueDate", "dueDate", "Vencimento", "vencimento", "DtVencimento", "dtVencimento"];
const DELIVERY_PROCESS_FIELDS = ["ProcID", "procId", "ProcessoId", "processoId", "ProcessId", "processId", "ProcCod", "procCod"];

function firstObjectCandidate(record: RawRecord, keys: string[]): RawRecord | null {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object") {
      return value as RawRecord;
    }
  }
  return null;
}

function parseCompany(record: RawRecord): ParsedCompany | null {
  const nested =
    firstObjectCandidate(record, ["company", "Company", "empresa", "Empresa"]) ??
    (record as RawRecord);
  const externalId = pickString([
    ...(nested ? COMPANY_IDENTIFIER_FIELDS.map((field) => nested?.[field]) : []),
    ...COMPANY_IDENTIFIER_FIELDS.map((field) => record[field]),
    ...PROCESS_COMPANY_FIELDS.map((field) => record[field]),
  ]);
  if (!externalId) {
    return null;
  }
  const name = pickString([
    ...(nested ? COMPANY_NAME_FIELDS.map((field) => nested?.[field]) : []),
    ...COMPANY_NAME_FIELDS.map((field) => record[field]),
  ]);
  const identifier =
    pickString([
      ...(nested ? COMPANY_IDENTIFIER_FIELDS.map((field) => nested?.[field]) : []),
      ...COMPANY_IDENTIFIER_FIELDS.map((field) => record[field]),
    ]) ?? null;
  const email = pickString([
    ...(nested ? COMPANY_EMAIL_FIELDS.map((field) => nested?.[field]) : []),
    ...COMPANY_EMAIL_FIELDS.map((field) => record[field]),
  ]);
  return {
    externalId,
    name: name ?? `Empresa ${externalId}`,
    identifier,
    email,
    raw: nested ?? record,
  };
}

function parseProcess(raw: RawRecord): ParsedProcess | null {
  const externalId = pickString(PROCESS_ID_FIELDS.map((field) => raw[field]));
  if (!externalId) {
    logger.warn({ raw }, "Ignorando processo sem identificador externo");
    return null;
  }
  const title = pickString(PROCESS_TITLE_FIELDS.map((field) => raw[field])) ?? `Processo ${externalId}`;
  const statusRaw = pickString(PROCESS_STATUS_FIELDS.map((field) => raw[field]));
  const progress = pickNumber(PROCESS_PROGRESS_FIELDS.map((field) => raw[field]));
  const company = parseCompany(raw);
  return {
    externalId,
    title,
    statusRaw,
    progress,
    company,
    raw,
  };
}

function parseDelivery(raw: RawRecord): ParsedDelivery | null {
  const externalId = pickString(DELIVERY_ID_FIELDS.map((field) => raw[field]));
  if (!externalId) {
    logger.warn({ raw }, "Ignorando entrega sem identificador externo");
    return null;
  }
  const name = pickString(DELIVERY_NAME_FIELDS.map((field) => raw[field]));
  const status = pickString(DELIVERY_STATUS_FIELDS.map((field) => raw[field]));
  const dueDate = pickDate(DELIVERY_DUE_DATE_FIELDS.map((field) => raw[field]));
  const processExternalId = pickString(DELIVERY_PROCESS_FIELDS.map((field) => raw[field]));
  const company = parseCompany(raw);
  return {
    externalId,
    name,
    status,
    dueDate,
    processExternalId,
    company,
    raw,
  };
}

async function ensureCompanyId(parsed: ParsedCompany | null, cache: Map<string, string>): Promise<string | null> {
  if (!parsed?.externalId) {
    return null;
  }
  if (cache.has(parsed.externalId)) {
    return cache.get(parsed.externalId) ?? null;
  }
  const existing = await findCompanyByExternalId(parsed.externalId);
  const existingRaw = existing?.raw ? safeParse(existing.raw) : undefined;
  const company = await upsertCompany({
    externalId: parsed.externalId,
    name: parsed.name ?? existing?.name ?? `Empresa ${parsed.externalId}`,
    identifier: parsed.identifier ?? existing?.identifier ?? null,
    email: parsed.email ?? existing?.email ?? null,
    raw: parsed.raw ?? existingRaw ?? null,
  });
  cache.set(parsed.externalId, company.id);
  return company.id;
}

async function ensureProcessId(
  externalId: string | null,
  cache: Map<string, string>
): Promise<string | null> {
  if (!externalId) return null;
  if (cache.has(externalId)) {
    return cache.get(externalId) ?? null;
  }
  const existing = await findProcessByExternalId(externalId);
  if (!existing) return null;
  cache.set(externalId, existing.id);
  return existing.id;
}

function clampListAllCursor(lastDh: Date | null): Date {
  if (!lastDh || !isValid(lastDh)) {
    return subDays(new Date(), 1);
  }
  const now = new Date();
  const diff = Math.abs(differenceInCalendarDays(now, lastDh));
  if (diff <= 1) {
    return lastDh;
  }
  return subDays(now, 1);
}

export async function syncAll(): Promise<void> {
  const companyCache = new Map<string, string>();
  const processCache = new Map<string, string>();

  const processesCount = await syncProcesses(companyCache, processCache);
  const deliveryCounts = await syncDeliveries(companyCache, processCache);

  const counts = {
    processes: processesCount,
    deliveriesListAll: deliveryCounts.listAll,
    deliveriesByCompany: deliveryCounts.byCompany,
    deliveriesTotal: deliveryCounts.listAll + deliveryCounts.byCompany,
  };

  logger.info({ counts }, "Sync concluido");
}

async function syncProcesses(
  companyCache: Map<string, string>,
  processCache: Map<string, string>
): Promise<number> {
  const statuses: ProcStatus[] = ["A", "C"];
  const lastDh = await getSyncCursor("processes");
  const since = lastDh ?? subDays(new Date(), 7);
  logger.info({ since }, "Sincronizando processos (A/C)");

  let processed = 0;

  for (const status of statuses) {
    const processes = await pageThrough((page) =>
      listProcessesAll({ status, lastDh: since, page })
    );
    logger.info({ status, count: processes.length }, "Processos recebidos");
    for (const raw of processes) {
      const parsed = parseProcess(raw as RawRecord);
      if (!parsed) continue;
      const companyId = await ensureCompanyId(parsed.company, companyCache);
      const statusNorm = mapProcessStatus(parsed.statusRaw, parsed.progress);
      const process = await upsertProcess({
        externalId: parsed.externalId,
        title: parsed.title,
        statusRaw: parsed.statusRaw ?? null,
        statusNorm,
        progress: parsed.progress ?? null,
        companyId,
        raw: parsed.raw,
      });
      processCache.set(process.externalId, process.id);
      processed += 1;
    }
  }

  await saveSyncCursor("processes", new Date());
  return processed;
}

async function syncDeliveries(
  companyCache: Map<string, string>,
  processCache: Map<string, string>
): Promise<{ listAll: number; byCompany: number }> {
  const lastDh = clampListAllCursor(await getSyncCursor("deliveries"));
  logger.info({ lastDh }, "Sincronizando entregas (ListAll)");
  const seen = new Set<string>();
  const deliveries = await pageThrough((page) =>
    listDeliveriesListAll({ lastDh, page })
  );
  logger.info({ count: deliveries.length }, "Entregas recebidas via ListAll");

  let listAllCount = 0;
  for (const raw of deliveries) {
    if (await persistDelivery(raw as RawRecord, companyCache, processCache, seen)) {
      listAllCount += 1;
    }
  }

  let byCompanyCount = 0;
  if (!deliveries.length) {
    byCompanyCount = await syncDeliveriesByCompany(lastDh, companyCache, processCache, seen);
  }

  await saveSyncCursor("deliveries", new Date());
  return { listAll: listAllCount, byCompany: byCompanyCount };
}

async function syncDeliveriesByCompany(
  lastDh: Date,
  companyCache: Map<string, string>,
  processCache: Map<string, string>,
  seen: Set<string>
): Promise<number> {
  const companies = await listCompanies();
  const from = startOfDay(lastDh);
  const to = new Date();
  logger.info({ companies: companies.length, from, to }, "Sincronizando entregas por empresa");

  let processed = 0;
  for (const company of companies) {
    if (!company.identifier) continue;
    try {
      const chunks = await pageThrough((page) =>
        listDeliveriesById({
          identificador: company.identifier!,
          dtInitial: from,
          dtFinal: to,
          page,
        })
      );
      logger.info({ company: company.externalId, count: chunks.length }, "Entregas recebidas por empresa");
      for (const raw of chunks) {
        if (await persistDelivery(raw as RawRecord, companyCache, processCache, seen)) {
          processed += 1;
        }
      }
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        logger.warn(
          { company: company.externalId, status: 404, err: error.message },
          "Falha ao sincronizar entregas da empresa"
        );
        continue;
      }
      logger.warn(
        { company: company.externalId, err: (error as Error).message },
        "Falha ao sincronizar entregas da empresa"
      );
    }
  }
  return processed;
}

async function persistDelivery(
  raw: RawRecord,
  companyCache: Map<string, string>,
  processCache: Map<string, string>,
  seen: Set<string>
): Promise<boolean> {
  const parsed = parseDelivery(raw);
  if (!parsed) return false;
  if (seen.has(parsed.externalId)) return false;
  seen.add(parsed.externalId);

  const companyId = await ensureCompanyId(parsed.company, companyCache);
  const processId =
    (await ensureProcessId(parsed.processExternalId, processCache)) ??
    (parsed.processExternalId
      ? processCache.get(parsed.processExternalId) ?? null
      : null);

  if (!processId && parsed.processExternalId) {
    logger.debug({ externalId: parsed.processExternalId }, "Processo não encontrado para entrega");
  }

  await upsertDelivery({
    externalId: parsed.externalId,
    name: parsed.name ?? null,
    status: parsed.status ?? null,
    dueDate: parsed.dueDate ?? null,
    companyId,
    processId,
    payload: parsed.raw,
  });
  return true;
}
