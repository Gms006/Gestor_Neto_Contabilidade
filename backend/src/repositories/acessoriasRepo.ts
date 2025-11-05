import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { ACompany, ADelivery, AProcess } from "../types/acessorias";

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function coerceString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function coerceDate(value: unknown): Date | null {
  const text = coerceString(value);
  if (!text) return null;
  const parsed = new Date(text.replace("T", " "));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pickNumber(values: unknown[]): number | null {
  for (const value of values) {
    const num = coerceNumber(value);
    if (num !== null) return num;
  }
  return null;
}

function pickString(values: unknown[]): string | null {
  for (const value of values) {
    const str = coerceString(value);
    if (str) return str;
  }
  return null;
}

function pickDate(values: unknown[]): Date | null {
  for (const value of values) {
    const date = coerceDate(value);
    if (date) return date;
  }
  return null;
}

async function ensureCompany(externalId: number, name: string) {
  return prisma.company.upsert({
    where: { externalId },
    create: { externalId, name },
    update: { name },
  });
}

export async function upsertCompaniesBatch(companies: ACompany[]) {
  for (const company of companies) {
    const externalId = pickNumber([
      (company as any)?.idAcessorias,
      (company as any)?.id,
      (company as any)?.externalId,
      (company as any)?.EmpCod,
    ]);
    if (externalId === null) {
      logger.warn({ company }, "Ignorando empresa sem identificador externo");
      continue;
    }

    const name =
      pickString([
        (company as any)?.nome,
        (company as any)?.name,
        (company as any)?.razaoSocial,
        (company as any)?.fantasia,
      ]) ?? `Empresa ${externalId}`;

    try {
      await ensureCompany(externalId, name);
    } catch (error: any) {
      logger.error({ err: error?.message, externalId }, "Falha ao upsert de empresa");
    }
  }
}

export async function upsertProcessesBatch(processes: AProcess[]) {
  let processesCount = 0;

  for (const process of processes) {
    const externalId = pickNumber([
      (process as any)?.idAcessorias,
      (process as any)?.id,
      (process as any)?.externalId,
      (process as any)?.ProcCod,
      (process as any)?.procCod,
    ]);
    if (externalId === null) {
      logger.warn({ process }, "Ignorando processo sem identificador externo");
      continue;
    }

    const companyPayload = (process as any)?.company ?? (process as any)?.empresa;
    const companyExternalId = pickNumber([
      (process as any)?.empresaId,
      (process as any)?.companyId,
      companyPayload?.idAcessorias,
      companyPayload?.id,
      companyPayload?.externalId,
      (process as any)?.EmpCod,
    ]);

    if (companyExternalId === null) {
      logger.warn({ process }, "Ignorando processo sem empresa associada");
      continue;
    }

    const companyName =
      pickString([
        companyPayload?.nome,
        companyPayload?.name,
        companyPayload?.razaoSocial,
        (process as any)?.empresaNome,
      ]) ?? `Empresa ${companyExternalId}`;

    const company = await ensureCompany(companyExternalId, companyName);

    const title =
      pickString([
        (process as any)?.titulo,
        (process as any)?.title,
        (process as any)?.ProcTitulo,
        (process as any)?.descricao,
      ]) ?? `Processo ${externalId}`;

    const department = pickString([
      (process as any)?.departamento,
      (process as any)?.department,
      (process as any)?.ProcDepartamento,
    ]);

    const statusRaw =
      pickString([
        (process as any)?.status,
        (process as any)?.ProcStatus,
        (process as any)?.statusRaw,
      ]) ?? "";

    const progress = pickNumber([
      (process as any)?.progress,
      (process as any)?.ProcPercentual,
      (process as any)?.percentual,
    ]);

    const startedAt = pickDate([
      (process as any)?.dataInicio,
      (process as any)?.startedAt,
      (process as any)?.ProcDtInicio,
    ]);

    const finishedAt = pickDate([
      (process as any)?.dataConclusao,
      (process as any)?.finishedAt,
      (process as any)?.ProcDtFim,
    ]);

    const lastDh = pickDate([
      (process as any)?.DtLastDH,
      (process as any)?.dtLastDh,
      (process as any)?.lastDH,
    ]);

    try {
      await prisma.process.upsert({
        where: { externalId },
        create: {
          externalId,
          companyId: company.id,
          title,
          department: department ?? null,
          statusRaw,
          progress: progress ?? null,
          startedAt: startedAt ?? null,
          finishedAt: finishedAt ?? null,
          lastDH: lastDh ?? null,
        },
        update: {
          companyId: company.id,
          title,
          department: department ?? null,
          statusRaw,
          progress: progress ?? null,
          startedAt: startedAt ?? null,
          finishedAt: finishedAt ?? null,
          lastDH: lastDh ?? null,
        },
      });
      processesCount += 1;
    } catch (error: any) {
      logger.error({ err: error?.message, externalId }, "Falha ao upsert de processo");
    }
  }

  return { processes: processesCount, steps: 0 };
}

export async function upsertDeliveriesBatch(deliveries: ADelivery[]) {
  const processCache = new Map<number, string | null>();

  for (const delivery of deliveries) {
    const externalId = pickNumber([
      (delivery as any)?.idAcessorias,
      (delivery as any)?.id,
      (delivery as any)?.externalId,
      (delivery as any)?.EntCod,
    ]);
    if (externalId === null) {
      logger.warn({ delivery }, "Ignorando entrega sem identificador externo");
      continue;
    }

    const processExternalId = pickNumber([
      (delivery as any)?.processId,
      (delivery as any)?.processoId,
      (delivery as any)?.ProcCod,
      (delivery as any)?.ProcessCod,
    ]);

    let processId: string | null = null;
    if (processExternalId !== null) {
      if (processCache.has(processExternalId)) {
        processId = processCache.get(processExternalId) ?? null;
      } else {
        const process = await prisma.process.findUnique({
          where: { externalId: processExternalId },
        });
        processId = process?.id ?? null;
        processCache.set(processExternalId, processId);
      }
    }

    const type = pickString([
      (delivery as any)?.tipo,
      (delivery as any)?.type,
      (delivery as any)?.deliveryType,
    ]);

    const statusRaw = pickString([
      (delivery as any)?.status,
      (delivery as any)?.situacao,
      (delivery as any)?.statusRaw,
    ]);

    const occurredAt = pickDate([
      (delivery as any)?.dataEvento,
      (delivery as any)?.occurredAt,
      (delivery as any)?.vencimento,
      (delivery as any)?.DtEvento,
    ]);

    try {
      await prisma.delivery.upsert({
        where: { externalId },
        create: {
          externalId,
          processId: processId ?? null,
          type: type ?? null,
          statusRaw: statusRaw ?? null,
          occurredAt: occurredAt ?? null,
        },
        update: {
          processId: processId ?? null,
          type: type ?? null,
          statusRaw: statusRaw ?? null,
          occurredAt: occurredAt ?? null,
        },
      });
    } catch (error: any) {
      logger.error({ err: error?.message, externalId }, "Falha ao upsert de entrega");
    }
  }
}

export async function listProcessesWithFilters(params: {
  status?: string;
  companyName?: string;
  title?: string;
  skip: number;
  take: number;
}) {
  const { status, companyName, title, skip, take } = params;
  const where: Record<string, unknown> = {};

  if (status) {
    where.statusRaw = status;
  }

  if (companyName) {
    where.company = {
      name: { contains: companyName, mode: "insensitive" },
    };
  }

  if (title) {
    where.title = { contains: title, mode: "insensitive" };
  }

  const [items, total] = await prisma.$transaction([
    prisma.process.findMany({
      where,
      skip,
      take,
      orderBy: { updatedAt: "desc" },
      include: {
        company: true,
        Deliveries: true,
      },
    }),
    prisma.process.count({ where }),
  ]);

  return { items, total };
}

export async function summarizeProcessesByStatus() {
  const groups = await prisma.process.groupBy({
    by: ["statusRaw"],
    _count: { statusRaw: true },
  });

  const summary = { concluidos: 0, em_andamento: 0, outros: 0 };

  for (const group of groups) {
    const count = group._count.statusRaw;
    if (group.statusRaw === "C") {
      summary.concluidos += count;
    } else if (group.statusRaw === "A") {
      summary.em_andamento += count;
    } else {
      summary.outros += count;
    }
  }

  return summary;
}

export async function getSyncState(key: string) {
  const row = await prisma.syncState.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSyncState(key: string, value: string) {
  await prisma.syncState.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
