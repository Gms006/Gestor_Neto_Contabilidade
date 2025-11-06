import { Company } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { ensureStringId, pickString, serializeValue, stringifyJson } from "./helpers.js";

export type RawCompany = Record<string, unknown>;

const COMPANY_ID_CANDIDATES = [
  "EmpCod",
  "empCod",
  "IdEmpresa",
  "idEmpresa",
  "empresaId",
  "EmpresaId",
  "Identificador",
  "identificador",
  "id",
  "ID",
  "externalId",
];

const COMPANY_NAME_CANDIDATES = [
  "Nome",
  "nome",
  "razaoSocial",
  "RazaoSocial",
  "fantasia",
  "Fantasia",
  "descricao",
];

const COMPANY_DOCUMENT_CANDIDATES = [
  "CNPJ",
  "cnpj",
  "CPF",
  "cpf",
  "Documento",
  "documento",
];

const COMPANY_LEGAL_NAME_CANDIDATES = [
  "RazaoSocial",
  "razaoSocial",
  "nomeEmpresarial",
  "NomeEmpresarial",
];

const COMPANY_OBLIGATIONS_FIELDS = [
  "obligations",
  "Obrigacoes",
  "obrigacoes",
];

function extractExternalId(payload: RawCompany): string | null {
  const candidates = COMPANY_ID_CANDIDATES.map((key) => payload[key]);
  return ensureStringId(candidates, "company");
}

function extractName(payload: RawCompany): string {
  const candidates = COMPANY_NAME_CANDIDATES.map((key) => payload[key]);
  return pickString(candidates) ?? "Empresa sem nome";
}

function extractDocument(payload: RawCompany): string | null {
  const candidates = COMPANY_DOCUMENT_CANDIDATES.map((key) => payload[key]);
  return pickString(candidates);
}

function extractLegalName(payload: RawCompany): string | null {
  const candidates = COMPANY_LEGAL_NAME_CANDIDATES.map((key) => payload[key]);
  return pickString(candidates);
}

function extractObligations(payload: RawCompany): unknown {
  for (const field of COMPANY_OBLIGATIONS_FIELDS) {
    if (payload[field] !== undefined) {
      return payload[field];
    }
  }
  return undefined;
}

export async function upsertCompanyFromApi(payload: RawCompany): Promise<Company | null> {
  const externalId = extractExternalId(payload);
  if (!externalId) {
    logger.warn({ payload }, "Ignorando empresa sem identificador externo");
    return null;
  }

  const name = extractName(payload);
  const document = extractDocument(payload);
  const legalName = extractLegalName(payload);
  const obligations = extractObligations(payload);
  const obligationsSerialized = serializeValue(obligations);
  const rawJson = stringifyJson(payload);

  return prisma.company.upsert({
    where: { externalId },
    create: {
      externalId,
      name,
      document,
      legalName,
      obligations: obligationsSerialized,
      raw: rawJson,
    },
    update: {
      name,
      document,
      legalName,
      obligations: obligationsSerialized,
      raw: rawJson,
    },
  });
}

export async function upsertCompaniesBatch(companies: RawCompany[]): Promise<number> {
  let count = 0;
  for (const company of companies) {
    try {
      const upserted = await upsertCompanyFromApi(company);
      if (upserted) {
        count += 1;
      }
    } catch (error) {
      logger.error({ err: (error as Error).message, company }, "Falha ao processar empresa");
    }
  }
  return count;
}

export async function findCompanyByExternalId(externalId: string): Promise<Company | null> {
  return prisma.company.findUnique({ where: { externalId } });
}

export async function listCompanyExternalIds(): Promise<string[]> {
  const rows = await prisma.company.findMany({
    select: { externalId: true },
  });
  return rows
    .map(({ externalId }) => externalId.trim())
    .filter((value) => value.length > 0);
}
