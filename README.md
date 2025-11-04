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
   - Preencha `ACESSORIAS_TOKEN`
   - Coloque `credentials.json` do Gmail na raiz

4. Execute:
```bash
run_all.bat
```

5. Abra o dashboard:
   - Navegador: `web\index.html`

## Estrutura

- `scripts/` - Scripts Python de coleta e processamento
- `data/` - Dados gerados (JSON)
- `web/` - Interface HTML/JS
- `tests/` - Amostras e testes

## Configuração

- `scripts/config.json` - Endpoints, prazos, queries
- `scripts/rules.json` - Mapeamento de passos para categorias
- `.env` - Tokens e credenciais (NÃO COMMITAR)

## Funcionamento

1. `fetch_api.py` - Busca processos da API Acessórias
2. `flatten_steps.py` - Extrai eventos dos passos
3. `fetch_email.py` - Busca e-mails do Gmail
4. `fuse_sources.py` - Mescla API + email
5. `build_processes_kpis_alerts.py` - Gera KPIs e alertas
6. `web/index.html` - Visualiza dashboards

## Front-end (site)

- Os dados do portal são lidos diretamente dos arquivos `data/events.json`, `data/processes.json`, `data/kpis.json` e `data/alerts.json` gerados pela pipeline.
- Para visualizar, abra o arquivo `web/index.html` no navegador (não é necessário servidor). O layout utiliza Tailwind via CDN e os gráficos são renderizados com Chart.js.
- Cada aba (Dashboard, Obrigações, Processos, Alertas e Empresas) possui busca global, filtros avançados, ordenação clicável, paginação (50/100/200 itens) e exportação CSV conforme aplicável. Pressionar <kbd>Enter</kbd> nos campos de busca aciona o filtro.
- Os filtros e opções de paginação são persistidos por aba em `localStorage`, e o hash da URL mantém a aba ativa e os filtros-chave para compartilhamento (`#tab=obrigacoes&q=...&status=...`).
- Use o botão “🔄 Atualizar dados” no topo da página para recarregar os arquivos JSON localmente.
- Para demonstrações sem pipeline, copie manualmente os arquivos de `data-samples/` para a pasta `data/` antes de abrir o site.
