import axios, { AxiosInstance } from "axios";
import { ACompany, ADelivery, AProcess } from "../types/acessorias";

const DEFAULT_BASE_URL = "https://api.acessorias.com";
const USER_AGENT = "NetoContabilidade-Gestor/1.0";

function trimSlashes(value?: string | null) {
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function resolveBaseUrl() {
  const envBase =
    process.env.ACESSORIAS_API_BASE ?? process.env.ACESSORIAS_BASE_URL ?? "";
  const sanitized = trimSlashes(envBase.trim());
  return sanitized || DEFAULT_BASE_URL;
}

function resolveAuthHeader() {
  const direct = process.env.ACESSORIAS_AUTH;
  if (direct && direct.trim()) {
    return direct.trim();
  }

  const token = process.env.ACESSORIAS_TOKEN;
  if (token && token.trim()) {
    return `Bearer ${token.trim()}`;
  }

  return "";
}

const DEFAULT_COMPANY_IDENT =
  process.env.ACESSORIAS_COMPaniesIdent ??
  process.env.ACESSORIAS_COMPANIES_IDENT ??
  "Geral";

export function buildClient(): AxiosInstance {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const authHeader = resolveAuthHeader();
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  return axios.create({
    baseURL: resolveBaseUrl(),
    timeout: 30000,
    headers,
  });
}

export const acessoriasClient = buildClient();

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status?: number) {
  if (!status) return false;
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

async function getWithRetry<T>(url: string, tries = 5, baseDelay = 400): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < tries) {
    try {
      const response = await acessoriasClient.get<T>(url);
      return response.data;
    } catch (error) {
      attempt += 1;
      lastError = error;
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (attempt >= tries || !isRetryableStatus(status)) {
        throw error;
      }

      const wait = baseDelay * Math.pow(1.6, attempt - 1) + Math.random() * 250;
      await sleep(wait);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Falha ao consultar API da Acessórias");
}

function extractList<T>(payload: unknown): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray((payload as { results?: T[] }).results)) {
    return (payload as { results: T[] }).results;
  }
  if (Array.isArray((payload as { data?: T[] }).data)) {
    return (payload as { data: T[] }).data;
  }
  if (Array.isArray((payload as { items?: T[] }).items)) {
    return (payload as { items: T[] }).items;
  }
  return [];
}

function setIfTruthy(target: URLSearchParams, key: string, value?: string | number | null) {
  if (value === undefined || value === null || value === "") return;
  target.set(key, String(value));
}

type ProcessListOptions = {
  status?: "C" | "A";
  page?: number;
  ProcStatus?: string;
  DtLastDH?: string;
  dtLastDH?: string;
  DtInitial?: string;
  dtInitial?: string;
  DtFinal?: string;
  dtFinal?: string;
  pageSize?: number;
};

export async function listProcesses(options: ProcessListOptions = {}): Promise<AProcess[]> {
  const page = options.page ?? 1;
  const qp = new URLSearchParams();
  qp.set("Pagina", String(page));

  const status = options.status ?? options.ProcStatus;
  if (status) qp.set("ProcStatus", status);

  const dtLastDh = options.DtLastDH ?? options.dtLastDH;
  setIfTruthy(qp, "DtLastDH", dtLastDh);
  const dtInitial = options.DtInitial ?? options.dtInitial;
  setIfTruthy(qp, "DtInitial", dtInitial);
  const dtFinal = options.DtFinal ?? options.dtFinal;
  setIfTruthy(qp, "DtFinal", dtFinal);
  setIfTruthy(qp, "PageSize", options.pageSize);

  const url = `/processes/ListAll/?${qp.toString()}`;
  const data = await getWithRetry<unknown>(url);
  return extractList<AProcess>(data);
}

export async function getProcessById<T = unknown>(procId: string): Promise<T> {
  if (!procId) {
    throw new Error("getProcessById exige um procId válido");
  }
  const url = `/processes/${encodeURIComponent(procId)}`;
  return getWithRetry<T>(url);
}

type CompaniesOptions = number | { ident?: string; page?: number };

export async function listCompanies(params: CompaniesOptions): Promise<ACompany[]> {
  const ident =
    typeof params === "number"
      ? DEFAULT_COMPANY_IDENT
      : params.ident ?? DEFAULT_COMPANY_IDENT;
  const page = typeof params === "number" ? params : params.page ?? 1;

  const qp = new URLSearchParams();
  qp.set("Pagina", String(page));

  const url = `/companies/${encodeURIComponent(ident)}/?${qp.toString()}`;
  const data = await getWithRetry<unknown>(url);
  return extractList<ACompany>(data);
}

type DeliveriesOptions = {
  ident?: string;
  page?: number;
  DtInitial?: string;
  DtFinal?: string;
  DtLastDH?: string;
  from?: string;
  to?: string;
  dtLastDH?: string;
};

export async function listDeliveries(options: DeliveriesOptions): Promise<ADelivery[]> {
  const ident = options.ident ?? DEFAULT_COMPANY_IDENT;
  const page = options.page ?? 1;
  const qp = new URLSearchParams();
  qp.set("Pagina", String(page));

  const dtInitial = options.DtInitial ?? options.from;
  const dtFinal = options.DtFinal ?? options.to;
  const dtLastDh = options.DtLastDH ?? options.dtLastDH;

  setIfTruthy(qp, "DtInitial", dtInitial);
  setIfTruthy(qp, "DtFinal", dtFinal);
  setIfTruthy(qp, "DtLastDH", dtLastDh);

  const url = `/deliveries/${encodeURIComponent(ident)}/?${qp.toString()}`;
  const data = await getWithRetry<unknown>(url);
  return extractList<ADelivery>(data);
}

type PageResult<T> = {
  items: T[];
  hasMore?: boolean;
  nextPage?: number | null;
};

function toPageResult<T>(payload: PageResult<T> | T[]): PageResult<T> {
  if (Array.isArray(payload)) {
    return { items: payload };
  }

  if (!payload) {
    return { items: [] };
  }

  if (Array.isArray(payload.items)) {
    return payload;
  }

  return { items: [] };
}

export async function fetchAllPages<T>(
  fn: (page: number) => Promise<PageResult<T> | T[]>,
  startPage = 1,
): Promise<T[]> {
  const acc: T[] = [];

  for (let page = startPage; ; page += 1) {
    const result = toPageResult(await fn(page));
    if (!result.items.length) {
      break;
    }

    acc.push(...result.items);

    if (result.hasMore === false || result.nextPage === null) {
      break;
    }
  }

  return acc;
}

export const acessoriasDefaults = {
  baseURL: resolveBaseUrl(),
  companyIdent: DEFAULT_COMPANY_IDENT,
};
