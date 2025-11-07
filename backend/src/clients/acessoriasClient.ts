import axios from "axios";
import { format } from "date-fns";
import { env } from "../lib/env";

const api = axios.create({
  baseURL: env.ACESSORIAS_BASE_URL,
  headers: { Authorization: `Bearer ${env.ACESSORIAS_TOKEN}` },
  timeout: 30000,
});

const fmtDH = (d: Date) => format(d, "yyyy-MM-dd HH:mm:ss");
const fmtD  = (d: Date) => format(d, "yyyy-MM-dd");

export type ProcStatus = "A" | "C" | "P" | "T" | "E" | "N" | "F"; // conforme doc

export async function listProcessesAll(params: {
  status?: ProcStatus,
  lastDh?: Date,
  page?: number,
}) {
  const page = params.page ?? 1;
  const query: Record<string, string> = { Pagina: String(page) };
  query["ProcID"] = "ListAll";
  if (params.status) query["ProcStatus"] = params.status;
  if (params.lastDh) query["DtLastDH"] = fmtDH(params.lastDh);
  const url = `/processes/ListAll/`;
  const { data } = await api.get(url, { params: query });
  return data as any[];
}

export async function listDeliveriesListAll(params: {
  lastDh: Date,  // obrigatório para ListAll (somente hoje/ontem)
  page?: number,
  withConfig?: boolean,
}) {
  const page = params.page ?? 1;
  const query: Record<string, string> = { Pagina: String(page), DtLastDH: fmtDH(params.lastDh) };
  if (params.withConfig) query["config"] = "S";
  const url = `/deliveries/ListAll/`;
  const { data } = await api.get(url, { params: query });
  return data as any[];
}

export async function listDeliveriesById(params: {
  identificador: string, // CNPJ/CPF
  dtInitial: Date,
  dtFinal: Date,
  page?: number,
  withConfig?: boolean,
}) {
  const page = params.page ?? 1;
  const query: Record<string, string> = {
    Pagina: String(page),
    DtInitial: fmtD(params.dtInitial),
    DtFinal: fmtD(params.dtFinal),
  };
  if (params.withConfig) query["config"] = "S";
  const url = `/deliveries/${encodeURIComponent(params.identificador)}/`;
  const { data } = await api.get(url, { params: query });
  return data as any[];
}

export async function pageThrough<T>(fn: (page: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 1; p < 9999; p++) {
    const chunk = await fn(p);
    if (!chunk?.length) break;
    out.push(...chunk);
    if (chunk.length < 50) break; // doc: 50 por página
  }
  return out;
}
