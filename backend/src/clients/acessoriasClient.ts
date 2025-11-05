import axios from "axios";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { ACompany, ADelivery, AProcess } from "../types/acessorias";

type Resource = "companies" | "processes" | "deliveries";

type QueryParams = Record<string, string | number | undefined>;

const MAX_RETRIES = 3;

export function buildUrl(
  resource: Resource,
  ident: "Geral" | "ListAll" | string,
  qp: QueryParams = {}
) {
  const base = env.ACESSORIAS_API_BASE ?? "https://api.acessorias.com";
  const url = new URL(`${base}/${resource}/${ident}/`);
  Object.entries(qp).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

const http = axios.create({
  timeout: 60000,
  headers: {
    Authorization: `Bearer ${env.ACESSORIAS_TOKEN}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "NetoContabilidade-Gestor/1.0",
  },
});

function extractResults<T>(payload: any): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray(payload?.results)) return payload.results as T[];
  if (Array.isArray(payload?.data)) return payload.data as T[];
  if (Array.isArray(payload?.items)) return payload.items as T[];
  return [];
}

async function fetchWithRetry<T>(
  resource: Resource,
  ident: "Geral" | "ListAll" | string,
  qp: QueryParams = {}
): Promise<T[]> {
  let attempt = 0;
  const url = buildUrl(resource, ident, qp);

  while (attempt < MAX_RETRIES) {
    try {
      logger.info(
        { resource, ident, qp, url, attempt },
        "Solicitando dados da Acessórias"
      );
      const response = await http.get(url);
      const items = extractResults<T>(response.data);
      logger.info(
        { resource, ident, count: items.length, url },
        "Página processada da Acessórias"
      );
      return items;
    } catch (error: any) {
      attempt += 1;
      const status = error?.response?.status;
      logger.error(
        { resource, ident, qp, status, attempt, err: error?.message },
        "Falha ao consultar Acessórias"
      );
      if (attempt >= MAX_RETRIES) {
        throw error;
      }
      const delay = Math.pow(2, attempt) * 100 + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return [];
}

export async function listCompanies(page: number): Promise<ACompany[]> {
  return fetchWithRetry<ACompany>("companies", "Geral", { Pagina: page });
}

export async function listProcesses(params: {
  page: number;
  ProcStatus?: string;
  DtLastDH?: string;
  DtInitial?: string;
  DtFinal?: string;
}): Promise<AProcess[]> {
  const { page, ...rest } = params;
  return fetchWithRetry<AProcess>("processes", "ListAll", {
    Pagina: page,
    ...rest,
  });
}

export async function listDeliveries(params: {
  page: number;
  DtInitial: string;
  DtFinal: string;
  DtLastDH: string;
}): Promise<ADelivery[]> {
  const { page, ...rest } = params;
  return fetchWithRetry<ADelivery>("deliveries", "ListAll", {
    Pagina: page,
    ...rest,
  });
}
