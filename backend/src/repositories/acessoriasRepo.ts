import { PrismaClient } from "@prisma/client";
import { safeStringify } from "../lib/json";

const prisma = new PrismaClient();

type Nullable<T> = T | null | undefined;

type SyncKind = "companies" | "processes" | "deliveries";

export async function upsertCompany(input: {
  externalId: string;
  name: string;
  identifier?: Nullable<string>;
  email?: Nullable<string>;
  raw?: unknown;
}) {
  return prisma.company.upsert({
    where: { externalId: input.externalId },
    create: {
      externalId: input.externalId,
      name: input.name,
      identifier: input.identifier ?? null,
      email: input.email ?? null,
      raw: safeStringify(input.raw),
    },
    update: {
      name: input.name,
      identifier: input.identifier ?? null,
      email: input.email ?? null,
      raw: safeStringify(input.raw),
    },
  });
}

export async function upsertProcess(input: {
  externalId: string;
  title: string;
  statusRaw?: Nullable<string>;
  statusNorm?: Nullable<string>;
  progress?: Nullable<number>;
  companyId?: Nullable<string>;
  raw?: unknown;
}) {
  return prisma.process.upsert({
    where: { externalId: input.externalId },
    create: {
      externalId: input.externalId,
      title: input.title,
      statusRaw: input.statusRaw ?? null,
      statusNorm: input.statusNorm ?? null,
      progress: input.progress ?? null,
      companyId: input.companyId ?? null,
      raw: safeStringify(input.raw),
    },
    update: {
      title: input.title,
      statusRaw: input.statusRaw ?? null,
      statusNorm: input.statusNorm ?? null,
      progress: input.progress ?? null,
      companyId: input.companyId ?? null,
      raw: safeStringify(input.raw),
    },
  });
}

export async function upsertDelivery(input: {
  externalId: string;
  name?: Nullable<string>;
  status?: Nullable<string>;
  dueDate?: Nullable<Date>;
  processId?: Nullable<string>;
  companyId?: Nullable<string>;
  payload?: unknown;
}) {
  return prisma.delivery.upsert({
    where: { externalId: input.externalId },
    create: {
      externalId: input.externalId,
      name: input.name ?? null,
      status: input.status ?? null,
      dueDate: input.dueDate ?? null,
      processId: input.processId ?? null,
      companyId: input.companyId ?? null,
      payload: safeStringify(input.payload),
    },
    update: {
      name: input.name ?? null,
      status: input.status ?? null,
      dueDate: input.dueDate ?? null,
      processId: input.processId ?? null,
      companyId: input.companyId ?? null,
      payload: safeStringify(input.payload),
    },
  });
}

export function findCompanyByExternalId(externalId: string) {
  return prisma.company.findUnique({ where: { externalId } });
}

export function findProcessByExternalId(externalId: string) {
  return prisma.process.findUnique({ where: { externalId } });
}

export function listCompanies() {
  return prisma.company.findMany();
}

export async function saveSyncCursor(kind: SyncKind, lastDh: Date | null) {
  return prisma.syncCursor.upsert({
    where: { kind },
    create: { kind, lastDh },
    update: { lastDh },
  });
}

export async function getSyncCursor(kind: SyncKind): Promise<Date | null> {
  const cursor = await prisma.syncCursor.findUnique({ where: { kind } });
  return cursor?.lastDh ?? null;
}
