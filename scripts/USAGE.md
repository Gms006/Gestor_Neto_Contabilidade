Dicas finais de uso

Mantenha em produção o arquivo `scripts/config.json` com esta configuração:

{
  "acessorias": { "page_size": 20, "rate_budget": 60 },
  "deliveries": {
    "enabled": true,
    "identificador": "ListByDate",
    "use_dt_last_dh": true,
    "days_back": 0,
    "days_forward": 0,
    "include_config": false
  }
}

Backfill
- Para retrocompatibilizar dados (backfill), rode em janelas pequenas (dia a dia) para reduzir carga e risco.
- Mantenha `rate_budget <= 90` quando fizer backfill. Preferível: rate_budget entre 60 e 90.

Run pipeline (`run_all.ps1`)
- Deixe `scripts.fetch_deliveries` tolerante a falhas temporárias da API (retry com backoff e/ou captura de exceções) para não travar o pipeline de produção quando a API estiver limitada.
- Se possível, introduza um timeout curto e registre falhas em log para análise posterior.

Observações rápidas
- `use_dt_last_dh: true` usa o timestamp salvo para sincronizações incrementais.
- `include_config: false` evita expor configurações sensíveis nas entregas.

Se quiser, eu posso aplicar mudanças de tolerância diretamente no `run_all.ps1` — diga se devo procurar o arquivo e editar o bloco onde `scripts.fetch_deliveries` é chamado.