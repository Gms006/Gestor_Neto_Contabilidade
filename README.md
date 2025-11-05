# Sistema de Gestão de Procedimentos Contábeis

Sistema completo para mapear, padronizar e monitorar procedimentos contábeis de **Simples Nacional**, **Lucro Presumido** e **Lucro Real**, capturando passo a passo, tempo gasto, problemas enfrentados e pontos de melhoria.

## 📋 Características Principais

- ✅ **Integração com API Acessórias** para coleta de dados (Empresas, Processos, Entregas)
- ✅ **Gestão de Empresas** por regime tributário (SN, LP, LR)
- ✅ **Controle de Processos** mensais com status e progresso
- ✅ **Rastreamento de Etapas** com timer automático
- ✅ **"Hora Desabafo"** - registro de problemas e dificuldades
- ✅ **Geração de Obrigações** com ajuste automático por feriados
- ✅ **Alertas de Vencimento** (D-7, D-3, D-1)
- ✅ **Relatórios Gerenciais** completos
- ✅ **Dashboard Analítico** com gráficos
- ✅ **100% Offline** - funciona sem internet

## 🚀 Tecnologias Utilizadas

### Backend
- **Node.js 18+** com TypeScript
- **Express.js** - servidor web
- **Prisma ORM** - gerenciamento de banco de dados
- **SQLite** - banco de dados local
- **node-cron** - agendamento de tarefas

### Frontend
- **HTML5/CSS3/JavaScript** puro
- **Bootstrap 5** - interface responsiva
- **Chart.js** - gráficos e visualizações
- **Bootstrap Icons** - ícones

## 📦 Instalação e Setup

### Pré-requisitos
- **Node.js 18+** instalado
- **Token da API Acessórias**

### Passo a Passo

1. **Extrair o arquivo ZIP** em um diretório de sua preferência.

2. **Configurar o ambiente:**
   - Crie um arquivo `.env` na pasta `backend/` com as seguintes variáveis:
     ```env
     # Configuração do Banco de Dados
     DATABASE_URL="file:./gestor.db"
     
     # Configuração do Servidor
     PORT=3000
     
     # Token da API Acessórias
     ACESSORIAS_TOKEN="SEU_TOKEN_AQUI"
     ACESSORIAS_API_BASE="https://api.acessorias.com"
     ```
   - **IMPORTANTE:** Substitua `"SEU_TOKEN_AQUI"` pelo seu token real.

3. **Navegar até a pasta do backend:**
   ```bash
   cd /caminho/para/o/projeto/backend
   ```

4. **Instalar dependências:**
   ```bash
   npm install
   ```

5. **Criar o banco de dados e aplicar as migrações:**
   ```bash
   npx prisma migrate dev --name initial_setup
   ```
   *Se for a primeira vez, use `npx prisma migrate dev --name initial_setup`.*

6. **Iniciar o servidor (Backend):**
   ```bash
   npm run dev
   # ou, se preferir uma alternativa compatível com Windows:
   npm run dev:tsx
   ```
   *O servidor iniciará em `http://localhost:3000`.*

7. **Abrir o Frontend:**
   - Abra o arquivo `frontend/dashboard.html` no seu navegador.

## 🎯 Teste de Sincronização (Sync)

Para validar as correções de sincronização:

1. **Acesse o Dashboard:** Abra `frontend/dashboard.html`.
2. **Clique no Botão "Atualizar":** O botão **Atualizar** na barra de navegação (topo direito) irá disparar a chamada `POST /api/sync` (sincronização incremental).
3. **Verifique o Feedback:** Uma mensagem de sucesso ou erro aparecerá no topo da tela.
4. **Confirme os Dados:** As tabelas de Processos e Entregas devem ser preenchidas com os dados coletados da API Acessórias.

### Aceite (O que foi corrigido e validado)

- **✅ POST /api/sync** executa sem erro, com paginação e retries, e persiste Empresas, Processos, Entregas e Etapas.
- **✅ GET /api/empresas|processos|entregas|etapas|dashboard** retornam JSON válido do banco (rotas em PT).
- **✅ Frontend** exibe listas/dash atualizados após clicar "Atualizar".
- **✅ Incremental** usa `DtLastDH` com janela de segurança de 90s.
- **✅ Nomenclatura** coerente (modelos em PT no Prisma e no código).

## 🧪 Testes rápidos

Para validar rapidamente as credenciais e o formato dos endpoints da Acessórias, execute os comandos abaixo (ajuste datas conforme necessário):

```bash
# Companies
curl -H "Authorization: Bearer $ACESSORIAS_TOKEN" \
  "$ACESSORIAS_API_BASE/companies/Geral/?Pagina=1"

# Processes - em andamento
curl -H "Authorization: Bearer $ACESSORIAS_TOKEN" \
  "$ACESSORIAS_API_BASE/processes/ListAll/?Pagina=1&ProcStatus=A&DtLastDH=2025-11-05 00:00:00"

# Processes - concluídos
curl -H "Authorization: Bearer $ACESSORIAS_TOKEN" \
  "$ACESSORIAS_API_BASE/processes/ListAll/?Pagina=1&ProcStatus=C&DtLastDH=2025-11-05 00:00:00"

# Deliveries – mês atual (exemplo)
curl -H "Authorization: Bearer $ACESSORIAS_TOKEN" \
  "$ACESSORIAS_API_BASE/deliveries/ListAll/?DtInitial=2025-11-01&DtFinal=2025-11-30&DtLastDH=2025-11-05 00:00:00&Pagina=1"
```

## 📁 Estrutura do Projeto

```
gestao-contabil/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma    # Modelo do banco (Corrigido)
│   │   └── migrations/      # Histórico de migrações (Atualizado)
│   ├── src/
│   │   ├── clients/         # Cliente da API (Corrigido)
│   │   ├── repositories/    # Repositório de dados (Corrigido)
│   │   ├── services/        # Lógica de negócio (Corrigido)
│   │   └── routes/          # Rotas da API (Corrigido)
│   └── package.json
├── frontend/
│   ├── dashboard.html       # Dashboard (Corrigido)
│   └── js/
│       ├── api.js           # Funções de API (Corrigido)
│       ├── main.js          # Lógica do dashboard (Corrigido)
│       └── dashboard.js     # Lógica do dashboard (Corrigido)
├── CHANGELOG.md             # Histórico de alterações (Novo)
└── README.md                # Este arquivo (Atualizado)
```

---

**Versão:** 1.0.1 (Corrigida)
**Data:** Novembro 2025
