// src/server.ts
import express from "express";
import cors from "cors";
import path from "path";

import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { startScheduler } from "./scheduler/scheduler";
import { syncRouter } from "./routes/sync";
import { dataRouter } from "./routes/data";
import { syncAll } from "./services/syncService";

// Em CommonJS (tsconfig.module = "CommonJS") o __dirname já existe.
// Não use import.meta.url / fileURLToPath aqui.

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
