import axios, { AxiosInstance } from 'axios';

const BASE = process.env.ACESSORIAS_API_BASE || 'https://api.acessorias.com';
const TOKEN = process.env.ACESSORIAS_API_TOKEN || process.env.ACESSORIAS_TOKEN || '';

export const acessoriasHttp: AxiosInstance = axios.create({
  baseURL: BASE,
  timeout: 30000,
  headers: {
    'User-Agent': 'NetoContabilidade-Gestor/1.0',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  },
});

type Res<T> = { data: T };

type Resource = 'companies' | 'processes' | 'deliveries';

type QueryValue = string | number | boolean | undefined;

type QueryParams = Record<string, QueryValue>;

export function buildUrl(
  resource: Resource,
  opts: { ident?: string; query?: QueryParams } = {}
): string {
  const ident = opts.ident ? `/${encodeURIComponent(opts.ident)}/` : '/';
  const query = opts.query ?? {};
  const definedEntries = Object.entries(query).filter(([, value]) => value !== undefined && value !== null);
  const qs = definedEntries.length
    ? `?${new URLSearchParams(definedEntries.map(([k, v]) => [k, String(v)])).toString()}`
    : '';
  return `/${resource}${ident}${qs}`.replace(/\/+/g, '/').replace(/\/?\?/, '?');
}

export async function fetchWithRetry<T>(url: string, tries = 3, waitMs = 250): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const response: Res<T> = await acessoriasHttp.get(url);
      return response.data;
    } catch (err) {
      lastErr = err;
      if (attempt === tries) {
        break;
      }
      const jitter = Math.floor(Math.random() * waitMs);
      await new Promise((resolve) => setTimeout(resolve, waitMs + jitter));
    }
  }
  throw lastErr;
}

export async function fetchAllPages<T>(makeUrl: (page: number) => string): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; ; page += 1) {
    const url = makeUrl(page);
    const data = await fetchWithRetry<T[]>(url);
    if (!data || data.length === 0) {
      break;
    }
    result.push(...data);
  }
  return result;
}

export async function fetchResource<T>(resource: Resource, ident: string): Promise<T> {
  const url = buildUrl(resource, { ident });
  return fetchWithRetry<T>(url);
}

export async function listProcesses(
  query: Record<string, QueryValue> = {}
): Promise<Record<string, unknown>[]> {
  return fetchAllPages<Record<string, unknown>>((page) =>
    buildUrl('processes', {
      ident: 'ListAll',
      query: { ...query, Pagina: page },
    })
  );
}

export async function getProcess(ident: string): Promise<Record<string, unknown>> {
  if (!ident.trim()) {
    throw new Error('Identificador do processo é obrigatório');
  }
  return fetchResource<Record<string, unknown>>('processes', ident.trim());
}

export async function listDeliveries(
  ident: string,
  dtInitial: string,
  dtFinal: string,
  dtLastDh?: string
): Promise<Record<string, unknown>[]> {
  if (!ident.trim()) {
    throw new Error('Identificador é obrigatório para listar entregas');
  }
  return fetchAllPages<Record<string, unknown>>((page) =>
    buildUrl('deliveries', {
      ident: ident.trim(),
      query: {
        Pagina: page,
        DtInitial: dtInitial,
        DtFinal: dtFinal,
        ...(dtLastDh ? { DtLastDH: dtLastDh } : {}),
      },
    })
  );
}
