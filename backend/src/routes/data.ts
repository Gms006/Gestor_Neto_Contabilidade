import { Router } from "express";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const dataRouter = Router();

// resumo
dataRouter.get("/processes/summary", async (_req, res) => {
  const [c1, c2, c3] = await Promise.all([
    prisma.process.count({ where: { statusNorm: "CONCLUIDO" } }),
    prisma.process.count({ where: { statusNorm: "EM_ANDAMENTO" } }),
    prisma.process.count({ where: { statusNorm: "OUTRO" } })
  ]);
  res.json({ concluidos: c1, em_andamento: c2, outros: c3 });
});

// listing com filtros
async function listProcesses(req, res) {
  const pagina = Number(req.query.pagina ?? 1);
  const take = 50;
  const skip = (pagina - 1) * take;
  const status = String(req.query.status ?? "todos");
  const where: any = {};

  if (status === "concluido") where.statusNorm = "CONCLUIDO";
  else if (status === "em_andamento") where.statusNorm = "EM_ANDAMENTO";

  if (req.query.empresaId) where.companyId = String(req.query.empresaId);
  if (req.query.title) where.title = { contains: String(req.query.title), mode: "insensitive" };

  const [items, total] = await Promise.all([
    prisma.process.findMany({ where, take, skip, orderBy: { updatedAt: "desc" } }),
    prisma.process.count({ where })
  ]);

  res.json({ pagina, take, total, items });
}

dataRouter.get("/processes", listProcesses);
dataRouter.get("/processos", listProcesses);
