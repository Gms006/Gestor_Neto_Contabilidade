import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT ?? 8088),
  dbUrl: process.env.DATABASE_URL ?? 'file:./gestor.db',
  acessorias: {
    baseURL: process.env.ACESSORIAS_BASE_URL ?? 'https://api.acessorias.com',
    token: process.env.ACESSORIAS_TOKEN ?? '',
  },
  cron: process.env.SYNC_INTERVAL_CRON ?? '0 */3 * * *',
};

if (!env.acessorias.token) {
  console.warn('[WARN] ACESSORIAS_TOKEN não definido. Rotas que chamam a API podem falhar.');
}
