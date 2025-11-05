import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fmtDH, fmtDate } from "../lib/date";
import {
  listProcesses,
  getProcessById,
  listDeliveries,
  fetchAllPages,
  acessoriasDefaults,
} from "../clients/acessoriasClient";

type StatusFlag = "all" | "A" | "C";

type CliArgs = {
  status: StatusFlag;
  from: string;
  to: string;
  ident: string;
  pageSize?: number;
  maxMB: number;
};

type ProcessSummary = Record<string, any>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_ROOT = path.resolve(__dirname, "..", "..", "output", "matriz_processos");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function sanitize(value: string | undefined | null) {
  if (!value) return "sem_nome";
  return (
    value
      .normalize("NFKD")
      .replace(/[\p{Diacritic}]/gu, "")
      .replace(/[^\w.\-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "sem_nome"
  );
}

function formatKeyValue(label: string, value: unknown) {
  if (value === undefined || value === null) {
    return `${label}: \n`;
  }
  if (typeof value === "string") {
    return `${label}: ${value}\n`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${label}: ${String(value)}\n`;
  }
  try {
    return `${label}: ${JSON.stringify(value)}\n`;
  } catch (error) {
    return `${label}: [unserializable]\n`;
  }
}

function bufferToChunks(content: string, maxBytes: number): Buffer[] {
  const buffer = Buffer.from(content ?? "", "utf8");
  if (buffer.byteLength <= maxBytes) {
    return [buffer];
  }

  const parts: Buffer[] = [];
  for (let offset = 0; offset < buffer.byteLength; offset += maxBytes) {
    const slice = buffer.subarray(offset, Math.min(offset + maxBytes, buffer.byteLength));
    parts.push(Buffer.from(slice));
  }
  return parts;
}

function writeChunked(baseFile: string, content: string, maxBytes: number) {
  const dir = path.dirname(baseFile);
  const baseName = path.basename(baseFile, ".txt");

  if (fs.existsSync(baseFile)) {
    fs.rmSync(baseFile);
  }

  if (fs.existsSync(dir)) {
    const partPrefix = `${baseName}_part`;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(partPrefix) && entry.endsWith(".txt")) {
        fs.rmSync(path.join(dir, entry));
      }
    }
  }

  const segments = bufferToChunks(content, maxBytes);

  if (segments.length === 1) {
    fs.writeFileSync(baseFile, segments[0]);
    return;
  }

  segments.forEach((segment, index) => {
    const partLabel = String(index + 1).padStart(2, "0");
    const partFile = baseFile.replace(/\.txt$/, `_part${partLabel}.txt`);
    fs.writeFileSync(partFile, segment);
  });
}

function selectArray(candidate: unknown): unknown[] {
  if (!candidate) return [];
  if (Array.isArray(candidate)) return candidate;
  return [];
}

function extractSteps(processDetail: any): any[] {
  const candidates = [
    processDetail?.ProcPassos,
    processDetail?.procPassos,
    processDetail?.Passos,
    processDetail?.passos,
    processDetail?.Checklist,
    processDetail?.ChecklistItens,
    processDetail?.Itens,
    processDetail?.Steps,
    processDetail?.Etapas,
  ];

  for (const candidate of candidates) {
    const arr = selectArray(candidate);
    if (arr.length) return arr;
  }

  return [];
}

function headerToTxt(processDetail: any, listItem: any) {
  const combined = { ...listItem, ...processDetail };
  let text = "";
  text += formatKeyValue(
    "ProcID",
    combined?.ProcID ?? combined?.id ?? combined?.ProcId ?? combined?.idAcessorias ?? combined?.ProcessoID,
  );
  text += formatKeyValue(
    "ProcTitulo",
    combined?.ProcTitulo ?? combined?.Titulo ?? combined?.titulo ?? combined?.name ?? combined?.Nome,
  );
  text += formatKeyValue("ProcStatus", combined?.ProcStatus ?? combined?.Status ?? combined?.status);
  text += formatKeyValue(
    "ProcPorcentagem",
    combined?.ProcPorcentagem ?? combined?.Porcentagem ?? combined?.percentual ?? combined?.progress,
  );
  text += formatKeyValue("Gestor", combined?.Gestor ?? combined?.gestor ?? combined?.responsavel);
  text += formatKeyValue(
    "Departamento",
    combined?.Departamento ?? combined?.DepartamentoNome ?? combined?.departamento ?? combined?.DepartamentoDescricao,
  );
  text += formatKeyValue(
    "EmpresaNome",
    combined?.EmpNome ?? combined?.Empresa ?? combined?.empresa?.nome ?? combined?.empresaNome ?? combined?.Cliente,
  );
  text += formatKeyValue("EmpresaCNPJ", combined?.EmpCNPJ ?? combined?.empresa?.cnpj ?? combined?.CNPJ);
  text += formatKeyValue(
    "ProcInicio",
    combined?.ProcInicio ?? combined?.DataInicio ?? combined?.inicio ?? combined?.dataInicio ?? combined?.DtInicio,
  );
  text += formatKeyValue(
    "ProcConclusao",
    combined?.ProcConclusao ?? combined?.DataConclusao ?? combined?.conclusao ?? combined?.dataConclusao ?? combined?.DtConclusao,
  );
  text += formatKeyValue("ProcPrevisao", combined?.ProcPrevisao ?? combined?.Previsao ?? combined?.previsao);
  text += formatKeyValue("AtualizadoEm", combined?.AtualizadoEm ?? combined?.Atualizado ?? combined?.updatedAt);
  text += "\nObservacoes:\n";
  const obs =
    combined?.ProcObservacoes ??
    combined?.Observacoes ??
    combined?.observacoes ??
    combined?.Descricao ??
    combined?.descricao ??
    "";
  text += `${obs}\n`;
  return text;
}

function stepsToTxt(processDetail: any) {
  const steps = extractSteps(processDetail);
  if (!steps.length) {
    return "Nenhum passo encontrado.\n";
  }

  let text = `Total de passos: ${steps.length}\n\n`;
  steps.forEach((step, index) => {
    const title =
      step?.Nome ?? step?.Titulo ?? step?.Descricao ?? step?.descricao ?? step?.titulo ?? `Passo ${index + 1}`;
    text += `#${index + 1} - ${title}\n`;
    text += formatKeyValue("Tipo", step?.Tipo ?? step?.tipo);
    text += formatKeyValue("Status", step?.Status ?? step?.status ?? step?.Situacao);
    text += formatKeyValue("Obrigacao", step?.Obrigacao ?? step?.obrigacao ?? step?.ObrigacaoNome);
    text += formatKeyValue("Prazo", step?.Prazos ?? step?.Prazo ?? step?.prazo ?? step?.DataPrazo);
    text += formatKeyValue("Automacao", step?.Automacao ?? step?.automacao ?? step?.Config);
    text += formatKeyValue("Responsavel", step?.Responsavel ?? step?.responsavel);
    text += formatKeyValue("Obs", step?.Obs ?? step?.Observacoes ?? step?.observacao ?? step?.obs);
    text += "----\n";
  });

  return text;
}

function deliveriesToTxt(deliveries: any[]) {
  if (!deliveries.length) {
    return "Nenhuma entrega encontrada no período informado.\n";
  }

  let text = "";
  deliveries.forEach((delivery, index) => {
    const title =
      delivery?.Nome ??
      delivery?.Titulo ??
      delivery?.descricao ??
      delivery?.titulo ??
      delivery?.Descricao ??
      `Entrega ${index + 1}`;
    text += `#${index + 1} - ${title}\n`;
    text += formatKeyValue("Status", delivery?.Status ?? delivery?.status ?? delivery?.Situacao);
    text += formatKeyValue("Prazo", delivery?.EntDtPrazo ?? delivery?.Prazo ?? delivery?.prazo);
    text += formatKeyValue("EntregueEm", delivery?.EntDtEntrega ?? delivery?.entregueEm ?? delivery?.DataEntrega);
    text += formatKeyValue("Departamento", delivery?.Depto ?? delivery?.Departamento ?? delivery?.departamento);
    text += formatKeyValue("Tipo", delivery?.Tipo ?? delivery?.tipo);
    text += formatKeyValue("Observacoes", delivery?.Observacoes ?? delivery?.observacoes ?? "");
    text += "----\n";
  });

  return text;
}

function parseArgs(): CliArgs {
  const argList = process.argv.slice(2);
  const readArg = (key: string) => {
    const prefix = `--${key}=`;
    const raw = argList.find((arg) => arg.startsWith(prefix));
    return raw ? raw.slice(prefix.length) : undefined;
  };

  const statusArg = (readArg("status") ?? "all").toLowerCase();
  let status: StatusFlag;
  if (statusArg === "c" || statusArg === "concluidos" || statusArg === "concluídos") {
    status = "C";
  } else if (statusArg === "a" || statusArg === "andamento" || statusArg === "em_andamento") {
    status = "A";
  } else {
    status = "all";
  }

  const defaultFromTo = (() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: fmtDate(start), to: fmtDate(end) };
  })();

  const from = readArg("from") ?? defaultFromTo.from;
  const to = readArg("to") ?? defaultFromTo.to;
  const ident = readArg("ident") ?? acessoriasDefaults.companyIdent;
  const maxMBArg = readArg("maxMB") ?? process.env.ACESSORIAS_MAX_MB;
  const maxMB = Number(maxMBArg ?? 5);
  const pageSizeValue = readArg("pageSize");
  const pageSize = pageSizeValue ? Number(pageSizeValue) : undefined;

  return {
    status,
    from,
    to,
    ident,
    pageSize: Number.isFinite(pageSize) ? pageSize : undefined,
    maxMB: Number.isFinite(maxMB) && maxMB > 0 ? maxMB : 5,
  };
}

function resolveStatuses(flag: StatusFlag): ("A" | "C")[] {
  if (flag === "all") {
    return ["A", "C"];
  }
  return [flag];
}

function computeFolderKey(status: "A" | "C", reference: string) {
  const normalized = reference ? reference.slice(0, 7).replace(/-/g, "") : "";
  if (normalized) {
    return `${status}-${normalized}`;
  }
  const now = new Date();
  return `${status}-${fmtDate(now).slice(0, 7).replace(/-/g, "")}`;
}

async function collectDeliveries(
  ident: string,
  from: string,
  to: string,
  dtLastDH: string,
  cache: Map<string, any[]>,
) {
  const cacheKey = `${ident}|${from}|${to}|${dtLastDH}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? [];
  }

  const items = await fetchAllPages((page) => listDeliveries({ ident, page, from, to, dtLastDH }));
  cache.set(cacheKey, items);
  return items;
}

async function main() {
  const args = parseArgs();
  const statuses = resolveStatuses(args.status);
  const maxBytes = args.maxMB * 1024 * 1024;
  const deliveriesCache = new Map<string, any[]>();
  const dtLastDhDefault = fmtDH(new Date());

  ensureDir(OUT_ROOT);

  let processed = 0;
  for (const status of statuses) {
    console.log(`Consultando processos com status ${status}...`);
    for (let page = 1; ; page += 1) {
      const processes = (await listProcesses({
        status,
        page,
        pageSize: args.pageSize,
        DtInitial: args.from,
        DtFinal: args.to,
      })) as ProcessSummary[];

      if (!processes.length) {
        console.log(`Status ${status}: página ${page} sem resultados, encerrando.`);
        break;
      }

      console.log(`Status ${status}: página ${page} com ${processes.length} processos.`);

      for (const processSummary of processes) {
        const procId =
          processSummary?.ProcID ??
          processSummary?.id ??
          processSummary?.ProcId ??
          processSummary?.idAcessorias ??
          processSummary?.ProcessoID;

        if (!procId) {
          console.warn("Processo sem ProcID detectado, ignorando registro.", processSummary);
          continue;
        }

        try {
          const detail = await getProcessById<any>(String(procId));
          const companyName =
            detail?.EmpNome ??
            detail?.EmpresaNome ??
            detail?.empresa?.nome ??
            processSummary?.EmpNome ??
            processSummary?.empresa?.nome ??
            "";
          const folderSuffix = computeFolderKey(status, args.from || "");
          const dirName = `${procId}-${sanitize(companyName)}-${folderSuffix}`;
          const processDir = path.join(OUT_ROOT, dirName);
          ensureDir(processDir);

          const headerTxt = headerToTxt(detail, processSummary);
          writeChunked(path.join(processDir, "00_header.txt"), headerTxt, maxBytes);

          const stepsTxt = stepsToTxt(detail);
          writeChunked(path.join(processDir, "10_passos.txt"), stepsTxt, maxBytes);

          let deliveries: any[] = [];
          let deliveriesIdent: string | null = null;
          const cnpj = (detail?.EmpCNPJ ?? detail?.empresa?.cnpj ?? "").replace(/\D+/g, "");
          const shouldFetchDeliveries = Boolean(args.from && args.to);

          if (shouldFetchDeliveries) {
            if (cnpj) {
              deliveriesIdent = cnpj;
            } else if (args.ident && args.ident !== "Geral") {
              deliveriesIdent = args.ident;
            }

            if (deliveriesIdent) {
              deliveries = await collectDeliveries(
                deliveriesIdent,
                args.from,
                args.to,
                dtLastDhDefault,
                deliveriesCache,
              );
            }
          }

          const deliveriesTxt = deliveriesToTxt(deliveries);
          writeChunked(path.join(processDir, "20_entregas.txt"), deliveriesTxt, maxBytes);

          const rawPayload = {
            status,
            summary: processSummary,
            detail,
            deliveriesIdent: deliveriesIdent ?? undefined,
            deliveries,
            period: { from: args.from, to: args.to, dtLastDH: dtLastDhDefault },
          };
          fs.writeFileSync(
            path.join(processDir, "raw.json"),
            Buffer.from(JSON.stringify(rawPayload, null, 2)),
          );

          processed += 1;
        } catch (error) {
          console.error(`Falha ao processar ProcID ${procId}:`, error);
        }
      }
    }
  }

  console.log(`Dump finalizado. Processos exportados: ${processed}. Arquivos em ${OUT_ROOT}`);
}

main().catch((error) => {
  console.error("ERRO no dump:", error);
  process.exit(1);
});
