#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Gestor Neto Contabilidade (Unix) ==="

if [ -f ".venv/bin/activate" ]; then
  source .venv/bin/activate
fi

python3 scripts/fetch_api.py
python3 scripts/fetch_deliveries.py
python3 scripts/flatten_steps.py
python3 scripts/fetch_email_imap.py
python3 scripts/fuse_sources.py
python3 scripts/build_processes_kpis_alerts.py

echo "OK! Abra web/index.html"
