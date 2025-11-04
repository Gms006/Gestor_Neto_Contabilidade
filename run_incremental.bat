@echo off
setlocal
python -m scripts.fetch_api        || goto :err
python -m scripts.fetch_deliveries || goto :err
python -m scripts.flatten_steps    || goto :err
python -m scripts.fetch_email_imap || rem tolerante
python -m scripts.fuse_sources     || goto :err
python -m scripts.build_processes_kpis_alerts || goto :err
echo OK
exit /b 0
:err
echo ERRO na etapa acima. Verifique data\logs.txt e a saída do console.
exit /b 1
