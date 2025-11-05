// src/tools/dumpProcesses.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  listAllProcesses,
  listAllCompanies,
  getProcessById,
  listDeliveriesByProcess
} from '../clients/acessoriasClient.js';

type Args = {
  status: 'all'|'concluido'|'em_andamento';
  limit: number;
  splitMB: number;
  deliveries: boolean;
  companies: boolean;
  outDir: string;
  paramProcId: string; // nome do parâmetro que a API usa para filtrar entregas por processo
};

const defaults: Args = {
  status: 'all',
  limit: 10000,
  splitMB: 15,
  deliveries: true,
  companies: true,
  outDir: 'backend/output/matriz_processos',
  paramProcId: process.env.ACESSORIAS_QS_PROCESS_ID || 'ProcessoId',
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: any = { ...defaults };
  for (let i=0;i<argv.length;i++) {
    const a = argv[i], v = argv[i+1];
    if (a === '--status' && v) { args.status = v; i++; continue; }
    if (a === '--limit' && v) { args.limit = Number(v); i++; continue; }
    if (a === '--splitMB' && v) { args.splitMB = Number(v); i++; continue; }
    if (a === '--no-deliveries') { args.deliveries = false; continue; }
    if (a === '--no-companies') { args.companies = false; continue; }
    if (a === '--outDir' && v) { args.outDir = v; i++; continue; }
    if (a === '--procParam' && v) { args.paramProcId = v; i++; continue; }
  }
  return args as Args;
}

async function appendChunk(baseDir: string, idx: number, text: string, splitMB: number): Promise<number> {
  const file = path.resolve(baseDir, `processos_${String(idx).padStart(3,'0')}.txt`);
  const max = splitMB * 1024 * 1024;
  let current = '';
  try { current = await fs.readFile(file, 'utf8'); } catch {}
  if (Buffer.byteLength(current) + Buffer.byteLength(text) > max) {
    return appendChunk(baseDir, idx+1, text, splitMB);
  }
  await fs.mkdir(baseDir, { recursive: true });
  await fs.writeFile(file, current + text, 'utf8');
  return idx;
}

async function main() {
  const args = parseArgs();
  console.log('[dump] start', args);

  const qs: Record<string, any> = {};
  if (args.status === 'concluido') qs.Status = 'Concluido';
  if (args.status === 'em_andamento') qs.Status = 'EmAndamento';

  const processes = await listAllProcesses(qs);
  const limited = processes.slice(0, args.limit);
  const companies = args.companies ? await listAllCompanies() : [];

  const outBase = path.resolve(process.cwd(), args.outDir);
  await fs.mkdir(outBase, { recursive: true });

  let chunk = 1;
  const jsonl: string[] = [];

  for (let i = 0; i < limited.length; i++) {
    const p: any = limited[i];
    const pid = p.id ?? p.ID ?? p.ProcessoId;
    const detailed = await getProcessById(pid);
    const deliveries = args.deliveries ? await listDeliveriesByProcess(pid, args.paramProcId) : [];
    const company = companies.find(c => String(c.id ?? c.empresaId) === String(p.empresaId ?? p.EmpresaId)) || null;

    const full = { process: p, detailed, deliveries, company };
    const txt = JSON.stringify(full, null, 2) + '\n\n';
    chunk = await appendChunk(outBase, chunk, txt, args.splitMB);
    jsonl.push(JSON.stringify(full));

    if ((i+1) % 50 === 0) console.log(`[dump] ${i+1}/${limited.length}`);
  }

  await fs.writeFile(path.join(outBase, 'processos.jsonl'), jsonl.join('\n'), 'utf8');
  console.log('[dump] done at', outBase);
}

main().catch(e => {
  console.error('[dump] ERRO', e?.message || e);
  process.exit(1);
});
