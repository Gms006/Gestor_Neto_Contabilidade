# Sistema de Gestão Operacional Fiscal

Portal local para acompanhar obrigações, processos e alertas a partir da API Acessórias, entregas (deliveries) e e-mails padronizados.

## Pré-requisitos

- Windows com Python 3.10, 3.11, 3.12 ou 3.13 instalado (`py --version`).
- Token válido para a API Acessórias.
- Credenciais de e-mail IMAP (KingHost) quando a ingestão de mensagens estiver habilitada.

## Instalação

1. (Opcional) Crie e ative um ambiente virtual:
   ```powershell
   py -m venv .venv
   .\.venv\Scripts\activate
   ```

2. Instale as dependências Python (sem pacotes pesados):
   ```powershell
   py -m pip install --user -r requirements.txt
   ```

3. Copie o arquivo `.env.template` para `.env` e preencha as variáveis obrigatórias (veja abaixo).

4. Ajuste `scripts/config.json` se precisar alterar filtros de status ou janelas de entregas.

## Configuração

### Variáveis de ambiente (`.env`)

```ini
# API Acessórias
ACESSORIAS_TOKEN=COLOQUE_SEU_TOKEN_AQUI
TZ=America/Sao_Paulo

# E-mail (IMAP - KingHost)
MAIL_HOST=imap.kinghost.net
MAIL_PORT=993
MAIL_USER=contabil2@netocontabilidade.com.br
MAIL_PASSWORD=SUA_SENHA_OU_SENHA_DE_APP
MAIL_USE_SSL=true
MAIL_FOLDER=INBOX
```

- `ACESSORIAS_BASE_URL` é opcional caso utilize outro ambiente.
- As credenciais de IMAP são usadas pelo `scripts.fetch_email_imap` (execução tolerante a falhas).

### `scripts/config.json`

```json
{
  "acessorias": {
    "base_url": "https://api.acessorias.com",
    "page_size": 20,
    "rate_budget": 90,
    "statuses": ["A", "C"],
    "dt_last_dh": null
  },
  "deliveries": {
    "enabled": true,
    "identificador": "ListAll",
    "days_back": 40,
    "days_forward": 10,
    "use_dt_last_dh": true
  },
  "deadlines": {
    "reinf_day": 15,
    "efd_contrib_day": 20,
    "risk_window_days": 5
  },
  "imap": {
    "search_days": 180
  }
}
```

- `statuses` controla quais `ProcStatus` serão buscados; a lista é percorrida status a status.
- `rate_budget` (requisições por minuto) define o espaçamento entre páginas em todos os endpoints.
- `deliveries.days_back/days_forward` geram uma janela diária para `deliveries/ListAll`, respeitando `DtLastDH` incremental com piso em ontem 00:00.

## Execução

### Coleta completa

PowerShell:
```powershell
.\run_all.bat
```

Prompt (CMD):
```cmd
run_all.bat
```

### Incremental rápido

PowerShell:
```powershell
.\run_incremental.bat
```

O fluxo executa, em ordem:
1. `scripts.fetch_api` (processos, incremental via `DtLastDH`).
2. `scripts.fetch_deliveries` (loop diário e `DtLastDH`).
3. `scripts.fetch_companies` (obrigações agregadas por empresa).
4. `scripts.flatten_steps` (eventos de processos + obrigações).
5. `scripts.fetch_email_imap` (tolerante a falhas).
6. `scripts.fuse_sources` (dedup e prioridade por fonte).
7. `scripts.build_processes_kpis_alerts` (processos normalizados, KPIs, alertas, `meta.json`).

Logs estruturados são gravados em `data/logs.txt` (`ts;component;level;msg;extra`).

## Dados gerados

Após `run_all.bat`, a pasta `data/` conterá (entre outros):

- `api_processes.json` — snapshot bruto dos processos com normalização de datas/CNPJ.
- `deliveries_raw.json` — entregas coletadas diariamente, incluindo blocos `config`.
- `companies_obligations.json` — obrigações agregadas por empresa (entregues, atrasadas, próximos 30 dias, futuras).
- `events_api.json` — eventos combinando passos de processos e obrigações (categoria `process_step`/`obrigacao`).
- `events_email.json` — eventos extraídos de e-mails (quando disponíveis).
- `events.json` — fusão deduplicada (prioriza API para obrigações e e-mail para mensagens tipo MIT/dispensa/confirmação).
- `processes.json`, `kpis.json`, `alerts.json` — insumos diretos do portal.
- `meta.json` — contém `last_update_utc` e contagens de itens para exibir no cabeçalho do site.
- `.sync_state.json` — controles incrementais (`api.last_sync`, `deliveries.last_sync`, etc.).

## Portal Web (web/)

- Abra `web/index.html` em qualquer navegador moderno. O layout usa Tailwind via CDN e possui CSS local de fallback.
- O cabeçalho exibe “Atualizado em …” lendo `data/meta.json`. O botão “🔄 Atualizar dados” limpa o cache em memória e, opcionalmente, chama um endpoint local se existir `web/config.local.json` com `{ "update_url": "http://127.0.0.1:8765/update" }`.
- As abas Dashboard, Obrigações, Processos, Alertas e Empresas oferecem busca, filtros, ordenação, paginação (50/100/200 itens) e exportação CSV. Pressionar **Enter** em campos de busca aciona o filtro.
- Filtros e paginação são persistidos por aba em `localStorage`. A URL usa hash (`#tab=...`) para restaurar a navegação.
- Para demonstrações sem rodar a pipeline, copie manualmente os arquivos de `data-samples/` para `data/` antes de abrir o site.

## Troubleshooting

| Sintoma | Como tratar |
| --- | --- |
| HTTP 401/403 | Verifique `ACESSORIAS_TOKEN` e permissões do usuário. |
| HTTP 404 nos endpoints `ListAll*/` | A API pode não expor a variante com `*`; o cliente tenta `ListAll/` automaticamente, mas se todas falharem revise a instalação. |
| HTTP 204 | Tratado como página vazia; não interrompe a execução. |
| HTTP 429 | O cliente aplica backoff exponencial (1s → 16s) e respeita `rate_budget`. Se persistir, reduza o orçamento. |
| Falha IMAP | O passo é tolerante (não aborta). Confira host/porta/SSL no `.env`. |
| Última atualização não muda | Certifique-se de que `scripts.build_processes_kpis_alerts` gerou `data/meta.json` e recarregue o portal com o botão “Atualizar dados”. |

