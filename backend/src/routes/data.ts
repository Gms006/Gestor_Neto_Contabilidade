// src/routes/data.ts
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { mapProcessStatus } from "../lib/utils.js";

export const dataRouter = Router();

dataRouter.get("/processes/summary", async (_req, res) => {
  // Contagem baseada no status mapeado (CONCLUIDO, EM_ANDAMENTO, OUTRO)
  const processes = await prisma.process.findMany({
    select: { statusRaw: true, progress: true },
  });

  const summary = processes.reduce(
    (acc, p) => {
      const status = mapProcessStatus(p.statusRaw, p.progress);
      if (status === "CONCLUIDO") acc.concluidos++;
      else if (status === "EM_ANDAMENTO") acc.em_andamento++;
      else acc.outros++;
      return acc;
    },
    { concluidos: 0, em_andamento: 0, outros: 0 }
  );

  res.json({
    totals: summary,
    updatedAt: new Date().toISOString(),
  });
});

dataRouter.get("/processes", async (req, res) => {
  const { status, page = 1, pageSize = 10, empresa, titulo, orderBy = "updatedAt", dir = "desc" } = req.query;

  const pageNumber = Number(page);
  const pageSizeNumber = Number(pageSize);

  const where: any = {};
  
  // 1. Filtro por status mapeado
  if (status === "concluido") {
    // Busca processos que seriam mapeados como CONCLUIDO
    where.OR = [
      { statusRaw: { contains: "Concluído", mode: "insensitive" } },
      { statusRaw: { contains: "Finalizado", mode: "insensitive" } },
      { progress: { gte: 100 } },
    ];
  } else if (status === "em_andamento") {
    // Busca processos que seriam mapeados como EM_ANDAMENTO
    where.OR = [
      { statusRaw: { contains: "Em andamento", mode: "insensitive" } },
      { progress: { lt: 100, gt: 0 } },
    ];
  } else if (status === "outro") {
    // Busca processos que seriam mapeados como OUTRO (lógica inversa)
    // Esta lógica é complexa para o Prisma, então vamos simplificar e focar nos principais.
    // Por enquanto, vamos ignorar o filtro 'outro' para evitar consultas complexas demais.
  }

  // 2. Filtro por empresa (nome)
  if (empresa) {
    where.company = { name: { contains: empresa as string, mode: "insensitive" } };
  }

  // 3. Filtro por título (ILIKE)
  if (titulo) {
    where.title = { contains: titulo as string, mode: "insensitive" };
  }

  const processes = await prisma.process.findMany({
    where,
    skip: (pageNumber - 1) * pageSizeNumber,
    take: pageSizeNumber,
    orderBy: {
      [orderBy as string]: dir,
    },
    include: {
      company: true,
      Deliveries: true, // Incluir Deliveries para contexto
    },
  });

  const total = await prisma.process.count({ where });

  res.json({ data: processes, total, page: pageNumber, pageSize: pageSizeNumber });
});
