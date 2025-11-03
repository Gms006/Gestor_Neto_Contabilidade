#!/bin/bash

echo "========================================"
echo "Sistema de Gestao Operacional"
echo "========================================"
echo

cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    echo "Criando ambiente virtual..."
    python3 -m venv .venv
fi

echo "Ativando ambiente virtual..."
source .venv/bin/activate

echo
echo "[1/5] Buscando dados da API Acessorias..."
python scripts/fetch_api.py || exit 1

echo
echo "[2/5] Processando passos dos processos..."
python scripts/flatten_steps.py || exit 1

echo
echo "[3/5] Buscando e-mails do Gmail..."
python scripts/fetch_email.py || exit 1

echo
echo "[4/5] Mesclando fontes de dados..."
python scripts/fuse_sources.py || exit 1

echo
echo "[5/5] Gerando KPIs e alertas..."
python scripts/build_processes_kpis_alerts.py || exit 1

echo
echo "========================================"
echo "Processamento concluido!"
echo "Abra: web/index.html"
echo "========================================"
