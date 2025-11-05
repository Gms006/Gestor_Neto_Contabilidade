// src/repositories/acessoriasRepo.ts
import { Empresa, Processo, Entrega, Etapa } from "@prisma/client";
import { logger } from "../lib/logger";
import { ACompany, AProcess, ADelivery, AStep } from "../types/acessorias"; // Tipos da API
import { ProcessoDTO, EntregaDTO, EmpresaDTO } from "../types/acessorias"; // Tipos DTO (se existirem)

import { prisma } from "../lib/prisma";

// Função auxiliar para garantir que a empresa existe
async function ensureEmpresa(idAcessorias: number, dto?: EmpresaDTO): Promise<Empresa> {
  const data: any = {
    idAcessorias: idAcessorias,
    cnpj: dto?.cnpj ?? "00.000.000/0000-00", // Placeholder
    nome: dto?.nome ?? `Empresa ${idAcessorias}`, // Placeholder
    nomeFantasia: dto?.nomeFantasia ?? null,
    email: dto?.email ?? null,
    telefone: dto?.telefone ?? null,
    cidade: dto?.cidade ?? null,
    uf: dto?.uf ?? null,
    dados: JSON.stringify(dto?.dados ?? {}),
  };

  // Se o DTO completo for fornecido, atualiza os dados
  if (dto) {
    data.cnpj = dto.cnpj;
    data.nome = dto.nome;
  }

  const empresa = await prisma.empresa.upsert({
    where: { idAcessorias: idAcessorias },
    create: data,
    update: data,
  });

  return empresa;
}

// ---------- EMPRESAS ----------
export async function upsertEmpresa(dto: EmpresaDTO): Promise<Empresa> {
  if (!dto.idAcessorias) throw new Error("EmpresaDTO sem idAcessorias");
  return ensureEmpresa(dto.idAcessorias, dto);
}

// ---------- PROCESSOS & ETAPAS ----------
export async function upsertProcesso(dto: ProcessoDTO): Promise<{ processo: Processo, etapasCount: number }> {
  if (!dto.idAcessorias) throw new Error("ProcessoDTO sem idAcessorias");

  // 1. Garantir que a empresa existe e obter o ID local
  let empresa: Empresa;
  if (dto.company && dto.company.idAcessorias) {
    empresa = await upsertEmpresa(dto.company);
  } else if (dto.empresaId) {
    // A API pode enviar apenas o ID da empresa (empresaId)
    empresa = await ensureEmpresa(dto.empresaId);
  } else {
    throw new Error("ProcessoDTO sem empresa vinculada");
  }

  // 2. Dados do Processo (ajustado conforme o schema.prisma corrigido)
  const data: any = {
    idAcessorias: dto.idAcessorias,
    empresaId: empresa.id, // FK local
    titulo: dto.titulo ?? null,
    departamento: dto.departamento ?? null,
    status: dto.status ?? "PENDENTE", // Assumindo um status padrão
    gestor: dto.gestor ?? null,
    dataInicio: dto.dataInicio ? new Date(dto.dataInicio) : null,
    dataConclusao: dto.dataConclusao ? new Date(dto.dataConclusao) : null,
    previsao: dto.previsao ? new Date(dto.previsao) : null,
    dados: JSON.stringify(dto), // Salva o payload bruto
  };

  const processo = await prisma.processo.upsert({
    where: { idAcessorias: dto.idAcessorias },
    create: data,
    update: data,
  });

  // 3. Etapas — estratégia simples e consistente: apaga e recria
  let etapasCount = 0;
  if (Array.isArray(dto.steps)) {
    await prisma.etapa.deleteMany({ where: { processoId: processo.id } });

    if (dto.steps.length) {
      const etapasData = dto.steps.map((s: AStep) => ({
        processoId: processo.id,
        idAcessorias: s.idAcessorias ?? null,
        nome: s.nome ?? "Sem nome",
        status: s.status ?? "PENDENTE",
        realizadoEm: s.realizadoEm ? new Date(s.realizadoEm) : null,
        dados: JSON.stringify(s),
      }));

      const result = await prisma.etapa.createMany({ data: etapasData });
      etapasCount = result.count;
    }
  }

  return { processo, etapasCount };
}

// ---------- ENTREGAS ----------
export async function upsertEntrega(dto: EntregaDTO): Promise<Entrega> {
  if (!dto.idAcessorias) throw new Error("EntregaDTO sem idAcessorias");

  // 1. Garantir que a empresa existe e obter o ID local
  let empresa: Empresa;
  if (dto.company && dto.company.idAcessorias) {
    empresa = await upsertEmpresa(dto.company);
  } else if (dto.empresaId) {
    empresa = await ensureEmpresa(dto.empresaId);
  } else {
    // Cria um placeholder "desanexado" se não houver empresa
    empresa = await prisma.empresa.upsert({
      where: { idAcessorias: -1 }, // id artificial (garante único)
      create: { idAcessorias: -1, cnpj: "00.000.000/0000-00", nome: "Placeholder", dados: JSON.stringify({ placeholder: true }) },
      update: {},
    });
  }

  // 2. Dados da Entrega (ajustado conforme o schema.prisma corrigido)
  const data: any = {
    idAcessorias: dto.idAcessorias,
    empresaId: empresa.id, // FK local
    titulo: dto.titulo ?? null,
    competencia: dto.competencia ?? null,
    tipo: dto.tipo ?? null,
    situacao: dto.status ?? "PENDENTE", // Mapeamento: dto.status -> situacao
    dataEvento: dto.vencimento ? new Date(dto.vencimento) : null, // Mapeamento: vencimento -> dataEvento
    payload: JSON.stringify(dto), // Salva o payload bruto
  };

  const entrega = await prisma.entrega.upsert({
    where: { idAcessorias: dto.idAcessorias },
    create: data,
    update: data,
  });

  return entrega;
}

// ---------- BATCH HELPERS ----------
export async function upsertEmpresasBatch(items: EmpresaDTO[]) {
  for (const c of items) {
    try {
      await upsertEmpresa(c);
    } catch (e: any) {
      logger.error({ err: e?.message, c }, "Falha ao upsertEmpresa");
    }
  }
}

export async function upsertProcessosBatch(items: ProcessoDTO[]): Promise<{ totalProcesses: number, totalEtapas: number }> {
  let totalProcesses = 0;
  let totalEtapas = 0;
  for (const p of items) {
    try {
      const { processo, etapasCount } = await upsertProcesso(p);
      totalProcesses++;
      totalEtapas += etapasCount;
    } catch (e: any) {
      logger.error({ err: e?.message, p }, "Falha ao upsertProcesso");
    }
  }
  return { totalProcesses, totalEtapas };
}

export async function upsertEntregasBatch(items: EntregaDTO[]) {
  for (const d of items) {
    try {
      await upsertEntrega(d);
    } catch (e: any) {
      logger.error({ err: e?.message, d }, "Falha ao upsertEntrega");
    }
  }
}

// Não é necessário upsertEtapasBatch, pois as etapas são inseridas dentro do upsertProcesso.

// ---------- SYNC STATE ----------
export async function getSyncState(key: string): Promise<string | null> {
  const row = await prisma.syncState.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSyncState(key: string, value: string): Promise<void> {
  await prisma.syncState.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
