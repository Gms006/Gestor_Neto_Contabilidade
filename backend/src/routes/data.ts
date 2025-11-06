import { Router } from "express";
import { logger } from "../lib/logger.js";
import { countByStatus, listProcessesPaged } from "../repositories/processRepo.js";

export const dataRouter = Router();

dataRouter.get("/processes/summary", async (_req, res) => {
  try {
    const summary = await countByStatus();
    res.json(summary);
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Falha ao gerar resumo de processos");
    res.status(500).json({ message: "Erro ao gerar resumo" });
  }
});

dataRouter.get("/processes", async (req, res) => {
  try {
    const { page = "1", size = "50", empresa = "", titulo = "", order = "-updatedAt" } =
      req.query as Record<string, string>;

    const statusRaw = typeof req.query.status === 'string' ? req.query.status.toLowerCase() : 'todos';
    const allowedStatuses = new Set(['concluido', 'em_andamento', 'todos']);
    const status = (allowedStatuses.has(statusRaw) ? statusRaw : 'todos') as 'concluido' | 'em_andamento' | 'todos';

    const result = await listProcessesPaged({
      page: Number(page),
      size: Number(size),
      status,
      empresa,
      titulo,
      order,
    });

    res.json(result);
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Falha ao listar processos");
    res.status(500).json({ message: "Erro ao listar processos" });
  }
});
