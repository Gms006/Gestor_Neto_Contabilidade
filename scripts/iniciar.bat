@echo off
chcp 65001 >nul
echo ========================================
echo  Sistema de Gestão Contábil
echo  Iniciando Servidor...
echo ========================================
echo.

REM Navegar para a pasta do backend
cd /d "%~dp0..\backend"

echo 🚀 Iniciando servidor...
echo.
echo O sistema estará disponível em:
echo   http://localhost:3000
echo.
echo Para parar o servidor, pressione Ctrl+C
echo.
echo ========================================
echo.

REM Iniciar o servidor
call npm start

pause
