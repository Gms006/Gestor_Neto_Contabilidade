import axios, { AxiosError, AxiosInstance } from "axios";

const BASE_URL = process.env.ACESSORIAS_API_BASE ?? "https://api.acessorias.com";
const TOKEN = process.env.ACESSORIAS_TOKEN ?? "";

const MAX_REQUESTS_PER_MINUTE = 100;
const MIN_INTERVAL_MS = Math.ceil(60000 / MAX_REQUESTS_PER_MINUTE);
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 500;

const defaultHeaders: Record<string, string> = {
  "User-Agent": "NetoContabilidade-Gestor/1.0",
  Accept: "application/json",
};

if (TOKEN) {
  defaultHeaders["Authorization"] = `Bearer ${TOKEN}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let rateLimiter: Promise<void> = Promise.resolve();
let nextAvailableAt = Date.now();

function applyRateLimit(): Promise<void> {
  rateLimiter = rateLimiter.then(async () => {
    const now = Date.now();
    const waitFor = Math.max(0, nextAvailableAt - now);
    if (waitFor > 0) {
      await delay(waitFor);
    }
    const jitter = Math.random() * 50;
    nextAvailableAt = Date.now() + MIN_INTERVAL_MS + jitter;
  });
  return rateLimiter;
}

function shouldRetry(error: AxiosError): boolean {
  const status = error.response?.status ?? 0;
  return status === 429 || (status >= 500 && status < 600);
}

function computeRetryDelay(error: AxiosError, attempt: number): number {
  const retryAfterHeader = error.response?.headers?.["retry-after"];
  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);
    if (!Number.isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }
  }
  const baseDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 250;
  return baseDelay + jitter;
}

function createClient(): AxiosInstance {
  const instance = axios.create({
    baseURL: BASE_URL,
    headers: defaultHeaders,
  });

  instance.interceptors.request.use(async (config) => {
    await applyRateLimit();
    return config;
  });

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config: any = error.config ?? {};
      if (!config || !shouldRetry(error)) {
        throw error;
      }

      config.__retryCount = (config.__retryCount ?? 0) + 1;
      if (config.__retryCount > MAX_RETRIES) {
        throw error;
      }

      const delayMs = computeRetryDelay(error, config.__retryCount);
      await delay(delayMs);
      return instance.request(config);
    }
  );

  return instance;
}

export const acessoriasClient = createClient();

export type PageParams = Record<string, string | number | undefined>;

export function buildUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export async function paginate<T>(path: string, params: PageParams = {}): Promise<T[]> {
  const output: T[] = [];
  let pagina = Number(params?.Pagina ?? 1);

  for (;;) {
    const { data } = await acessoriasClient.get<T[]>(buildUrl(path), {
      params: { ...params, Pagina: pagina },
    });

    if (!data || data.length === 0) {
      break;
    }

    output.push(...data);
    pagina += 1;
  }

  return output;
}

export interface CompanyListOptions {
  pagina?: number;
  withObligations?: boolean;
}

export async function listCompanies(options: CompanyListOptions = {}): Promise<Record<string, unknown>[]> {
  const { pagina = 1, withObligations = false } = options;
  return paginate<Record<string, unknown>>("/companies/ListAll", {
    Pagina: pagina,
    obligations: withObligations ? "true" : undefined,
  });
}

export async function getCompany(identificador: string): Promise<Record<string, unknown>> {
  const { data } = await acessoriasClient.get<Record<string, unknown>>(buildUrl(`/companies/${identificador}`));
  return data;
}

export interface ProcessListFilters extends PageParams {
  ProcStatus?: string;
  ProcNome?: string;
  ProcInicio?: string;
  ProcConclusao?: string;
}

export async function listProcesses(filters: ProcessListFilters = {}): Promise<Record<string, unknown>[]> {
  const params: PageParams = { ...filters };
  return paginate<Record<string, unknown>>("/processes/ListAll", params);
}

export async function getProcess(procId: string): Promise<Record<string, unknown>> {
  const { data } = await acessoriasClient.get<Record<string, unknown>>(buildUrl(`/processes/${procId}`));
  return data;
}

export interface DeliveriesListFilters extends PageParams {
  DtInitial: string;
  DtFinal: string;
  DtLastDH?: string;
}

export async function listDeliveries(
  identificador: string,
  dtInitial: string,
  dtFinal: string,
  dtLastDH?: string
): Promise<Record<string, unknown>[]> {
  const params: DeliveriesListFilters = {
    DtInitial: dtInitial,
    DtFinal: dtFinal,
    DtLastDH: dtLastDH,
  };

  return paginate<Record<string, unknown>>(`/deliveries/${identificador}`, params);
}
