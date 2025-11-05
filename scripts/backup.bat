@echo off
chcp 65001 >nul
echo ========================================
echo  Sistema de Gestão Contábil
echo  Backup do Banco de Dados
echo ========================================
echo.

REM Definir caminhos
set DATA_DIR=%~dp0..\data
set BACKUP_DIR=%~dp0..\data\backups
set DB_FILE=%DATA_DIR%\gestao-contabil.db

REM Criar pasta de backup se não existir
if not exist "%BACKUP_DIR%" (
    mkdir "%BACKUP_DIR%"
    echo ✅ Pasta de backup criada
)

REM Gerar nome do arquivo com data e hora
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set BACKUP_NAME=gestao-contabil-backup-%datetime:~0,8%-%datetime:~8,6%.db

echo 📦 Criando backup...
echo.
echo Origem: %DB_FILE%
echo Destino: %BACKUP_DIR%\%BACKUP_NAME%
echo.

REM Copiar banco de dados
copy "%DB_FILE%" "%BACKUP_DIR%\%BACKUP_NAME%" >nul

if errorlevel 1 (
    echo ❌ Erro ao criar backup!
    pause
    exit /b 1
)

echo ✅ Backup criado com sucesso!
echo.
echo Arquivo: %BACKUP_NAME%
echo.

REM Listar backups existentes
echo 📋 Backups disponíveis:
echo.
dir /b "%BACKUP_DIR%\*.db"
echo.

REM Contar backups
for /f %%A in ('dir /b "%BACKUP_DIR%\*.db" ^| find /c /v ""') do set COUNT=%%A
echo Total de backups: %COUNT%
echo.

REM Alerta se tiver muitos backups
if %COUNT% GTR 10 (
    echo ⚠️  Você tem mais de 10 backups!
    echo Considere deletar os mais antigos para economizar espaço.
    echo.
)

pause
