import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import iconv from "iconv-lite";

const BASE_URL = process.env.ACESSORIAS_API_BASE ?? "https://api.acessorias.com";
const TOKEN =
  process.env.ACESSORIAS_TOKEN ?? process.env.ACESSORIAS_API_TOKEN ?? "";

const MAX_REQUESTS_PER_MINUTE = 100;
const MIN_INTERVAL_MS = Math.ceil(60000 / MAX_REQUESTS_PER_MINUTE);
const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 500;

const defaultHeaders: Record<string, string> = {
  "User-Agent": "NetoContabilidade-Gestor/1.0",
  Accept: "application/json, text/plain, */*",
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

function createClient(overrides: AxiosRequestConfig = {}): AxiosInstance {
  const { headers, ...rest } = overrides;
  const mergedHeaders = {
    ...defaultHeaders,
    ...(headers && typeof headers === "object" ? (headers as Record<string, unknown>) : {}),
  } as AxiosRequestConfig["headers"];
  const instance = axios.create({
    baseURL: BASE_URL,
    ...rest,
    headers: mergedHeaders,
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

function ensureLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function normalizeIdentifier(identifier?: string | null): string {
  const trimmed = identifier?.trim();
  if (!trimmed) {
    return "ListAll";
  }
  if (/^listall$/i.test(trimmed)) {
    return "ListAll";
  }
  return trimmed;
}

export function buildUrl(path: string): string {
  return ensureLeadingSlash(path);
}

export async function paginate<T>(path: string, params: PageParams = {}): Promise<T[]> {
  const output: T[] = [];
  let pagina = Number(params?.Pagina ?? 1);

  for (;;) {
    const { data } = await acessoriasClient.get<T[]>(ensureLeadingSlash(path), {
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
  identificador?: string;
}

export async function listCompanies(options: CompanyListOptions = {}): Promise<Record<string, unknown>[]> {
  const { pagina = 1, withObligations = false, identificador } = options;
  const path = ensureTrailingSlash(`/companies/${normalizeIdentifier(identificador)}`);
  return paginate<Record<string, unknown>>(path, {
    Pagina: pagina,
    obligations: withObligations ? "true" : undefined,
  });
}

export async function getCompany(identificador: string): Promise<Record<string, unknown>> {
  const trimmed = identificador.trim();
  if (!trimmed) {
    throw new Error("Identificador da empresa é obrigatório");
  }
  const path = ensureLeadingSlash(`/companies/${trimmed}`);
  const { data } = await acessoriasClient.get<Record<string, unknown>>(ensureTrailingSlash(path));
  return data;
}

export interface ProcessListFilters extends PageParams {
  ProcStatus?: string;
  ProcNome?: string;
  ProcInicio?: string;
  ProcConclusao?: string;
}

export async function listProcesses(
  filters: ProcessListFilters = {},
  procIdPattern = "*"
): Promise<Record<string, unknown>[]> {
  const normalizedPattern = normalizeIdentifier(procIdPattern).replace(/^ListAll$/i, "*");
  const path = ensureTrailingSlash(`/processes/${normalizedPattern}`);
  return paginate<Record<string, unknown>>(path, { ...filters });
}

export async function getProcess(procId: string): Promise<Record<string, unknown>> {
  const trimmed = procId.trim();
  if (!trimmed) {
    throw new Error("Identificador do processo é obrigatório");
  }
  const path = ensureLeadingSlash(`/processes/${trimmed}`);
  const { data } = await acessoriasClient.get<Record<string, unknown>>(ensureTrailingSlash(path));
  return data;
}

export interface DeliveriesListFilters extends PageParams {
  DtInitial: string;
  DtFinal: string;
  DtLastDH?: string;
}

export async function listDeliveries(
  identificador: string | undefined,
  dtInitial: string,
  dtFinal: string,
  dtLastDH?: string
): Promise<Record<string, unknown>[]> {
  const resolvedIdentifier = normalizeIdentifier(identificador);
  if (resolvedIdentifier === "ListAll" && !dtLastDH) {
    throw new Error("DtLastDH é obrigatório quando o identificador é ListAll");
  }

  const params: DeliveriesListFilters = {
    DtInitial: dtInitial,
    DtFinal: dtFinal,
    DtLastDH: dtLastDH,
  };

  const path = ensureTrailingSlash(`/deliveries/${resolvedIdentifier}`);
  return paginate<Record<string, unknown>>(path, params);
}

type Qs = Record<string, string | number | boolean | undefined>;

function buildQs(q: Qs) {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    p.set(k, String(v));
  });
  return p.toString();
}

export class AcessoriasClient {
  private http: AxiosInstance;
  private base: string;

  constructor(baseUrl: string, token: string) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.http = createClient({
      baseURL: this.base,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "User-Agent": "NetoContabilidade-Gestor/1.0",
        Accept: "application/json, text/plain, */*",
      },
      timeout: Number(process.env.HTTP_TIMEOUT_MS ?? 30000),
      responseType: "arraybuffer",
    });
  }

  private async getJson<T>(path: string, qs: Qs = {}): Promise<T> {
    const query = buildQs(qs);
    const url = `${this.base}${path}${query ? `?${query}` : ""}`;
    const resp = await this.http.get(url);
    const rawContentType = resp.headers?.["content-type"];
    const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType || "").toLowerCase();
    const data = resp.data;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const text =
      contentType.includes("charset=iso-8859-1") || contentType.includes("charset=latin1")
        ? iconv.decode(buffer, "latin1")
        : buffer.toString("utf8");
    return JSON.parse(text) as T;
  }

  async listProcessesSmart(opts: {
    status?: "A" | "C";
    from?: string;
    to?: string;
    useDates?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const attempts: Qs[] = [];

    const wantStatus = opts.status;
    const useDates = opts.useDates ?? (process.env.USE_PROCESS_DATE_FILTERS === "1");

    attempts.push({});
    attempts.push({ ProcStatus: wantStatus });
    attempts.push({ Status: wantStatus });

    if (useDates && opts.from && opts.to) {
      attempts.push({ ProcStatus: wantStatus, ProcInicio: opts.from, ProcConclusao: opts.to });
      attempts.push({ Status: wantStatus, DataInicio: opts.from, DataFim: opts.to });
    }

    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 100;
    let lastResult: any = { items: [] };

    for (const attempt of attempts) {
      const query = { ...attempt, Page: page, PageSize: pageSize };
      try {
        const data = await this.getJson<any>("/processes", query);
        const list = Array.isArray(data?.items) ? data.items : Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
        if (list.length > 0) {
          return data;
        }
        lastResult = data;
      } catch (error) {
        lastResult = { items: [] };
      }
    }

    return lastResult;
  }
}
