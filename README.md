# Sistema de Gestão Operacional Fiscal

Sistema para consolidação de dados da API Acessórias e e-mails padronizados.

## Instalação

1. Crie ambiente virtual:
```bash
python -m venv .venv
.venv\Scripts\activate
```

2. Instale dependências:
```bash
pip install -r requirements.txt
```

3. Configure credenciais:
   - Copie `.env.template` para `.env`
   - Preencha `ACESSORIAS_TOKEN` (obrigatório) e, se necessário, `ACESSORIAS_BASE_URL` / `ACESSORIAS_RATE_SLEEP`
   - Coloque `credentials.json` do Gmail na raiz

4. Execute a coleta completa:
```bash
run_all.bat
```

5. Para incrementais rápidos (usa `.sync_state.json` como referência):
```bash
run_incremental.bat
```

6. Abra o dashboard:
   - Navegador: `web\index.html`

## Estrutura

- `scripts/` - Scripts Python de coleta e processamento
- `data/` - Dados gerados (JSON)
- `web/` - Interface HTML/JS
- `tests/` - Amostras e testes

## Configuração

- `scripts/config.json` - Endpoints, filtros de status, janelas de Deliveries/Invoices
- `scripts/rules.json` - Mapeamento de passos para categorias
- `.env` - Tokens e credenciais (NÃO COMMITAR)
- `data/.sync_state.json` - Controle incremental por endpoint

### Variáveis de ambiente (.env)

- `ACESSORIAS_TOKEN` — obrigatório para autenticar na API.
- `ACESSORIAS_BASE_URL` — opcional para apontar para outro ambiente da API.
- `ACESSORIAS_RATE_SLEEP` — opcional, tempo (segundos) entre páginas para respeitar o rate limit.

## Funcionamento

1. `fetch_api.py` - Busca processos da API Acessórias (incremental por `ProcStatus` com fallback e paginação)
2. `fetch_deliveries.py` - Busca entregas (`deliveries`) respeitando janela de datas e `DtLastDH`
3. `flatten_steps.py` - Extrai eventos dos passos
4. `fetch_email.py` / `fetch_email_imap.py` - Busca e-mails do Gmail
5. `fuse_sources.py` - Mescla API + email
6. `build_processes_kpis_alerts.py` - Gera KPIs e alertas
7. `web/index.html` - Visualiza dashboards

### Incrementalidade e janelas de datas

- `fetch_api.py` grava `data/.sync_state.json` com `api.processes_last_dh` em UTC. Na próxima execução aplica janela de segurança de 5 minutos para não perder registros.
- `fetch_deliveries.py` usa `api.deliveries_last_dh` (fallback para ontem 00:00) e exige janela `DtInitial`/`DtFinal` definida em `scripts/config.json` — por padrão utiliza o mês corrente. Para habilitar o endpoint, defina `deliveries.enabled = true`.
- Os números monetários vindos da API são normalizados para `float` e as datas convertidas para ISO (`YYYY-MM-DD` ou `YYYY-MM-DD HH:MM:SS`).
- Logs de execução ficam em `data/logs.txt`.

## Front-end (site)

- Os dados do portal são lidos diretamente dos arquivos `data/events.json`, `data/processes.json`, `data/kpis.json` e `data/alerts.json` gerados pela pipeline.
- Para visualizar, abra o arquivo `web/index.html` no navegador (não é necessário servidor). O layout utiliza Tailwind via CDN e os gráficos são renderizados com Chart.js.
- Cada aba (Dashboard, Obrigações, Processos, Alertas e Empresas) possui busca global, filtros avançados, ordenação clicável, paginação (50/100/200 itens) e exportação CSV conforme aplicável. Pressionar <kbd>Enter</kbd> nos campos de busca aciona o filtro.
- Os filtros e opções de paginação são persistidos por aba em `localStorage`, e o hash da URL mantém a aba ativa e os filtros-chave para compartilhamento (`#tab=obrigacoes&q=...&status=...`).
- Use o botão “🔄 Atualizar dados” no topo da página para recarregar os arquivos JSON localmente.
- Para demonstrações sem pipeline, copie manualmente os arquivos de `data-samples/` para a pasta `data/` antes de abrir o site.
