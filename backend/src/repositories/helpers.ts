import { isDate } from "date-fns";

export function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value.replace(/[^0-9.,-]/g, "").replace(",", "."));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function coerceString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

export function coerceDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (isDate(value)) {
    return value as Date;
  }
  const text = coerceString(value);
  if (!text) return null;
  const normalized = text.replace(/T/, " ");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function pickNumber(values: unknown[]): number | null {
  for (const value of values) {
    const coerced = coerceNumber(value);
    if (coerced !== null) {
      return coerced;
    }
  }
  return null;
}

export function pickString(values: unknown[]): string | null {
  for (const value of values) {
    const coerced = coerceString(value);
    if (coerced) {
      return coerced;
    }
  }
  return null;
}

export function pickDate(values: unknown[]): Date | null {
  for (const value of values) {
    const coerced = coerceDate(value);
    if (coerced) {
      return coerced;
    }
  }
  return null;
}

export function pickBoolean(values: unknown[]): boolean | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "sim") return true;
      if (normalized === "false" || normalized === "0" || normalized === "nao" || normalized === "não") return false;
    }
  }
  return null;
}

export function ensureStringId(values: unknown[], fallbackPrefix: string): string | null {
  const str = pickString(values);
  if (str) return str;
  const num = pickNumber(values);
  if (num !== null) return String(num);
  return null;
}

export function stringifyJson(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function serializeValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return stringifyJson(value);
}
