# Guia de Instalação e Configuração

Este documento descreve como preparar o ambiente local, configurar o WhatsApp Cloud API e carregar os dados de exemplo utilizados pelo bot fiscal.

## 1. Pré-requisitos

- **Node.js 18 ou superior** (inclui `npm`).
- **SQLite** já vem embutido no projeto via Prisma.
- Acesso ao [Meta for Developers](https://developers.facebook.com/) com permissão para utilizar a WhatsApp Cloud API (ambiente de teste gratuito).

## 2. Configuração do projeto

```bash
# Instalar dependências
cd backend
npm install

# Copiar variáveis de ambiente
cp .env.example .env
```

Edite o arquivo `.env` e informe:

| Variável | Descrição |
|----------|-----------|
| `WHATSAPP_TOKEN` | Token temporário gerado no painel da Meta (válido por 24h). |
| `PHONE_NUMBER_ID` | ID do número de teste disponível no painel. |
| `WABA_ID` | Business Account ID (opcional, usado apenas para referência). |
| `VERIFY_TOKEN` | Frase secreta definida por você para validar o webhook. |
| `APP_BASE_URL` | URL local do backend. Para execução local use `http://localhost:3000`. |

## 3. Banco de dados e dados fictícios

```bash
# Gerar cliente Prisma e aplicar migrações
npx prisma generate
npx prisma migrate dev --name whatsapp-bot

# Popular o banco com dados de teste
npx ts-node prisma/seed.ts
```

A seed cria:

- Usuários preparador, entregador e gestor com números de telefone fictícios.
- Empresas exemplo (Simples Nacional e Lucro Presumido).
- Competências, etapas, obrigações e problemas para validação rápida.
- Conversa registrada para testes de dashboard.

## 4. Configuração do WhatsApp Cloud API

1. Acesse **Meta for Developers → WhatsApp → Getting Started**.
2. Copie o token temporário e preencha `WHATSAPP_TOKEN` no `.env`.
3. Cadastre o webhook em **Configuration**:
   - **Callback URL:** `APP_BASE_URL/webhook`
   - **Verify token:** valor configurado em `VERIFY_TOKEN`.
4. Adicione os testers em **Phone numbers → Manage phone numbers → Add phone number** e convide os números que utilizarão o bot.
5. Utilize o número de teste fornecido pelo painel para enviar a primeira mensagem (ex.: "oi") após iniciar o servidor.

> ⚠️ O token expira a cada 24 horas. Gere um novo token sempre que necessário e atualize o `.env` sem reiniciar o processo.

## 5. Execução do servidor

```bash
npm run dev
```

O backend estará disponível em `http://localhost:3000`. As principais rotas são:

- `GET /api/health` – Verifica se o servidor está ativo.
- `POST /webhook` – Endpoint configurado na Meta para receber mensagens.
- `GET /dashboard` – Página resumida para acompanhar obrigações e conversas.

## 6. Fluxos suportados

O bot conduz automaticamente os fluxos a partir do texto recebido no WhatsApp:

- **Simples Nacional (comércio com movimento).**
- **Lucro Presumido (comércio com movimento).**

Comandos úteis durante a conversa:

```
novo, nova empresa, encerrar, pendencias, status, resumo,
problema, observacao, desabafo, pular, retomar
```

As respostas do usuário alimentam a máquina de estados e geram obrigações fiscais automaticamente. Lembretes em D-7/D-3/D-1 são enviados ao preparador cadastrado, e notificações de entrega são disparadas para o entregador.

## 7. Estrutura de diretórios relevantes

```
backend/
  ├─ src/services/whatsapp.service.ts     # Integração com Cloud API
  ├─ src/flows/engine.ts                 # Orquestra a state machine
  ├─ src/jobs/reminder.job.ts            # Cron para lembretes
  ├─ prisma/schema.prisma                # Modelos do banco SQLite
  └─ prisma/seed.ts                      # Dados fictícios para testes
frontend/
  ├─ index.html                          # Landing page com instruções rápidas
  └─ dashboard.html                      # Painel simplificado de obrigações
```

## 8. Encerrando e reiniciando

Para encerrar, pressione `Ctrl + C` no terminal. Ao reiniciar, lembre-se de atualizar o token do WhatsApp se ele tiver expirado.

---

**Pronto!** A partir daqui basta iniciar uma conversa com o número de teste e validar os fluxos diretamente no WhatsApp, acompanhando os resultados pelo dashboard local.
