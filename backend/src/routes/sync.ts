import { Router } from "express";
import { syncAll } from "../services/syncService";

export const syncRouter = Router();

syncRouter.post("/sync/run", async (_req, res) => {
  try {
    await syncAll();
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});
