import { Delivery } from "@prisma/client";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { ensureStringId, pickDate, pickString, stringifyJson } from "./helpers";

export type RawDelivery = Record<string, unknown>;

const DELIVERY_ID_FIELDS = [
  "EntregaId",
  "entregaId",
  "DeliveryId",
  "deliveryId",
  "ID",
  "id",
  "externalId",
  "Identificador",
  "identificador",
];

const PROCESS_ID_FIELDS = [
  "ProcessoId",
  "processoId",
  "ProcId",
  "procId",
  "ProcessId",
  "processId",
  "ProcCod",
  "procCod",
];

const TYPE_FIELDS = ["Tipo", "tipo", "Type", "type"];
const DESCRIPTION_FIELDS = ["Descricao", "descricao", "Description", "description", "Titulo", "titulo"];
const STATUS_FIELDS = ["Status", "status", "Situacao", "situacao"];
const OCCURRED_AT_FIELDS = ["DtEvento", "dtEvento", "Data", "data", "DataEvento", "dataEvento"];
const DUE_AT_FIELDS = ["DtVencimento", "dtVencimento", "Vencimento", "vencimento"];

function extractExternalId(payload: RawDelivery): string | null {
  const candidates = DELIVERY_ID_FIELDS.map((field) => payload[field]);
  return ensureStringId(candidates, "delivery");
}

function extractProcessExternalId(payload: RawDelivery): string | null {
  const candidates = PROCESS_ID_FIELDS.map((field) => payload[field]);
  return ensureStringId(candidates, "process");
}

export async function upsertDeliveryForProcess(
  processExternalId: string,
  payload: RawDelivery
): Promise<Delivery | null> {
  const externalId = extractExternalId(payload);
  if (!externalId) {
    logger.warn({ payload }, "Ignorando entrega sem identificador externo");
    return null;
  }

  const processExternal = extractProcessExternalId(payload) ?? processExternalId;
  const process = await prisma.process.findUnique({ where: { externalId: processExternal } });
  if (!process) {
    logger.warn({ externalId: processExternal, payload }, "Ignorando entrega sem processo conhecido");
    return null;
  }

  const type = pickString(TYPE_FIELDS.map((field) => payload[field]));
  const description = pickString(DESCRIPTION_FIELDS.map((field) => payload[field]));
  const statusRaw = pickString(STATUS_FIELDS.map((field) => payload[field]));
  const occurredAt = pickDate(OCCURRED_AT_FIELDS.map((field) => payload[field]));
  const dueAt = pickDate(DUE_AT_FIELDS.map((field) => payload[field]));

  return prisma.delivery.upsert({
    where: { externalId },
    create: {
      externalId,
      processId: process.id,
      type,
      description,
      statusRaw,
      occurredAt: occurredAt ?? null,
      dueAt: dueAt ?? null,
      raw: stringifyJson(payload),
    },
    update: {
      processId: process.id,
      type,
      description,
      statusRaw,
      occurredAt: occurredAt ?? null,
      dueAt: dueAt ?? null,
      raw: stringifyJson(payload),
    },
  });
}

export async function upsertDeliveriesBatch(
  processExternalId: string,
  deliveries: RawDelivery[]
): Promise<number> {
  let count = 0;
  for (const delivery of deliveries) {
    try {
      const upserted = await upsertDeliveryForProcess(processExternalId, delivery);
      if (upserted) {
        count += 1;
      }
    } catch (error) {
      logger.error({ err: (error as Error).message, delivery }, "Falha ao processar entrega");
    }
  }
  return count;
}
