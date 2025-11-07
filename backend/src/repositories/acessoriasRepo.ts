import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function upsertCompany(dto: any) {
  return prisma.company.upsert({
    where: { externalId: String(dto.ID ?? dto.id ?? dto.externalId) },
    create: {
      externalId: String(dto.ID ?? dto.id ?? dto.externalId),
      cnpj: dto.CNPJ ?? dto.cnpj ?? null,
      name: dto.Nome ?? dto.name ?? dto.RazaoSocial ?? null,
      email: dto.Email ?? dto.email ?? null,
      raw: dto
    },
    update: {
      cnpj: dto.CNPJ ?? dto.cnpj ?? null,
      name: dto.Nome ?? dto.name ?? dto.RazaoSocial ?? null,
      email: dto.Email ?? dto.email ?? null,
      raw: dto
    }
  });
}

export async function upsertProcess(dto: any, companyId?: string) {
  const externalId = String(dto.ID ?? dto.id ?? dto.externalId);
  const progress = typeof dto.Progress === "number" ? dto.Progress : (dto.progress ?? null);
  return prisma.process.upsert({
    where: { externalId },
    create: {
      externalId,
      title: dto.Title ?? dto.title ?? null,
      statusRaw: dto.Status ?? dto.status ?? null,
      statusNorm: null,
      progress: progress ?? null,
      startedAt: dto.StartDate ? new Date(dto.StartDate) : null,
      finishedAt: dto.EndDate ? new Date(dto.EndDate) : null,
      companyId: companyId ?? null,
      raw: dto
    },
    update: {
      title: dto.Title ?? dto.title ?? null,
      statusRaw: dto.Status ?? dto.status ?? null,
      progress: progress ?? null,
      startedAt: dto.StartDate ? new Date(dto.StartDate) : null,
      finishedAt: dto.EndDate ? new Date(dto.EndDate) : null,
      companyId: companyId ?? null,
      raw: dto
    }
  });
}

export async function upsertDelivery(dto: any, companyId?: string, processId?: string) {
  const externalId = String(dto.ID ?? dto.id ?? dto.externalId);
  return prisma.delivery.upsert({
    where: { externalId },
    create: {
      externalId,
      title: dto.Title ?? dto.title ?? null,
      competence: dto.Competence ?? dto.competencia ?? null,
      situation: dto.Status ?? dto.situacao ?? null,
      dueDate: dto.DueDate ? new Date(dto.DueDate) : null,
      payload: dto,
      companyId: companyId ?? null,
      processId: processId ?? null
    },
    update: {
      title: dto.Title ?? dto.title ?? null,
      competence: dto.Competence ?? dto.competencia ?? null,
      situation: dto.Status ?? dto.situacao ?? null,
      dueDate: dto.DueDate ? new Date(dto.DueDate) : null,
      payload: dto,
      companyId: companyId ?? null,
      processId: processId ?? null
    }
  });
}

export async function updateProcessStatusNorm(processExternalId: string, statusNorm: string) {
  return prisma.process.update({
    where: { externalId: processExternalId },
    data: { statusNorm }
  });
}

export async function saveCursor(dt: Date) {
  return prisma.syncCursor.upsert({
    where: { id: "global" },
    create: { id: "global", lastDH: dt },
    update: { lastDH: dt }
  });
}

export async function getCursor(): Promise<Date | null> {
  const c = await prisma.syncCursor.findUnique({ where: { id: "global" } });
  return c?.lastDH ?? null;
}
