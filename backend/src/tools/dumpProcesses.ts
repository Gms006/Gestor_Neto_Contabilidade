import fs from "node:fs/promises";
import path from "node:path";
import { subMonths } from "date-fns";
import { getProcess, listDeliveries, listProcesses } from "../clients/acessoriasClient.js";
import { resolveCompanyExternalId, resolveProcessExternalId } from "../repositories/processRepo.js";

interface CliArgs {
  status: "ALL" | "OPEN" | "CLOSED";
  empresa?: string;
  desde?: string;
  ate?: string;
}

interface DumpEntry {
  summary: Record<string, unknown>;
  detail: Record<string, unknown> | null;
  deliveries: Record<string, unknown>[];
}

const OUTPUT_BASE = path.resolve(process.cwd(), "output/matriz_processos");
const RAW_DIR = path.join(OUTPUT_BASE, "_raw");
const TXT_DIR = path.join(OUTPUT_BASE, "txt");
const MAX_CHUNK_SIZE = 9 * 1024 * 1024; // ~9 MB

function parseArgs(): CliArgs {
  const args: CliArgs = { status: "ALL" };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    const [key, rawValue] = arg.split("=");
    const value = rawValue ?? process.argv[i + 1];
    switch (true) {
      case key === "--status" && value !== undefined:
        args.status = value.toUpperCase() as CliArgs["status"];
        if (!rawValue) i += 1;
        break;
      case key === "--empresa" && value !== undefined:
        args.empresa = value;
        if (!rawValue) i += 1;
        break;
      case key === "--desde" && value !== undefined:
        args.desde = value;
        if (!rawValue) i += 1;
        break;
      case key === "--ate" && value !== undefined:
        args.ate = value;
        if (!rawValue) i += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

function mapStatusToProcStatus(status: CliArgs["status"]): string | undefined {
  if (status === "OPEN") return "A";
  if (status === "CLOSED") return "C";
  return undefined;
}

async function ensureDirectories() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.mkdir(TXT_DIR, { recursive: true });
}

function formatDateStamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

function normalizeEmpresa(value?: string): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D+/g, "");
  return digits.length ? digits : value.trim();
}

async function fetchDeliveries(
  companyExternalId: string | null,
  dateStart: string,
  dateEnd: string
): Promise<Record<string, unknown>[]> {
  if (!companyExternalId) {
    return [];
  }
  try {
    return await listDeliveries(companyExternalId, dateStart, dateEnd);
  } catch (error) {
    console.warn(
      `[dump] Falha ao buscar entregas da empresa ${companyExternalId}: ${(error as Error).message}`
    );
    return [];
  }
}

function renderTextEntry(index: number, entry: DumpEntry): string {
  const header = `==================== PROCESSO ${index} ====================\n`;
  const summary = JSON.stringify(entry.summary, null, 2);
  const detail = JSON.stringify(entry.detail, null, 2);
  const deliveries = JSON.stringify(entry.deliveries, null, 2);
  const body =
    `Resumo:\n${summary}\n\n` +
    `Detalhe:\n${detail}\n\n` +
    `Entregas:\n${deliveries}\n`;
  const footer = `==========================================================\n\n`;
  return header + body + footer;
}

async function writeChunks(entries: DumpEntry[]): Promise<string[]> {
  const chunkPaths: string[] = [];
  let chunkIndex = 1;
  let currentBuffer = "";
  let currentSize = 0;

  const flush = async () => {
    if (!currentBuffer) return;
    const fileName = `matriz_processos_${String(chunkIndex).padStart(3, "0")}.txt`;
    const filePath = path.join(TXT_DIR, fileName);
    await fs.writeFile(filePath, currentBuffer, "utf8");
    chunkPaths.push(filePath);
    chunkIndex += 1;
    currentBuffer = "";
    currentSize = 0;
  };

  for (let i = 0; i < entries.length; i += 1) {
    const text = renderTextEntry(i + 1, entries[i]);
    const textSize = Buffer.byteLength(text, "utf8");
    if (currentSize + textSize > MAX_CHUNK_SIZE) {
      await flush();
    }
    currentBuffer += text;
    currentSize += textSize;
  }

  if (currentBuffer) {
    await flush();
  }

  return chunkPaths;
}

async function main() {
  const args = parseArgs();
  const statusCode = mapStatusToProcStatus(args.status);
  const empresaFilter = normalizeEmpresa(args.empresa);
  const apiFilters: Record<string, string> = {};
  if (statusCode) apiFilters.ProcStatus = statusCode;
  if (args.desde) apiFilters.ProcInicio = args.desde;
  if (args.ate) apiFilters.ProcConclusao = args.ate;

  console.log("[dump] Iniciando com filtros", { ...apiFilters, empresa: empresaFilter });

  const processes = await listProcesses(apiFilters);

  const filteredProcesses = empresaFilter
    ? processes.filter((summary: Record<string, unknown>) => {
        const companyId = resolveCompanyExternalId(summary);
        if (!companyId) return false;
        return companyId.includes(empresaFilter);
      })
    : processes;

  console.log(`[dump] ${filteredProcesses.length} processos após filtros`);

  const dateStartForDeliveries = args.desde ?? subMonths(new Date(), 12).toISOString().slice(0, 10);
  const dateEndForDeliveries = args.ate ?? new Date().toISOString().slice(0, 10);

  const entries: DumpEntry[] = [];

  for (const summary of filteredProcesses) {
    const externalId = resolveProcessExternalId(summary);
    if (!externalId) {
      console.warn("[dump] Ignorando processo sem identificador", summary);
      continue;
    }

    let detail: Record<string, unknown> | null = null;
    try {
      detail = await getProcess(externalId);
    } catch (error) {
      console.warn(`[dump] Falha ao obter detalhes do processo ${externalId}: ${(error as Error).message}`);
    }

    const companyExternalId = resolveCompanyExternalId(summary);
    const deliveries = await fetchDeliveries(companyExternalId, dateStartForDeliveries, dateEndForDeliveries);

    entries.push({ summary, detail, deliveries });
  }

  await ensureDirectories();
  const stamp = formatDateStamp();
  const rawFile = path.join(RAW_DIR, `processes.${stamp}.json`);
  await fs.writeFile(rawFile, JSON.stringify(entries, null, 2), "utf8");
  const chunkPaths = await writeChunks(entries);

  console.log("[dump] Processos exportados:", entries.length);
  console.log("[dump] Arquivo bruto:", rawFile);
  console.log("[dump] Arquivos TXT:");
  for (const file of chunkPaths) {
    console.log(` - ${file}`);
  }
}

main().catch((error) => {
  console.error("[dump] Erro", error);
  process.exit(1);
});
