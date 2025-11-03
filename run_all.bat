@echo off

echo ========================================

echo Sistema de Gestao Operacional

echo ========================================

echo.



cd /d %~dp0



if not exist .venv (

    echo Criando ambiente virtual...

    python -m venv .venv

)



echo Ativando ambiente virtual...

call .venv\Scriptsctivate.bat



echo.

echo [1/5] Buscando dados da API Acessorias...

python scriptsetch_api.py

if errorlevel 1 (

    echo ERRO ao buscar API

    pause

    exit /b 1

)



echo.

echo [2/5] Processando passos dos processos...

python scriptslatten_steps.py

if errorlevel 1 (

    echo ERRO ao processar passos

    pause

    exit /b 1

)



echo.

echo [3/5] Buscando e-mails do Gmail...

python scriptsetch_email.py

if errorlevel 1 (

    echo ERRO ao buscar emails

    pause

    exit /b 1

)



echo.

echo [4/5] Mesclando fontes de dados...

python scriptsuse_sources.py

if errorlevel 1 (

    echo ERRO ao mesclar dados

    pause

    exit /b 1

)



echo.

echo [5/5] Gerando KPIs e alertas...

python scriptsuild_processes_kpis_alerts.py

if errorlevel 1 (

    echo ERRO ao gerar KPIs

    pause

    exit /b 1

)



echo.

echo ========================================

echo Processamento concluido!

echo Abra: web\index.html

echo ========================================

pause

