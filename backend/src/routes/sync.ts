import { Router } from "express";
import { syncAll } from "../services/syncService.js";

export const syncRouter = Router();

syncRouter.post("/sync/run", async (req, res) => {
  try {
    const body = req.body ?? {};
    await syncAll(body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});
