# CHANGELOG

## 2025-11-05 - Atualização de Padronização e Correção de API

Este *changelog* detalha as alterações realizadas no projeto para corrigir a integração com a API do Acessórias e padronizar o ambiente de desenvolvimento para o padrão **ESM (ECMAScript Modules)**.

### 1. Padronização do Projeto (ESM)

*   **`backend/package.json`**:
    *   Adicionado `"type": "module"` para forçar o uso do padrão ESM.
    *   Atualizado o script `dev` para usar `cross-env TS_NODE_PROJECT=tsconfig.json` para garantir o carregamento correto do `tsconfig.json` em modo *watch*.
    *   Instalado `cross-env` como dependência de desenvolvimento.
*   **`backend/tsconfig.json`**:
    *   Atualizado `target` para `"ES2022"`.
    *   Atualizado `module` para `"ES2022"`.
    *   Atualizado `moduleResolution` para `"Bundler"`.
    *   Adicionado `"allowSyntheticDefaultImports": true`.

### 2. Correção e Flexibilização da API do Acessórias

O erro original de **404 Not Found** foi corrigido com a implementação de uma lógica de construção de URL mais flexível e a confirmação da estrutura correta da API na documentação.

*   **`backend/.env`**:
    *   Adicionadas as variáveis de ambiente: `ACESSORIAS_API_BASE`, `ACESSORIAS_API_VERSION` e `ACESSORIAS_PATH_LANG` para permitir a configuração da URL da API sem alterar o código-fonte.
*   **`backend/src/lib/env.ts`**:
    *   Atualizado para carregar as novas variáveis de ambiente.
*   **`backend/src/clients/acessoriasClient.ts`**:
    *   Implementada a função `buildUrl` para montar a URL completa da API de forma dinâmica, considerando `BASE_URL`, `API_BASE`, `API_VERSION` e o nome do recurso (ex: `/companies`).
    *   Adicionado o cabeçalho `User-Agent: NetoContabilidade-Gestor/1.0` conforme boa prática.
    *   Ajustado o `fetchWithRetry` para usar a URL completa gerada pela `buildUrl`.
    *   Implementado o mapeamento de recursos (`companies`, `processes`, `deliveries`) para português (`empresas`, `processos`, `entregas`) via `ACESSORIAS_PATH_LANG`.

### 3. Atualização do Banco de Dados (Prisma)

Os modelos do Prisma foram atualizados para refletir a estrutura de dados solicitada, focando em `Company`, `Process` e `Delivery` com relações claras.

*   **`backend/prisma/schema.prisma`**:
    *   Os modelos `Empresa`, `Processo`, `Entrega` e `Etapa` foram substituídos por `Company`, `Process`, `Delivery` e `SyncCursor` (novo), seguindo a estrutura solicitada.
    *   As relações entre `Company` e `Process`, e `Process` e `Delivery` foram ajustadas.
*   **Migração**:
    *   O `prisma generate` e `prisma migrate deploy` foram executados para aplicar as mudanças no banco de dados.

### 4. Implementação de Endpoints e Lógica de Status

*   **`backend/src/lib/utils.ts`**:
    *   Criada a função `mapProcessStatus` para padronizar o status do processo em `CONCLUIDO`, `EM_ANDAMENTO` ou `OUTRO`, com base em `statusRaw` e `progress`.
*   **`backend/src/routes/data.ts`**:
    *   Removidas as rotas antigas (`/empresas`, `/processos`, etc.).
    *   Implementadas as novas rotas:
        *   `GET /api/processes/summary`: Retorna a contagem de processos por status (`concluidos`, `em_andamento`, `outros`).
        *   `GET /api/processes`: Implementa listagem paginada com filtros por `status` (`concluido`, `em_andamento`, `todos`), `empresa`, `titulo` e ordenação.
*   **`backend/src/repositories/acessoriasRepo.ts`**:
    *   Atualizado para usar os novos nomes de modelos (`Company`, `Process`, `Delivery`) e a lógica de *upsert* com base no `externalId`.
*   **`backend/src/services/syncService.ts`**:
    *   Atualizado para usar os novos nomes de funções de repositório e a lógica de *sync* com base nos novos modelos.

---
**Próximos Passos para o Usuário:**

1.  Descompacte o ZIP.
2.  Execute `npm install` na pasta `backend`.
3.  Ajuste as variáveis `ACESSORIAS_API_BASE`, `ACESSORIAS_API_VERSION` e `ACESSORIAS_PATH_LANG` no `backend/.env` conforme a documentação da API.
4.  Execute `npm run dev` para iniciar o servidor e a sincronização.
