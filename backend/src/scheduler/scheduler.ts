// src/scheduler/scheduler.ts
import cron, { ScheduledTask } from "node-cron";
import { logger } from "../lib/logger.js";
import { syncAll } from "../services/syncService.js";

let task: ScheduledTask | null = null;

/**
 * CRON: minuto 0, de 3 em 3 horas (00:00, 03:00, 06:00, …)
 */
const CRON_EXPR = "0 */3 * * *";

export function startScheduler() {
  if (task) {
    logger.warn("Scheduler já estava iniciado — reiniciando.");
    task.stop();
  }

  task = cron.schedule(CRON_EXPR, async () => {
    try {
      logger.info("Scheduler: executando sync incremental (3/3h) …");
      await syncAll({ full: false, monthsHistory: 6, statuses: "ALL" });
    } catch (e: any) {
      logger.error({ err: e?.message }, "Scheduler: falha durante syncAll");
    }
  });

  task.start();
  logger.info({ schedule: CRON_EXPR }, "Scheduler iniciado");
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
    logger.info("Scheduler parado");
  }
}
