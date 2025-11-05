# 🔧 Guia de Configuração e Instalação

Este documento descreve como configurar o ambiente para executar o Gestor Neto Contabilidade.

## ✅ Pré-requisitos

1. **Python 3.8+** instalado no seu sistema.
2. **pip** (gerenciador de pacotes Python) instalado.
3. **Git** (opcional, para clonar o repositório).

## 📦 Instalação de Dependências

### Passo 1: Criar um Ambiente Virtual (Recomendado)

Um ambiente virtual isola as dependências do projeto do seu sistema.

#### Windows (PowerShell):
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

#### Windows (Command Prompt):
```cmd
python -m venv venv
venv\Scripts\activate.bat
```

#### Linux/macOS:
```bash
python3 -m venv venv
source venv/bin/activate
```

### Passo 2: Instalar Dependências

Com o ambiente virtual ativado, execute:

```bash
pip install -r requirements.txt
```

Isso instalará todas as dependências necessárias, incluindo:
- **FastAPI**: Framework web para a API.
- **SQLAlchemy**: ORM para banco de dados.
- **Requests**: Cliente HTTP para consumir a API Acessórias.
- **python-dotenv**: Carregador de variáveis de ambiente.
- E outras dependências.

### Passo 3: Verificar Instalação

Para verificar se as dependências foram instaladas corretamente, execute:

```bash
pip list
```

Você deve ver `fastapi`, `sqlalchemy`, `requests`, etc. na lista.

## 🔐 Configuração de Variáveis de Ambiente

### Passo 1: Criar o Arquivo `.env`

Na raiz do projeto, crie um arquivo chamado `.env` com o seguinte conteúdo:

```env
# API Acessórias
ACESSORIAS_TOKEN=seu_token_aqui
ACESSORIAS_BASE_URL=https://api.acessorias.com

# Email (IMAP)
EMAIL_HOST=seu_email_host
EMAIL_PORT=993
EMAIL_USER=seu_email@example.com
EMAIL_PASSWORD=sua_senha_aqui

# Banco de Dados
DATABASE_URL=sqlite:///data/gestor.db

# Servidor
SERVER_HOST=127.0.0.1
SERVER_PORT=8088
```

### Passo 2: Obter o Token Acessórias

1. Acesse o [Sistema Acessórias](https://acessorias.com).
2. Clique na engrenagem (⚙️) no canto superior direito.
3. Selecione **"API Token"**.
4. Copie o token e cole no `.env` como `ACESSORIAS_TOKEN`.

## 🚀 Executar o Projeto

Com o ambiente virtual ativado e as dependências instaladas, execute:

### Opção 1: Script Python (Recomendado)

```bash
python run_all.py
```

### Opção 2: Script PowerShell (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\run_all.ps1
```

### Opção 3: Comandos Manuais

Se preferir executar manualmente:

```bash
# 1. Coletar dados
python -m scripts.fetch_api
python -m scripts.fetch_deliveries
python -m scripts.fetch_companies
python -m scripts.flatten_steps
python -m scripts.fetch_email_imap
python -m scripts.fuse_sources
python -m scripts.build_processes_kpis_alerts

# 2. Iniciar servidor
python -m uvicorn scripts.server:app --host 127.0.0.1 --port 8088
```

## 🌐 Acessar o Site

Após a execução, acesse:

- **Web**: http://localhost:8088/web/
- **API**: http://localhost:8088/api/

## ❌ Solução de Problemas

### Erro: `No module named 'sqlalchemy'`

**Causa**: As dependências não foram instaladas.

**Solução**:
```bash
pip install -r requirements.txt
```

### Erro: `IndentationError` em `scripts/fetch_deliveries.py`

**Causa**: Arquivo corrompido ou com indentação incorreta.

**Solução**: Verifique se você está usando a versão V5 ou superior do ZIP.

### Erro: `ERR_CONNECTION_REFUSED` ao acessar `http://localhost:8088/web/`

**Causa**: O servidor FastAPI não está rodando ou não iniciou corretamente.

**Solução**:
1. Verifique se o terminal mostra `Uvicorn running on http://127.0.0.1:8088`.
2. Se não, execute manualmente: `python -m uvicorn scripts.server:app --host 127.0.0.1 --port 8088`.

### Erro: `ACESSORIAS_TOKEN` não configurado

**Causa**: O arquivo `.env` não foi criado ou o token não foi preenchido.

**Solução**: Crie o arquivo `.env` conforme descrito acima.

## 📚 Documentação Adicional

- `README_FINAL.md`: Guia de execução e checklist de verificação.
- `run_all.py`: Script de execução universal.
- `run_all.ps1`: Script de execução para PowerShell.

---

**Versão**: 1.0
**Data**: Novembro 2025
**Status**: ✅ Pronto para uso!
