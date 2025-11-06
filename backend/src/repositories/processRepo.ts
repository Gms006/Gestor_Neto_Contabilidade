import { Company, Process } from "@prisma/client";
import { mapProcessStatus } from "../lib/utils";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { upsertCompanyFromApi } from "./companyRepo";
import { ensureStringId, pickDate, pickNumber, pickString, serializeValue, stringifyJson } from "./helpers";

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
  detailsMap: Map<string, RawProcess | null>
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

export interface ProcessListParams {
  status?: string;
  companyExternalId?: string;
  companyName?: string;
  title?: string;
  skip?: number;
  take?: number;
  sort?: "asc" | "desc";
}

export async function listProcessesWithFilters(params: ProcessListParams) {
  const { status, companyExternalId, companyName, title, skip = 0, take = 20, sort = "desc" } = params;

  const where: any = {};
  if (status) {
    where.statusNormalized = status;
  }
  if (companyExternalId) {
    where.company = { externalId: companyExternalId };
  }
  if (companyName) {
    where.company = {
      ...(where.company ?? {}),
      name: { contains: companyName, mode: "insensitive" },
    };
  }
  if (title) {
    where.title = { contains: title, mode: "insensitive" };
  }

  const orderBy = { updatedAt: sort } as const;

  const [items, total] = await prisma.$transaction([
    prisma.process.findMany({
      where,
      skip,
      take,
      orderBy,
      include: {
        company: true,
        deliveries: true,
      },
    }),
    prisma.process.count({ where }),
  ]);

  return { items, total };
}

export async function summarizeProcessesByStatus() {
  const groups = await prisma.process.groupBy({
    by: ["statusNormalized"],
    _count: { statusNormalized: true },
  });

  const summary = { concluidos: 0, em_andamento: 0, outros: 0 };

  for (const group of groups) {
    const status = group.statusNormalized ?? "OUTRO";
    const count = group._count.statusNormalized;
    if (status === "CONCLUIDO") {
      summary.concluidos += count;
    } else if (status === "EM_ANDAMENTO") {
      summary.em_andamento += count;
    } else {
      summary.outros += count;
    }
  }

  return summary;
}
