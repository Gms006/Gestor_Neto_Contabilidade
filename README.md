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
