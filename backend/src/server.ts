import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "./lib/env";
import { logger } from "./lib/logger";
import { syncRouter } from "./routes/sync";
import { dataRouter } from "./routes/data";
import { syncAll } from "./services/syncService";
import cron from "node-cron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.use("/api", syncRouter);
  app.use("/api", dataRouter);

  const webDir = path.resolve(__dirname, "..", "..", "frontend");
  app.use("/", express.static(webDir));

  app.get("/api/ready", (_req, res) => res.json({ ok: true }));

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Servidor iniciado");
    logger.info(`Web:  http://localhost:${env.PORT}/`);
    logger.info(`API ready:     http://localhost:${env.PORT}/api/ready`);
    logger.info(`API summary:   http://localhost:${env.PORT}/api/processes/summary`);
  });

  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));

  try {
    logger.info("Boot: executando sync inicial (incremental) …");
    await syncAll();
  } catch (e: any) {
    logger.error({ err: e?.message }, "Boot: sync inicial falhou (server continua)");
  }

  cron.schedule("0 */3 * * *", async () => {
    try {
      await syncAll();
    } catch (e) {
      logger.error({ err: String((e as any)?.message ?? e) }, "Scheduler sync falhou");
    }
  });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
