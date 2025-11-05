// src/routes/sync.ts
import { Router } from "express";
import { syncAll, getMeta } from "../services/syncService";

export const syncRouter = Router();

/**
 * POST /api/sync
 * Body opcional:
 *   { full?: boolean, monthsHistory?: number, statuses?: string[] | "ALL" }
 */
syncRouter.post("/sync", async (req, res) => { // Rota POST /api/sync
  try {
    const { full = false, monthsHistory = 6, statuses = "ALL" } = req.body || {};
    const result = await syncAll({ full, monthsHistory, statuses });
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "Erro ao sincronizar" });
  }
});

syncRouter.get("/meta", async (_req, res) => { // Rota GET /api/meta
  const meta = await getMeta();
  res.json({ ok: true, meta });
});

syncRouter.get("/health", async (_req, res) => {
  res.json({ ok: true, status: "up" });
});
