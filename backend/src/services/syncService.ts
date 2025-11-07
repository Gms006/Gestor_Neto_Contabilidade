import { addMonths, format } from "date-fns";
import { acessoriasClient } from "../clients/acessoriasClient.js";
import { upsertCompany, upsertProcess, upsertDelivery, updateProcessStatusNorm, getCursor, saveCursor } from "../repositories/acessoriasRepo.js";
import { mapProcessStatus } from "../lib/utils.js";
import { logger } from "../lib/logger.js";

type SyncOpts = { full?: boolean; monthsHistory?: number; statuses?: "ALL" };

async function fetchPaged(resource: "companies"|"processes"|"deliveries", makeUrl: (page:number)=>string) {
  const client = acessoriasClient.makeClient();
  const results: any[] = [];
  for (let page = 1; page < 9999; page++) {
    const url = makeUrl(page);
    logger.info(`Fetching page ${page} from ${url}`);
    const data = await acessoriasClient.fetchWithRetry<any>(client, url);
    const items = Array.isArray(data) ? data : (Array.isArray(data?.results) ? data.results : []);
    if (!items.length) break;
    results.push(...items);
    if (items.length < 50) break;
  }
  return results;
}

export async function syncAll(opts: SyncOpts = { full: false, monthsHistory: 6, statuses: "ALL" }) {
  logger.info({ full: opts.full, opts }, "Iniciando syncAll");

  try {
    const companies = await fetchPaged("companies", (page) =>
      acessoriasClient.buildUrl("companies", { identificador: "ListAll", pagina: page })
    );
    for (const c of companies) await upsertCompany(c);
    logger.info({ total: companies.length }, "syncCompanies concluído");
  } catch (e: any) {
    logger.warn({ err: String(e?.message ?? e) }, "Companies não sincronizadas (erro). Seguindo…");
  }

  const now = new Date();
  const lastDH = (await getCursor()) ?? addMonths(now, -(opts.monthsHistory ?? 6));
  const dtLastDH = format(lastDH, "yyyy-MM-dd HH:mm:ss");

  try {
    const processes = await fetchPaged("processes", (page) =>
      acessoriasClient.buildUrl("processes", {
        identificador: "ListAll",
        pagina: page,
        dtLastDH
      })
    );
    for (const p of processes) {
      const companyId = undefined;
      const proc = await upsertProcess(p, companyId);
      const norm = mapProcessStatus(proc.statusRaw ?? undefined, proc.progress ?? undefined as any);
      await updateProcessStatusNorm(proc.externalId, norm);
    }
    logger.info({ totalProcesses: processes.length, full: opts.full }, "syncProcesses concluído");
  } catch (e: any) {
    logger.warn({ err: String(e?.message ?? e) }, "Processes não sincronizados (erro). Seguindo…");
  }

  try {
    const dtInitial = format(addMonths(now, -3), "yyyy-MM-dd");
    const dtFinal   = format(now, "yyyy-MM-dd");
    const deliveries = await fetchPaged("deliveries", (page) =>
      acessoriasClient.buildUrl("deliveries", {
        identificador: "ListAll",
        dtInitial, dtFinal,
        pagina: page
      })
    );
    for (const d of deliveries) {
      const companyId = undefined;
      const processId = undefined;
      await upsertDelivery(d, companyId, processId);
    }
    logger.info({ total: deliveries.length, full: opts.full }, "syncDeliveries concluído");
  } catch (e: any) {
    logger.warn({ err: String(e?.message ?? e) }, "Deliveries não sincronizadas (erro). Seguindo…");
  }

  await saveCursor(now);
  logger.info({ companies: "ok", processes: "ok", deliveries: "ok" }, "syncAll concluído");
}
