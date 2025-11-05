# Changelog - Melhorias Implementadas

## 📅 Data: Novembro 2025

## 🎯 Objetivo
Integrar o sistema com a API do Acessórias, implementar persistência local com banco de dados SQLite, e criar servidor REST com FastAPI para funcionamento offline e online.

---

## ✨ Novas Funcionalidades

### 1. Banco de Dados SQLite com SQLAlchemy

#### Arquivos Criados:
- **`scripts/db.py`** - Modelos e helpers de banco de dados

#### Modelos Implementados:
- **Company**: Empresas (CNPJ, nome)
- **Process**: Processos da API (status, datas, gestor, etc.)
- **Delivery**: Obrigações fiscais (REINF, EFD, DIFAL)

#### Funcionalidades:
- Upsert automático (insert ou update)
- Chaves naturais e índices otimizados
- WAL mode para melhor concorrência
- Relacionamentos entre tabelas

### 2. Servidor REST com FastAPI

#### Arquivo Criado:
- **`scripts/server.py`** - Servidor HTTP com API REST

#### Endpoints Implementados:
- `GET /api/processes` - Lista processos com filtros
- `GET /api/companies` - Lista empresas
- `GET /api/deliveries` - Lista obrigações fiscais
- `GET /api/kpis` - KPIs pré-computados
- `POST /api/sync` - Dispara sincronização
- `GET /health` - Health check

#### Recursos:
- CORS habilitado
- Fallback automático para JSON
- Serve arquivos estáticos do frontend
- Documentação automática em `/docs`

### 3. Cliente API Aprimorado

#### Arquivo Atualizado:
- **`scripts/acessorias_client.py`**

#### Melhorias:
- Rate budget configurável via `.env` (`ACESSORIAS_RATE_BUDGET`)
- Novos métodos específicos:
  - `list_deliveries_listall()` - Delta diário com DtLastDH
  - `list_deliveries_by_cnpj()` - Histórico por empresa
- Backoff exponencial para erro 429
- Respeita header `Retry-After`
- Logs estruturados sem expor tokens

### 4. Scripts de Coleta Atualizados

#### Arquivos Modificados:
- **`scripts/fetch_api.py`**
- **`scripts/fetch_deliveries.py`**
- **`scripts/fetch_companies.py`**

#### Melhorias:
- Persistência no banco SQLite
- Geração de snapshots JSON para fallback
- Busca de processos concluídos
- Deliveries: histórico (6 meses) + delta diário
- Categorização automática (REINF, EFD, DIFAL)
- Subtipo DIFAL (comercialização, consumo/imobilizado)

### 5. Processamento com Banco de Dados

#### Arquivos Modificados:
- **`scripts/fuse_sources.py`**
- **`scripts/build_processes_kpis_alerts.py`**

#### Melhorias:
- Leitura prioritária do banco de dados
- Fallback para JSON se banco indisponível
- Cálculo de dia médio/mediano de fechamento
- KPIs enriquecidos

### 6. Frontend com Fallback Automático

#### Arquivo Modificado:
- **`web/app.js`**

#### Melhorias:
- Função `apiOrJson()` para fallback automático
- Tenta API REST primeiro
- Se falhar, usa arquivos JSON locais
- Atualização transparente para o usuário

### 7. Orquestração Atualizada

#### Arquivo Modificado:
- **`run_all.ps1`**

#### Melhorias:
- Opção `-Serve` inicia servidor FastAPI (porta 8088)
- Mantém compatibilidade com fluxo existente
- Abre navegador automaticamente

---

## 📝 Arquivos de Configuração

### Atualizado: `.env`
```env
# Novo: Banco de dados
DB_URL=sqlite:///data/econtrole.db

# Novo: Rate limiting
ACESSORIAS_RATE_BUDGET=70
```

### Atualizado: `requirements.txt`
```
SQLAlchemy>=2.0,<3
alembic>=1.12,<2
fastapi>=0.104,<1
uvicorn[standard]>=0.24,<1
```

---

## 📚 Documentação

### Arquivo Criado:
- **`README.md`** - Documentação completa do sistema

#### Conteúdo:
- Guia de instalação
- Instruções de uso
- Documentação da API
- Troubleshooting
- Estrutura do banco de dados
- Fluxo de dados

---

## 🔧 Melhorias Técnicas

### Rate Limiting
- Configurável: 70 req/min (padrão) = ~0,86s entre chamadas
- Tratamento robusto de erro 429
- Retry com backoff exponencial

### Resiliência
Sistema funciona em três camadas:
1. **API REST** (servidor FastAPI)
2. **Banco SQLite** (se API offline)
3. **Arquivos JSON** (se banco indisponível)

### Segurança
- Token nunca exposto em logs
- Variáveis sensíveis apenas no `.env`
- CORS configurável

### Performance
- Índices otimizados no banco
- WAL mode no SQLite
- Paginação em todos os endpoints
- Cache no frontend

---

## 📊 KPIs Adicionados

### Novos Indicadores:
- **Dia médio de fechamento**: Média do dia do mês em que processos são concluídos
- **Dia mediano de fechamento**: Mediana do dia de conclusão
- **Contadores por categoria**: REINF, EFD Contrib, DIFAL
- **Contadores por status**: Obrigatória, Dispensada, Pendente

---

## 🐛 Correções

### Deliveries
- ✅ Corrigido: histórico agora usa endpoint por CNPJ (não ListAll)
- ✅ Corrigido: delta diário usa ListAll com DtLastDH obrigatório
- ✅ Corrigido: categorização automática funciona corretamente

### Dashboard
- ✅ Corrigido: cards REINF/EFD/DIFAL agora populam com dados reais
- ✅ Corrigido: processos concluídos aparecem na listagem

### API
- ✅ Corrigido: rate limit respeitado com orçamento configurável
- ✅ Corrigido: tratamento de 204 No Content

---

## 🔄 Fluxo de Dados Atualizado

```
1. API Acessórias
   ↓
2. Scripts fetch_* (coleta)
   ↓
3. Banco SQLite (persistência)
   ↓
4. Snapshots JSON (fallback)
   ↓
5. Scripts fuse/build (processamento)
   ↓
6. Servidor FastAPI (exposição)
   ↓
7. Frontend (visualização)
```

---

## 📦 Estrutura de Arquivos

### Novos Arquivos:
```
scripts/
├── db.py                    # NOVO: Modelos SQLAlchemy
└── server.py                # NOVO: Servidor FastAPI

data/
└── econtrole.db            # NOVO: Banco SQLite

README.md                    # NOVO: Documentação completa
CHANGELOG.md                 # NOVO: Este arquivo
```

### Arquivos Modificados:
```
.env                         # Adicionado DB_URL e ACESSORIAS_RATE_BUDGET
requirements.txt             # Adicionado SQLAlchemy, FastAPI, Uvicorn
run_all.ps1                  # Adicionado suporte a servidor FastAPI
web/app.js                   # Adicionado apiOrJson() para fallback

scripts/
├── acessorias_client.py     # Rate budget + novos métodos deliveries
├── fetch_api.py             # Persistência no banco
├── fetch_deliveries.py      # Histórico por CNPJ + delta ListAll
├── fetch_companies.py       # Persistência no banco
├── fuse_sources.py          # Leitura do banco
└── build_processes_kpis_alerts.py  # KPIs de dia de fechamento
```

---

## ✅ Definition of Done

Todos os requisitos foram implementados:

- [x] Integração correta com API Acessórias
- [x] Processos concluídos sendo buscados
- [x] Persistência em banco SQLite local
- [x] Atualização contínua com upsert
- [x] Snapshots JSON para fallback
- [x] Deliveries: histórico por CNPJ
- [x] Deliveries: delta via ListAll + DtLastDH
- [x] Rate limit 429 com orçamento configurável
- [x] run_all.ps1 funcionando
- [x] Servidor FastAPI com GET /api/*
- [x] Frontend consome API com fallback
- [x] Dashboard populado com dados reais
- [x] Dia médio/mediano de fechamento calculado
- [x] Logs limpos sem expor tokens

---

## 🚀 Como Usar

### Instalação:
```powershell
pip install -r requirements.txt
```

### Coleta de Dados:
```powershell
.\run_all.ps1
```

### Iniciar Servidor:
```powershell
.\run_all.ps1 -Serve
```

### Acessar:
- Frontend: http://localhost:8088/web/
- API: http://localhost:8088/api/
- Docs: http://localhost:8088/docs

---

## 📞 Suporte

Consulte o `README.md` para documentação completa e troubleshooting.
