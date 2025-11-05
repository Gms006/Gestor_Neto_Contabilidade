# Gestor Neto Contabilidade

Sistema de gestão de processos e obrigações fiscais integrado com a API Acessórias.

## 🚀 Melhorias Implementadas

### Banco de Dados SQLite

- **Persistência local** com SQLAlchemy para funcionamento offline
- Modelos: `Company`, `Process`, `Delivery`
- Sincronização automática com a API
- Snapshots JSON mantidos como fallback

### API REST com FastAPI

- **Servidor local** em `http://localhost:8088`
- Endpoints disponíveis:
  - `GET /api/processes` - Lista processos com filtros
  - `GET /api/companies` - Lista empresas
  - `GET /api/deliveries` - Lista obrigações fiscais
  - `GET /api/kpis` - KPIs pré-computados
  - `POST /api/sync` - Dispara sincronização
- Frontend consome API com fallback automático para JSON

### Coleta Correta de Dados

#### Processos
- Busca todos os status incluindo **Concluídos**
- Suporte a filtros e paginação
- Controle incremental com `DtLastDH`

#### Deliveries (Obrigações)
- **Histórico**: busca por CNPJ (últimos 6 meses)
- **Delta diário**: via `ListAll` com `DtLastDH`
- Categorização automática: REINF, EFD Contrib, DIFAL
- Subtipo DIFAL: comercialização, consumo/imobilizado, ambos

### Rate Limiting

- Configurável via `ACESSORIAS_RATE_BUDGET` no `.env`
- Padrão: 70 req/min (~0,86s entre chamadas)
- Backoff exponencial para erro 429
- Respeita header `Retry-After`

### KPIs Aprimorados

- Dia médio de fechamento de processos
- Dia mediano de fechamento
- Contadores por status e categoria
- Dashboard populado com dados reais

## 📋 Requisitos

- Python 3.10+
- Dependências listadas em `requirements.txt`

## 🔧 Instalação

### 1. Criar ambiente virtual (opcional mas recomendado)

```powershell
python -m venv .venv
.venv\Scripts\activate
```

### 2. Instalar dependências

```powershell
pip install -r requirements.txt
```

### 3. Configurar `.env`

O arquivo `.env` já está configurado com:

```env
ACESSORIAS_TOKEN=seu_token_aqui
TZ=America/Sao_Paulo

# Database
DB_URL=sqlite:///data/econtrole.db

# Rate limiting (requisições por minuto)
ACESSORIAS_RATE_BUDGET=70
```

## 🎯 Uso

### Coleta Completa de Dados

Execute o pipeline completo:

```powershell
.\run_all.ps1
```

Isso irá:
1. Buscar processos da API (incluindo concluídos)
2. Buscar deliveries (histórico + delta)
3. Buscar empresas
4. Processar steps
5. Fundir fontes (API + email)
6. Calcular KPIs e alertas
7. Persistir tudo no banco SQLite
8. Gerar snapshots JSON para fallback

### Iniciar Servidor Web

```powershell
.\run_all.ps1 -Serve
```

Ou manualmente:

```powershell
python -m uvicorn scripts.server:app --host 127.0.0.1 --port 8088
```

Acesse:
- **Frontend**: http://localhost:8088/web/
- **API**: http://localhost:8088/api/
- **Documentação da API**: http://localhost:8088/docs

### Coleta Incremental

Para atualizar apenas dados novos:

```powershell
python -m scripts.fetch_api
python -m scripts.fetch_deliveries
python -m scripts.fetch_companies
```

## 📊 Estrutura do Banco de Dados

### Tabela `companies`
- `id` (PK): CNPJ normalizado (apenas dígitos)
- `nome`: Razão social
- `cnpj`: CNPJ formatado
- `updated_at`: Data de atualização

### Tabela `processes`
- `proc_id` (PK): ID único do processo
- `titulo`: Nome do processo
- `status`: Status (Concluído, Em andamento, etc.)
- `inicio`, `conclusao`: Datas
- `dias_corridos`: Duração
- `gestor`: Responsável
- `company_id` (FK): Referência à empresa
- `last_dh`: Controle incremental
- `raw_data`: JSON completo

### Tabela `deliveries`
- `id` (PK): Hash SHA1 de company_id + nome + competência
- `company_id` (FK): Referência à empresa
- `nome`: Nome da obrigação
- `categoria`: efd_reinf, efd_contrib, difal, outros
- `subtipo`: Para DIFAL (comercialização, consumo_imobilizado, ambos)
- `status`: Obrigatória, Dispensada, Pendente
- `competencia`: YYYY-MM
- `prazo`, `entregue_em`: Datas
- `raw_data`: JSON completo

## 🔌 API Endpoints

### `GET /api/processes`

Lista processos com filtros opcionais.

**Parâmetros:**
- `status`: Filtrar por status (ex: "Concluído")
- `pagina`: Número da página (padrão: 1)
- `limite`: Itens por página (padrão: 100, máx: 10000)
- `empresa`: Filtrar por CNPJ
- `desde`: Data inicial (YYYY-MM-DD)
- `ate`: Data final (YYYY-MM-DD)

**Exemplo:**
```
GET /api/processes?status=Concluído&limite=50
```

### `GET /api/deliveries`

Lista obrigações fiscais com filtros.

**Parâmetros:**
- `from`: Data inicial (YYYY-MM-DD)
- `to`: Data final (YYYY-MM-DD)
- `cnpj`: Filtrar por CNPJ
- `categoria`: efd_reinf, efd_contrib, difal
- `status`: Obrigatória, Dispensada, etc.

**Exemplo:**
```
GET /api/deliveries?categoria=efd_reinf&from=2024-01-01
```

### `GET /api/companies`

Lista todas as empresas cadastradas.

### `GET /api/kpis`

Retorna KPIs pré-computados:
- Contadores de processos por status
- Dias médios de conclusão
- Dia médio/mediano de fechamento
- Contadores de obrigações

### `POST /api/sync`

Dispara sincronização de dados (retorna imediatamente).

## 🛡️ Resiliência

### Fallback Automático

O sistema funciona em três camadas:

1. **API REST** (servidor FastAPI rodando)
2. **Banco SQLite** (se API offline)
3. **Arquivos JSON** (se banco indisponível)

O frontend tenta automaticamente cada camada até obter dados.

### Rate Limiting

- Configurável via `ACESSORIAS_RATE_BUDGET`
- Retry automático com backoff exponencial
- Tratamento de erro 429 com `Retry-After`
- Logs estruturados sem expor tokens

## 📁 Estrutura de Arquivos

```
Gestor_Neto_Contabilidade-main/
├── .env                    # Configurações
├── requirements.txt        # Dependências Python
├── run_all.ps1            # Script principal
├── data/                  # Dados e banco
│   ├── econtrole.db       # Banco SQLite
│   ├── *.json             # Snapshots (fallback)
│   └── raw_api/           # Dumps individuais
├── scripts/               # Scripts Python
│   ├── db.py              # Modelos SQLAlchemy
│   ├── server.py          # Servidor FastAPI
│   ├── acessorias_client.py
│   ├── fetch_api.py
│   ├── fetch_deliveries.py
│   ├── fetch_companies.py
│   ├── fuse_sources.py
│   └── build_processes_kpis_alerts.py
└── web/                   # Frontend
    ├── index.html
    ├── app.js             # Atualizado com apiOrJson
    └── styles.css
```

## 🐛 Troubleshooting

### Banco de dados não inicializa

```powershell
# Deletar banco e recriar
Remove-Item data\econtrole.db
.\run_all.ps1
```

### API retorna 429 (Rate Limit)

Ajuste no `.env`:

```env
ACESSORIAS_RATE_BUDGET=50  # Reduzir para ~1.2s entre chamadas
```

### Dashboard vazio

Verifique se os dados foram coletados:

```powershell
# Ver processos no banco
python -c "from scripts.db import *; s=get_session(); print(s.query(Process).count())"

# Ver deliveries no banco
python -c "from scripts.db import *; s=get_session(); print(s.query(Delivery).count())"
```

### Servidor não inicia

Verifique se a porta 8088 está livre:

```powershell
netstat -ano | findstr :8088
```

## 📝 Logs

Logs são salvos em:
- `data/logs.txt` - Log estruturado
- `data/ps_run.log` - Log do PowerShell

## 🔄 Fluxo de Atualização

1. **Coleta**: `fetch_*` scripts buscam da API
2. **Persistência**: Dados salvos no SQLite
3. **Snapshot**: JSON gerados para fallback
4. **Processamento**: `fuse_sources` e `build_*` calculam KPIs
5. **Exposição**: FastAPI serve via REST
6. **Visualização**: Frontend consome API

## 📚 Documentação da API Acessórias

https://api.acessorias.com/documentation

## 🤝 Suporte

Para dúvidas ou problemas, consulte:
- `scripts/USAGE.md` - Documentação técnica dos scripts
- `tests/test_rules_mapping.md` - Mapeamento de regras

## ✅ Definition of Done

- [x] Banco SQLite com modelos completos
- [x] Rate limiting configurável (70 req/min)
- [x] Processos concluídos sendo buscados
- [x] Deliveries: histórico por CNPJ + delta ListAll
- [x] Servidor FastAPI funcionando
- [x] Frontend com fallback automático
- [x] KPIs incluindo dia médio/mediano de fechamento
- [x] Dashboard populado com dados reais
- [x] Sistema funciona offline (DB + JSON)
- [x] Logs limpos sem expor tokens
