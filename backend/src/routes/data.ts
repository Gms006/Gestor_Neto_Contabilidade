import { Router, Request, Response } from "express";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

export const dataRouter = Router();

dataRouter.get("/processes/summary", async (_req: Request, res: Response) => {
  const [concluidos, emAndamento, outros] = await Promise.all([
    prisma.process.count({ where: { statusNorm: "CONCLUIDO" } }),
    prisma.process.count({ where: { statusNorm: "EM_ANDAMENTO" } }),
    prisma.process.count({ where: { statusNorm: "OUTRO" } }),
  ]);
  res.json({ concluidos, em_andamento: emAndamento, outros });
});

const PAGE_SIZE = 50;

dataRouter.get("/processes", async (req: Request, res: Response) => {
  const paginaRaw = typeof req.query.pagina === "string" ? req.query.pagina : String(req.query.pagina ?? "1");
  const paginaParsed = Number.parseInt(paginaRaw, 10);
  const pagina = Number.isFinite(paginaParsed) && paginaParsed > 0 ? paginaParsed : 1;
  const skip = (pagina - 1) * PAGE_SIZE;

  const statusParam = typeof req.query.status === "string" ? req.query.status.toLowerCase() : "todos";
  const where: Prisma.ProcessWhereInput = {};
  if (statusParam === "em_andamento") {
    where.statusNorm = "EM_ANDAMENTO";
  } else if (statusParam === "concluido") {
    where.statusNorm = "CONCLUIDO";
  }

  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (search) {
    where.title = { contains: search, mode: "insensitive" };
  }

  const [items, total] = await Promise.all([
    prisma.process.findMany({
      where,
      take: PAGE_SIZE,
      skip,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.process.count({ where }),
  ]);

  res.json({ pagina, take: PAGE_SIZE, total, items });
});

