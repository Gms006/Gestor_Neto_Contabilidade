export const env = {
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: process.env.DATABASE_URL ?? "file:./gestor.db",
  ACESSORIAS_BASE_URL: process.env.ACESSORIAS_BASE_URL ?? "https://api.acessorias.com",
  ACESSORIAS_TOKEN: process.env.ACESSORIAS_TOKEN ?? ""
};
