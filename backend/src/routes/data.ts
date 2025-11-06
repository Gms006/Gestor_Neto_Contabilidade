import { Router } from "express";
import { logger } from "../lib/logger";
import { listProcessesWithFilters, summarizeProcessesByStatus } from "../repositories/processRepo";

export const dataRouter = Router();

const STATUS_QUERY_TO_NORMALIZED: Record<string, string | undefined> = {
  concluidos: "CONCLUIDO",
  concluido: "CONCLUIDO",
  "em_andamento": "EM_ANDAMENTO",
  andamento: "EM_ANDAMENTO",
  pendentes: "EM_ANDAMENTO",
  outros: "OUTRO",
  all: undefined,
  todos: undefined,
};

dataRouter.get("/processes", async (req, res) => {
  try {
    const statusQuery =
      typeof req.query.status === "string" ? req.query.status.toLowerCase() : "all";
    const statusNormalized = STATUS_QUERY_TO_NORMALIZED[statusQuery] ?? undefined;

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 20)));
    const skip = (page - 1) * pageSize;

    const empresa =
      typeof req.query.empresa === "string" ? req.query.empresa.trim() : undefined;
    const titulo =
      typeof req.query.titulo === "string" ? req.query.titulo.trim() : undefined;
    const sortParam = typeof req.query.sort === "string" ? req.query.sort.toLowerCase() : "desc";
    const sort: "asc" | "desc" = sortParam === "asc" ? "asc" : "desc";

    let companyExternalId: string | undefined;
    let companyName: string | undefined;
    if (empresa) {
      const digits = empresa.replace(/\D+/g, "");
      if (digits.length >= 8) {
        companyExternalId = digits;
      } else {
        companyName = empresa;
      }
    }

    const { items, total } = await listProcessesWithFilters({
      status: statusNormalized,
      companyExternalId,
      companyName,
      title: titulo,
      skip,
      take: pageSize,
      sort,
    });

    res.json({
      data: items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Falha ao listar processos");
    res.status(500).json({ message: "Erro ao listar processos" });
  }
});

dataRouter.get("/processes/summary", async (_req, res) => {
  try {
    const summary = await summarizeProcessesByStatus();
    res.json({ ...summary, updatedAt: new Date().toISOString() });
  } catch (error) {
    logger.error({ err: (error as Error).message }, "Falha ao gerar resumo de processos");
    res.status(500).json({ message: "Erro ao gerar resumo" });
  }
});
