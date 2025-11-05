// src/routes/data.ts
import { Router } from "express";
import { logger } from "../lib/logger";
import {
  listProcessesWithFilters,
  summarizeProcessesByStatus,
} from "../repositories/acessoriasRepo";

export const dataRouter = Router();
const STATUS_QUERY_TO_CODE: Record<string, string | undefined> = {
  em_andamento: "A",
  concluidos: "C",
  todos: undefined,
};

dataRouter.get("/processes", async (req, res) => {
  try {
    const statusParam = typeof req.query.status === "string" ? req.query.status : "todos";
    const statusCode = STATUS_QUERY_TO_CODE[statusParam] ?? undefined;

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
    const skip = (page - 1) * pageSize;

    const empresa = typeof req.query.empresa === "string" ? req.query.empresa : undefined;
    const titulo = typeof req.query.titulo === "string" ? req.query.titulo : undefined;

    const { items, total } = await listProcessesWithFilters({
      status: statusCode,
      companyName: empresa,
      title: titulo,
      skip,
      take: pageSize,
    });

    res.json({
      data: items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error: any) {
    logger.error({ err: error?.message }, "Falha ao listar processos");
    res.status(500).json({ message: "Erro ao listar processos" });
  }
});

dataRouter.get("/processes/summary", async (_req, res) => {
  try {
    const totals = await summarizeProcessesByStatus();
    res.json({ ...totals, updatedAt: new Date().toISOString() });
  } catch (error: any) {
    logger.error({ err: error?.message }, "Falha ao gerar resumo de processos");
    res.status(500).json({ message: "Erro ao gerar resumo" });
  }
});
