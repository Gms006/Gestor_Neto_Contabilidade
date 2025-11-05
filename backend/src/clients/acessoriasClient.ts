// src/clients/acessoriasClient.ts
import axios, { AxiosInstance } from 'axios';

const {
  ACESSORIAS_API_BASE = 'https://api.acessorias.com',
  ACESSORIAS_AUTH_HEADER = 'Authorization',
  ACESSORIAS_TOKEN = '',
  ACESSORIAS_TIMEOUT_MS = '30000',
  ACESSORIAS_LOG_HTTP = 'false',
} = process.env;

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'NetoContabilidade-Gestor/1.0',
    'Accept': 'application/json',
  };
  if (ACESSORIAS_TOKEN) {
    if (ACESSORIAS_AUTH_HEADER.toLowerCase() === 'authorization' &&
        !ACESSORIAS_TOKEN.toLowerCase().startsWith('bearer')) {
      h['Authorization'] = `Bearer ${ACESSORIAS_TOKEN}`;
    } else {
      h[ACESSORIAS_AUTH_HEADER] = ACESSORIAS_TOKEN;
    }
  }
  return h;
}

export interface Company { id?: number|string; empresaId?: number; cnpj?: string; nome?: string; razaoSocial?: string; [k: string]: any }
export interface Process { id: number|string; empresaId?: number|string; titulo?: string; status?: string; progress?: number; [k: string]: any }
export interface Delivery { id: number|string; processoId?: number|string; descricao?: string; status?: string; [k: string]: any }

function buildUrl(resource: string, qs: Record<string, any> = {}): string {
  const base = ACESSORIAS_API_BASE.replace(/\/+$/, '');
  const path = resource.startsWith('/') ? resource : `/${resource}`;
  const u = new URL(base + path);
  Object.entries(qs).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    u.searchParams.set(k, String(v));
  });
  return u.toString();
}

function newClient(): AxiosInstance {
  const instance = axios.create({
    timeout: Number(ACESSORIAS_TIMEOUT_MS),
    headers: headers(),
  });

  instance.interceptors.response.use(
    r => {
      if (ACESSORIAS_LOG_HTTP === 'true') {
        console.log('[HTTP]', r.status, r.config.method?.toUpperCase(), r.config.url);
      }
      return r;
    },
    async (err) => {
      const status = err?.response?.status;
      const cfg = err?.config ?? {};
      const retriable = status === 429 || (status >= 500 && status < 600);
      cfg.__retries = (cfg.__retries ?? 0) + 1;
      if (retriable && cfg.__retries <= 3) {
        const backoff = 200 * Math.pow(2, cfg.__retries);
        await new Promise(res => setTimeout(res, backoff));
        return instance.request(cfg);
      }
      return Promise.reject(err);
    }
  );
  return instance;
}

export const acessoriasClient = newClient();

async function getPage<T>(resource: string, page: number, qs: Record<string, any> = {}): Promise<T[]> {
  const url = buildUrl(resource, { Pagina: page, ...qs });
  const { data } = await acessoriasClient.get(url);
  if (Array.isArray(data)) return data as T[];
  if (data?.data && Array.isArray(data.data)) return data.data as T[];
  return [];
}

export async function listAllCompanies(qs: Record<string, any> = {}): Promise<Company[]> {
  const out: Company[] = [];
  for (let p = 1; p <= 9999; p++) {
    const page = await getPage<Company>('/companies', p, qs);
    if (page.length === 0) break;
    out.push(...page);
  }
  return out;
}

export async function listAllProcesses(qs: Record<string, any> = {}): Promise<Process[]> {
  const out: Process[] = [];
  for (let p = 1; p <= 9999; p++) {
    const page = await getPage<Process>('/processes', p, qs);
    if (page.length === 0) break;
    out.push(...page);
  }
  return out;
}

export async function getProcessById(id: string|number): Promise<Process|null> {
  const url = buildUrl(`/processes/${id}`);
  const { data } = await acessoriasClient.get(url);
  return data ?? null;
}

export async function listDeliveriesByProcess(processId: string|number, paramName = 'ProcessoId'): Promise<Delivery[]> {
  const all: Delivery[] = [];
  for (let p = 1; p <= 9999; p++) {
    const url = buildUrl('/deliveries', { [paramName]: processId, Pagina: p });
    const { data } = await acessoriasClient.get(url);
    const arr = Array.isArray(data) ? data : (data?.data ?? []);
    if (!arr?.length) break;
    all.push(...arr);
  }
  return all;
}

export async function listCompanies(params: Record<string, any> = {}): Promise<Company[]> {
  return listAllCompanies(params);
}

export async function listProcesses(params: Record<string, any> = {}): Promise<Process[]> {
  return listAllProcesses(params);
}

export async function listDeliveries(params: Record<string, any> = {}): Promise<Delivery[]> {
  const paramName = params.paramName ?? params.param ?? 'ProcessoId';
  const processId =
    params.processId ??
    params.processoId ??
    params.ProcessoId ??
    (paramName && params[paramName]);
  if (processId === undefined || processId === null || processId === '') {
    return [];
  }
  return listDeliveriesByProcess(processId, paramName);
}
