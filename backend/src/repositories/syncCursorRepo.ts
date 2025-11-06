import { prisma } from "../lib/prisma.js";

export async function getCursor(resource: string): Promise<{ cursor: string | null; lastRunAt: Date | null }> {
  const row = await prisma.syncCursor.findUnique({ where: { resource } });
  return { cursor: row?.cursor ?? null, lastRunAt: row?.lastRunAt ?? null };
}

export async function setCursor(
  resource: string,
  cursor: string | null,
  lastRunAt: Date | null = null
): Promise<void> {
  await prisma.syncCursor.upsert({
    where: { resource },
    create: { resource, cursor, lastRunAt },
    update: { cursor, lastRunAt },
  });
}

export async function touchCursor(resource: string, lastRunAt: Date = new Date()): Promise<void> {
  await prisma.syncCursor.upsert({
    where: { resource },
    create: { resource, cursor: null, lastRunAt },
    update: { lastRunAt },
  });
}
