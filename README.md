# Sistema de Gestão Operacional Fiscal

Sistema para consolidação de dados da API Acessórias e de notificações recebidas por e-mail.

## Setup rápido

1) Python 3.10+ e venv:
   ```bash
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   source .venv/bin/activate  # Unix-like
   pip install -r requirements.txt
   ```

2) Crie o arquivo `.env` a partir de `.env.template` e preencha localmente:

   - `ACESSORIAS_TOKEN`
   - `MAIL_USER` e `MAIL_PASSWORD` (ideal: senha de app)

   Nunca faça commit de `.env`.

3) Execute a pipeline:

   - **Windows:** `run_all.bat`
   - **Unix:** `./run_all.sh`

4) Abra `web/index.html` e veja os dados gerados em `data/*.json`.

### Coleta de e-mails

- Provider: IMAP (KingHost) `imap.kinghost.net:993` (SSL)
- Filtros configuráveis em `scripts/config.json` → `imap.subject_keywords` e `imap.from_filters`.
- Eventos extraídos: REINF (Obrigatória/Dispensada), EFD Contribuições (Obrigatória/Dispensada), DIFAL (tipos), “fora do DAS” (ISS/ICMS/ambos), Finalização de processo, além de ProcID, Empresa, CNPJ, Responsável e Competência quando disponíveis.

### Segurança

- `.env`, `credentials.json` e `token.json` estão listados em `.gitignore`.
- Não suba credenciais no repositório.

## Estrutura

- `scripts/` – Scripts Python de coleta e processamento.
- `data/` – Pasta de saída dos JSON gerados (criada em tempo de execução).
- `web/` – Interface HTML/JS que lê os arquivos de `data/`.

## Pipeline

1. `scripts/fetch_api.py` – Busca processos na API Acessórias.
2. `scripts/flatten_steps.py` – Extrai eventos dos passos dos processos.
3. `scripts/fetch_email_imap.py` – Lê e-mails via IMAP (KingHost) e gera eventos.
4. `scripts/fuse_sources.py` – Mescla eventos da API e do e-mail, gerando divergências.
5. `scripts/build_processes_kpis_alerts.py` – Gera processos, KPIs e alertas.
6. `web/index.html` – Visualiza os dados agregados.
