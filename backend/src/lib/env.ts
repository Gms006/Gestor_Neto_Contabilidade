// src/lib/env.ts
import * as dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env "${name}" ausente no .env`);
  return v;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 8088),

  // Acessórias API
  ACESSORIAS_BASE_URL: required("ACESSORIAS_BASE_URL"),
  ACESSORIAS_TOKEN: required("ACESSORIAS_TOKEN"),
  ACESSORIAS_API_BASE: process.env.ACESSORIAS_API_BASE ?? "",
  ACESSORIAS_API_VERSION: process.env.ACESSORIAS_API_VERSION ?? "",
  ACESSORIAS_PATH_LANG: process.env.ACESSORIAS_PATH_LANG ?? "en",

  // ✅ alias compatível com o acessoriasClient
  acessorias: {
    baseURL: required("ACESSORIAS_BASE_URL"),
    token: required("ACESSORIAS_TOKEN"),
    apiBase: process.env.ACESSORIAS_API_BASE ?? "",
    apiVersion: process.env.ACESSORIAS_API_VERSION ?? "",
    pathLang: process.env.ACESSORIAS_PATH_LANG ?? "en",
  },

  // Prisma logs opcionais: PRISMA_LOG=query,info,warn,error
  PRISMA_LOG: process.env.PRISMA_LOG ?? "",
};
