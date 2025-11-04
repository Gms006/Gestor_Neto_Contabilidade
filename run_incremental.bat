@echo off
setlocal enabledelayedexpansion
cd /d %~dp0

echo === Gestor Neto Contabilidade (Incremental) ===

echo Executando pipeline incremental com base em .sync_state.json

if exist .venv\Scripts\activate call .venv\Scripts\activate

python scripts\fetch_api.py || goto :err
python scripts\fetch_deliveries.py || goto :err
python scripts\flatten_steps.py || goto :err
python scripts\fetch_email_imap.py || goto :err
python scripts\fuse_sources.py || goto :err
python scripts\build_processes_kpis_alerts.py || goto :err

echo OK! Dados atualizados. Abra web\index.html
exit /b 0

:err
echo ERRO na etapa acima. Verifique data\logs.txt (se houver) e a saída do console.
exit /b 1
