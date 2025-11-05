// src/lib/env.ts
import * as dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env "${name}" ausente no .env`);
  return v;
}

const DEFAULT_ACESSORIAS_BASE = "https://api.acessorias.com";

function resolveAcessoriasBase() {
  const candidate =
    process.env.ACESSORIAS_API_BASE ?? process.env.ACESSORIAS_BASE_URL ?? "";
  return candidate.trim() || DEFAULT_ACESSORIAS_BASE;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 8088),

  // Acessórias API
  ACESSORIAS_BASE_URL: resolveAcessoriasBase(),
  ACESSORIAS_API_BASE: resolveAcessoriasBase(),
  ACESSORIAS_TOKEN: required("ACESSORIAS_TOKEN"),

  // ✅ alias compatível com o acessoriasClient
  acessorias: {
    baseURL: resolveAcessoriasBase(),
    apiBase: resolveAcessoriasBase(),
    token: required("ACESSORIAS_TOKEN"),
  },

  // Prisma logs opcionais: PRISMA_LOG=query,info,warn,error
  PRISMA_LOG: process.env.PRISMA_LOG ?? "",
};
