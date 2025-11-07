import axios, { AxiosInstance } from "axios";
import { env } from "../lib/env.js";
import { logger } from "../lib/logger.js";

function buildUrl(
  resource: "companies" | "processes" | "deliveries",
  opts: {
    identificador?: string; // "ListAll" ou CNPJ/CPF/ID
    pagina?: number;
    procStatus?: "Concluido" | "Em andamento" | "Outro";
    title?: string;
    id?: string | number;
    dtLastDH?: string; // "YYYY-MM-DD HH:MM:SS"
    dtInitial?: string; // "YYYY-MM-DD"
    dtFinal?: string;   // "YYYY-MM-DD"
  }
) {
  const base = env.ACESSORIAS_BASE_URL;
  const ident = opts.identificador ?? "ListAll";
  const u = new URL(base);

  if (resource === "companies") {
    u.pathname = `/companies/${ident}`;
    if (opts.pagina) u.searchParams.set("Pagina", String(opts.pagina));
  } else if (resource === "processes") {
    u.pathname = ident === "ListAll" ? `/processes/ListAll` : `/processes/${ident}`;
    if (opts.pagina) u.searchParams.set("Pagina", String(opts.pagina));
    if (opts.procStatus) u.searchParams.set("ProcStatus", opts.procStatus);
    if (opts.title) u.searchParams.set("Title", opts.title);
    if (opts.id) u.searchParams.set("ID", String(opts.id));
    if (opts.dtLastDH) u.searchParams.set("DtLastDH", opts.dtLastDH);
  } else if (resource === "deliveries") {
    u.pathname = `/deliveries/${ident}/`;
    if (opts.dtInitial) u.searchParams.set("DtInitial", opts.dtInitial);
    if (opts.dtFinal) u.searchParams.set("DtFinal", opts.dtFinal);
    if (opts.dtLastDH) u.searchParams.set("DtLastDH", opts.dtLastDH);
    if (opts.pagina) u.searchParams.set("Pagina", String(opts.pagina));
  }
  return u.toString();
}

function makeClient(): AxiosInstance {
  const instance = axios.create({
    headers: {
      Authorization: `Bearer ${env.ACESSORIAS_TOKEN}`,
      "User-Agent": "NetoContabilidade-Gestor/1.0",
      Accept: "application/json"
    },
    timeout: 30000
  });
  return instance;
}

async function fetchWithRetry<T>(client: AxiosInstance, url: string, tries = 3): Promise<T> {
  let lastErr: any;
  for (let i = 1; i <= tries; i++) {
    try {
      const { data } = await client.get<T>(url);
      return data;
    } catch (err: any) {
      lastErr = err;
      logger.error({ url, status: err?.response?.status }, `HTTP fail try ${i}/${tries}`);
      await new Promise(res => setTimeout(res, 200 + Math.random() * 400));
    }
  }
  throw lastErr;
}

export const acessoriasClient = {
  buildUrl,
  makeClient,
  fetchWithRetry
};
