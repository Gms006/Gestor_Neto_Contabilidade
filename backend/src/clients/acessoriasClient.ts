import axios, { AxiosRequestConfig } from 'axios';
import { env } from '../lib/env';

const trim = (s: string) => s.replace(/\/+$/g, "").replace(/^\/+/g, "");
const joinUrl = (...parts: (string | undefined)[]) =>
  "/" + parts.filter(Boolean).map(p => trim(p!)).filter(Boolean).join("/");

const BASE_URL = trim(env.acessorias.baseURL);
const API_BASE = env.acessorias.apiBase ? trim(env.acessorias.apiBase) : "";
const API_VERSION = env.acessorias.apiVersion ? trim(env.acessorias.apiVersion) : "";
const PATH_LANG = (env.acessorias.pathLang || "en").toLowerCase();

const paths = {
  companies: PATH_LANG === "pt" ? "empresas" : "companies",
  processes: PATH_LANG === "pt" ? "processos" : "processes",
  deliveries: PATH_LANG === "pt" ? "entregas" : "deliveries",
};

function buildUrl(resource: string, query?: Record<string, any>) {
  const pathname = joinUrl(API_BASE, API_VERSION, resource);
  const url = `${BASE_URL}${pathname}`;
  if (!query) return url;
  const p = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    p.append(k, String(v));
  });
  return p.toString() ? `${url}?${p.toString()}` : url;
}
import { ACompany, ADelivery, AProcess } from '../types/acessorias';
import { logger } from '../lib/logger';

const MAX_RETRIES = 3;
const BEARER_TOKEN = env.acessorias.token;

const http = axios.create({
  timeout: 60000,
  headers: {
    'Authorization': `Bearer ${BEARER_TOKEN}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'NetoContabilidade-Gestor/1.0',
    // Adicionar outros headers canônicos se necessário, mas o Authorization é o principal.
  },
});

// Função genérica para lidar com retries e backoff exponencial com jitter
async function fetchWithRetry<T>(url: string, config: AxiosRequestConfig, pageParam: string = 'Pagina'): Promise<T[]> {
  let page = 1;
  let allResults: T[] = [];
  let hasMore = true;

  while (hasMore) {
    let retries = 0;
    let success = false;
    let lastError: any = null;

    while (retries < MAX_RETRIES && !success) {
      try {
        const pageConfig = {
          ...config,
          params: {
            ...config.params,
            [pageParam]: page,
          },
        };

        const fullUrl = buildUrl(url, pageConfig.params);
        logger.info(`Fetching page ${page} from ${fullUrl}`, { source: 'acessoriasClient', page });
        const { data } = await http.get(fullUrl, { headers: http.defaults.headers });
        const results: T[] = data?.results ?? data ?? [];

        if (results.length > 0) {
          allResults = allResults.concat(results);
          page++;
        } else {
          hasMore = false;
        }
        success = true;
      } catch (error: any) {
        lastError = error;
        retries++;
        const status = error.response?.status;
        logger.error(`Error fetching ${url} page ${page}. Status: ${status}. Retry ${retries}/${MAX_RETRIES}.`, { source: 'acessoriasClient', page, status, error: error.message });

        if (retries < MAX_RETRIES) {
          // Backoff exponencial com jitter (2^retries * 100ms + jitter)
          const delay = Math.pow(2, retries) * 100 + Math.random() * 100;
          logger.info(`Waiting for ${delay.toFixed(0)}ms before retrying...`, { source: 'acessoriasClient', delay });
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          hasMore = false; // Parar o loop de paginação se falhar após todas as retries
        }
      }
    }

    if (!success) {
      logger.error(`Failed to fetch all pages from ${url} after ${MAX_RETRIES} retries.`, { source: 'acessoriasClient', lastError: lastError?.message });
      throw new Error(`Failed to fetch data from Acessórias API: ${lastError?.message}`);
    }
  }

  return allResults;
}

// 1. listProcesses: Usa DtLastDH e ProcStatus
export async function listProcesses(params: { DtLastDH?: string; ProcStatus?: string } = {}): Promise<AProcess[]> {
  const config: AxiosRequestConfig = { params };
  return fetchWithRetry<AProcess>(paths.processes, config);
}

// 2. listDeliveries: Usa DtLastDH
export async function listDeliveries(params: { DtLastDH?: string } = {}): Promise<ADelivery[]> {
  const config: AxiosRequestConfig = { params };
  return fetchWithRetry<ADelivery>(paths.deliveries, config);
}

// 3. listCompanies: Não usa DtLastDH nem Paginação na documentação
export async function listCompanies(): Promise<ACompany[]> {
  // A documentação não indica paginação para /v1/companies, mas o fetchWithRetry lida com a paginação se o endpoint a suportar.
  // Se o endpoint não suportar paginação, ele retornará a primeira página e encerrará o loop.
  // Vou usar o fetchWithRetry para consistência, assumindo que o parâmetro de paginação é 'Pagina'
  return fetchWithRetry<ACompany>(paths.companies, {});
}
