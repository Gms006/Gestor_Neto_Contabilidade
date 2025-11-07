import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { formatISO, mapProcessStatus } from "../lib/utils";

const prisma = new PrismaClient();
const EXPORT_PAGE_SIZE = 10000;

function formatDateSuffix(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

async function dumpProcesses(): Promise<string> {
  const outDir = path.resolve(process.cwd(), "out");
  await mkdir(outDir, { recursive: true });

  const fileName = `processes_${formatDateSuffix(new Date())}.txt`;
  const filePath = path.join(outDir, fileName);

  const stream = createWriteStream(filePath, { encoding: "utf-8" });

  let skip = 0;

  while (true) {
    const processes = await prisma.process.findMany({
      skip,
      take: EXPORT_PAGE_SIZE,
      orderBy: { createdAt: "asc" },
      include: {
        company: {
          select: {
            identifier: true,
            name: true,
          },
        },
      },
    });

    if (!processes.length) {
      break;
    }

    for (const proc of processes) {
      const status = mapProcessStatus(proc.statusRaw ?? undefined, proc.progress);
      const line = [
        proc.id,
        proc.title,
        status.toLowerCase(),
        proc.company?.identifier ?? "",
        proc.company?.name ?? "",
        formatISO(proc.createdAt),
        formatISO(proc.updatedAt),
      ].join("\t");
      if (!stream.write(`${line}\n`)) {
        await new Promise((resolve) => stream.once("drain", resolve));
      }
    }

    skip += processes.length;
    if (processes.length < EXPORT_PAGE_SIZE) {
      break;
    }
  }

  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on("error", (err) => reject(err));
  });

  return filePath;
}

async function main(): Promise<void> {
  try {
    const filePath = await dumpProcesses();
    console.log(`Export concluído: ${filePath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Erro ao exportar processos", err);
  process.exitCode = 1;
});
