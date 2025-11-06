import { Company, Process, Prisma } from "@prisma/client";
import { mapProcessStatus } from "../lib/utils.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { upsertCompanyFromApi } from "./companyRepo.js";
import { ensureStringId, pickDate, pickNumber, pickString, serializeValue, stringifyJson } from "./helpers.js";

export type RawProcess = Record<string, unknown>;

const PROCESS_ID_CANDIDATES = [
  "ProcID",
  "procId",
  "ProcCod",
  "procCod",
  "ID",
  "id",
  "externalId",
  "Identificador",
  "identificador",
];

const COMPANY_IN_PROCESS_CANDIDATES = [
  "EmpCod",
  "empresaId",
  "EmpresaId",
  "companyId",
  "CompanyId",
  "EmpresaIdentificador",
  "empresaIdentificador",
];

const TITLE_FIELDS = [
  "ProcNome",
  "procNome",
  "titulo",
  "Titulo",
  "nome",
  "Nome",
];

const DEPARTMENT_FIELDS = [
  "Departamento",
  "departamento",
  "Setor",
  "setor",
];

const DESCRIPTION_FIELDS = [
  "Descricao",
  "descricao",
  "Resumo",
  "resumo",
];

const STATUS_FIELDS = [
  "ProcStatus",
  "procStatus",
  "status",
  "Status",
  "situacao",
  "Situacao",
];

const PROGRESS_FIELDS = [
  "ProcProgress",
  "procProgress",
  "progress",
  "Progress",
  "percentual",
  "Percentual",
];

const START_DATE_FIELDS = [
  "ProcInicio",
  "procInicio",
  "DtInicio",
  "dtInicio",
  "Inicio",
  "inicio",
  "DataInicio",
  "dataInicio",
];

const END_DATE_FIELDS = [
  "ProcConclusao",
  "procConclusao",
  "DtConclusao",
  "dtConclusao",
  "Conclusao",
  "conclusao",
  "DataFim",
  "dataFim",
];

const LAST_DH_FIELDS = ["DtLastDH", "dtLastDH", "LastDH", "lastDh"];

const RESPONSIBLE_FIELDS = ["Responsaveis", "responsaveis", "responsible", "responsibles"];
const STEPS_FIELDS = ["Etapas", "etapas", "Steps", "steps", "Passos", "passos"];
const HISTORY_FIELDS = ["Historico", "historico", "History", "history"];
const ATTACHMENTS_FIELDS = ["Anexos", "anexos", "Attachments", "attachments"];

function extractProcessId(summary: RawProcess, detail?: RawProcess | null): string | null {
  const candidates = [
    ...PROCESS_ID_CANDIDATES.map((key) => summary[key]),
    ...(detail ? PROCESS_ID_CANDIDATES.map((key) => detail[key]) : []),
  ];
  return ensureStringId(candidates, "process");
}

export function resolveProcessExternalId(summary: RawProcess): string | null {
  return extractProcessId(summary, null);
}

function extractCompanyExternalId(summary: RawProcess, detail?: RawProcess | null): string | null {
  const candidates = [
    ...COMPANY_IN_PROCESS_CANDIDATES.map((key) => summary[key]),
    ...(detail ? COMPANY_IN_PROCESS_CANDIDATES.map((key) => detail[key]) : []),
  ];
  const companyFromNested = (summary.company ?? summary.empresa ?? detail?.company ?? detail?.empresa) as
    | Record<string, unknown>
    | undefined;
  if (companyFromNested) {
    candidates.push(...COMPANY_IN_PROCESS_CANDIDATES.map((key) => companyFromNested[key]));
    candidates.push(companyFromNested?.Identificador);
    candidates.push(companyFromNested?.identificador);
    candidates.push(companyFromNested?.id);
  }
  return ensureStringId(candidates, "company");
}

export function resolveCompanyExternalId(summary: RawProcess): string | null {
  return extractCompanyExternalId(summary, null);
}

function extractField(payload: RawProcess, fields: string[]): unknown {
  for (const field of fields) {
    if (payload[field] !== undefined) {
      return payload[field];
    }
  }
  return undefined;
}

function extractNestedField(
  summary: RawProcess,
  detail: RawProcess | null | undefined,
  fields: string[]
): unknown {
  const summaryValue = extractField(summary, fields);
  if (summaryValue !== undefined) {
    return summaryValue;
  }
  if (detail) {
    return extractField(detail, fields);
  }
  return undefined;
}

function extractJson(summary: RawProcess, detail: RawProcess | null | undefined, fields: string[]): unknown {
  const value = extractNestedField(summary, detail, fields);
  return value === undefined ? null : value;
}

export async function upsertProcessFromApi(
  summary: RawProcess,
  detail: RawProcess | null
): Promise<Process | null> {
  const externalId = extractProcessId(summary, detail);
  if (!externalId) {
    logger.warn({ summary }, "Ignorando processo sem identificador externo");
    return null;
  }

  const companyExternalId = extractCompanyExternalId(summary, detail);
  if (!companyExternalId) {
    logger.warn({ summary }, "Ignorando processo sem empresa associada");
    return null;
  }

  const companyData =
    (detail?.company as RawProcess | undefined) ??
    (detail?.empresa as RawProcess | undefined) ??
    (summary.company as RawProcess | undefined) ??
    (summary.empresa as RawProcess | undefined);

  let company: Company | null = null;
  if (companyData) {
    company = await upsertCompanyFromApi({ ...companyData, Identificador: companyExternalId });
  }

  if (!company) {
    company = await prisma.company.upsert({
      where: { externalId: companyExternalId },
      create: {
        externalId: companyExternalId,
        name: `Empresa ${companyExternalId}`,
        raw: stringifyJson(companyData),
      },
      update: {
        raw: stringifyJson(companyData),
      },
    });
  }

  if (!company) {
    throw new Error(`Não foi possível resolver empresa ${companyExternalId}`);
  }

  const title =
    (pickString(TITLE_FIELDS.map((field) => summary[field])) ??
      pickString(TITLE_FIELDS.map((field) => detail?.[field]))) ??
    `Processo ${externalId}`;
  const department = pickString(DEPARTMENT_FIELDS.map((field) => summary[field])) ??
    pickString(DEPARTMENT_FIELDS.map((field) => detail?.[field]));
  const description = pickString(DESCRIPTION_FIELDS.map((field) => summary[field])) ??
    pickString(DESCRIPTION_FIELDS.map((field) => detail?.[field]));
  const statusRaw = pickString(STATUS_FIELDS.map((field) => summary[field])) ??
    pickString(STATUS_FIELDS.map((field) => detail?.[field]));
  const progress = pickNumber(PROGRESS_FIELDS.map((field) => summary[field])) ??
    pickNumber(PROGRESS_FIELDS.map((field) => detail?.[field]));
  const progressNormalized =
    progress !== null && progress !== undefined
      ? Math.max(0, Math.min(100, Number(progress)))
      : null;
  const startedAt = pickDate(START_DATE_FIELDS.map((field) => summary[field])) ??
    pickDate(START_DATE_FIELDS.map((field) => detail?.[field]));
  const finishedAt = pickDate(END_DATE_FIELDS.map((field) => summary[field])) ??
    pickDate(END_DATE_FIELDS.map((field) => detail?.[field]));
  const lastDh = pickDate(LAST_DH_FIELDS.map((field) => summary[field])) ??
    pickDate(LAST_DH_FIELDS.map((field) => detail?.[field]));

  const normalizedStatus = mapProcessStatus(statusRaw ?? undefined, progressNormalized ?? undefined);
  const responsible = extractJson(summary, detail, RESPONSIBLE_FIELDS);
  const steps = extractJson(summary, detail, STEPS_FIELDS);
  const history = extractJson(summary, detail, HISTORY_FIELDS);
  const attachments = extractJson(summary, detail, ATTACHMENTS_FIELDS);
  const rawJson = stringifyJson({ summary, detail });

  return prisma.process.upsert({
    where: { externalId },
    create: {
      externalId,
      companyId: company.id,
      title,
      department,
      description,
      statusRaw: statusRaw ?? null,
      statusNormalized: normalizedStatus,
      progress: progressNormalized,
      startedAt: startedAt ?? null,
      finishedAt: finishedAt ?? null,
      lastDh: lastDh ?? null,
      responsible: serializeValue(responsible),
      steps: serializeValue(steps),
      history: serializeValue(history),
      attachments: serializeValue(attachments),
      raw: rawJson,
    },
    update: {
      companyId: company.id,
      title,
      department,
      description,
      statusRaw: statusRaw ?? null,
      statusNormalized: normalizedStatus,
      progress: progressNormalized,
      startedAt: startedAt ?? null,
      finishedAt: finishedAt ?? null,
      lastDh: lastDh ?? null,
      responsible: serializeValue(responsible),
      steps: serializeValue(steps),
      history: serializeValue(history),
      attachments: serializeValue(attachments),
      raw: rawJson,
    },
  });
}

export async function upsertProcessesBatch(
  processes: RawProcess[],
  detailsMap: Map<string, RawProcess | null> = new Map()
): Promise<{ processes: number }> {
  let count = 0;
  for (const summary of processes) {
    try {
      const externalId = extractProcessId(summary, null);
      const detail = externalId ? detailsMap.get(externalId) ?? null : null;
      const upserted = await upsertProcessFromApi(summary, detail);
      if (upserted) {
        count += 1;
      }
    } catch (error) {
      logger.error({ err: (error as Error).message, summary }, "Falha ao processar processo");
    }
  }
  return { processes: count };
}

type StatusFilter = "concluido" | "em_andamento" | "todos" | undefined;

function normalizeStatusFilter(status?: string): "CONCLUIDO" | "EM_ANDAMENTO" | undefined {
  if (!status) return undefined;
  const normalized = status.toLowerCase();
  if (normalized === "concluido") return "CONCLUIDO";
  if (normalized === "em_andamento") return "EM_ANDAMENTO";
  return undefined;
}

function resolveOrder(order?: string): Prisma.ProcessOrderByWithRelationInput {
  const fallback: Prisma.ProcessOrderByWithRelationInput = { updatedAt: "desc" };
  if (!order) return fallback;
  const trimmed = order.trim();
  if (!trimmed) return fallback;
  const direction: Prisma.SortOrder = trimmed.startsWith("-") ? "desc" : "asc";
  const field = trimmed.replace(/^[-+]/, "");
  const allowed = new Set(["updatedAt", "createdAt", "startedAt", "finishedAt", "lastDh"]);
  if (!allowed.has(field)) {
    return fallback;
  }
  return { [field]: direction } as Prisma.ProcessOrderByWithRelationInput;
}

export interface ListProcessesPagedOptions {
  page: number;
  size: number;
  status?: StatusFilter;
  empresa?: string;
  titulo?: string;
  order?: string;
}

export async function listProcessesPaged(options: ListProcessesPagedOptions) {
  const page = Number.isFinite(options.page) ? Math.max(1, Math.floor(options.page)) : 1;
  const size = Number.isFinite(options.size) ? Math.max(1, Math.min(200, Math.floor(options.size))) : 50;
  const skip = (page - 1) * size;

  const where: Prisma.ProcessWhereInput = {};
  const normalizedStatus = normalizeStatusFilter(options.status);
  if (normalizedStatus) {
    where.statusNormalized = normalizedStatus;
  }

  const companyFilters: Prisma.CompanyWhereInput = {};
  const empresa = options.empresa?.trim();
  if (empresa) {
    const digits = empresa.replace(/\D+/g, "");
    if (digits.length >= 8) {
      companyFilters.externalId = digits;
    } else {
      companyFilters.name = { contains: empresa };
    }
  }
  if (Object.keys(companyFilters).length > 0) {
    where.company = companyFilters;
  }

  const titulo = options.titulo?.trim();
  if (titulo) {
    where.title = { contains: titulo };
  }

  const orderBy = resolveOrder(options.order);

  const [items, total] = await prisma.$transaction([
    prisma.process.findMany({
      where,
      skip,
      take: size,
      orderBy,
      include: {
        company: true,
        deliveries: true,
      },
    }),
    prisma.process.count({ where }),
  ]);

  return {
    data: items,
    page,
    size,
    total,
    totalPages: Math.ceil(total / size) || 0,
  };
}

export async function countByStatus() {
  const groups = await prisma.process.groupBy({
    by: ["statusNormalized"],
    _count: { _all: true },
  });

  const summary = { concluido: 0, em_andamento: 0, outros: 0 };

  for (const group of groups) {
    const status = group.statusNormalized ?? "OUTRO";
    const count = group._count._all;
    if (status === "CONCLUIDO") {
      summary.concluido += count;
    } else if (status === "EM_ANDAMENTO") {
      summary.em_andamento += count;
    } else {
      summary.outros += count;
    }
  }

  return summary;
}
