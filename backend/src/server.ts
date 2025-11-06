// src/server.ts
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { startScheduler } from "./scheduler/scheduler.js";
import { syncRouter } from "./routes/sync.js";
import { dataRouter } from "./routes/data.js";
import { syncAll } from "./services/syncService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  // Rotas de API
  app.use("/api", syncRouter);
  app.use("/api", dataRouter);

  // Healthcheck
  app.get("/api/ready", (_req, res) => res.json({ ok: true }));

  // Servir o frontend pela raiz
  const webDir = path.resolve(__dirname, "..", "..", "frontend");
  app.use("/", express.static(webDir));

  const port = env.PORT ?? 3000;
  const server = app.listen(port, () => {
    logger.info({ port }, "Servidor iniciado");
    logger.info(`Web:  http://localhost:${port}/`);
    logger.info(`API:  http://localhost:${port}/api/ready`);
  });

  // Graceful shutdown
  function shutdown(sig: string) {
    logger.info({ sig }, "Encerrando servidor…");
    server.close(() => {
      logger.info("HTTP fechado. Até mais! 👋");
      process.exit(0);
    });
  }
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Sincronização inicial (incremental) – não bloqueante pro server subir
  try {
    logger.info("Boot: executando sync inicial (incremental) …");
    await syncAll({ full: false, monthsHistory: 6, statuses: "ALL" });
  } catch (e: any) {
    logger.error({ err: e?.message }, "Boot: sync inicial falhou (seguindo com server up)");
  }

  // Scheduler 3/3h
  startScheduler();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
