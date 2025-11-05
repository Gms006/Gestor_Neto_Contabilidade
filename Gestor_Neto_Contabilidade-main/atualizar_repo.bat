@echo off
setlocal enableextensions

REM === CONFIGURE AQUI SE PRECISAR ===
set "REPO_DIR=C:\Gestor_Neto_Contabilidade-main"
set "BRANCH=main"
REM Cole a URL do seu repositório (HTTPS ou SSH):
REM Ex.: https://github.com/Gms006/Gestor_Neto_Contabilidade.git
set "REMOTE_URL=https://github.com/Gms006/Gestor_Neto_Contabilidade.git"

REM === IDENTIDADE (global, faz uma vez no PC) ===
git config --global user.name  "Gms006"
git config --global user.email "joaovguimas@gmail.com"

cd /d "%REPO_DIR%" || (echo Pasta nao encontrada & exit /b 1)

REM === inicializa repo se ainda nao for ===
if not exist ".git" (
  echo Inicializando repositório...
  git init
)

REM === garante remoto 'origin' apontando pro seu GitHub ===
for /f "delims=" %%r in ('git remote') do set HASREMOTE=%%r
if not defined HASREMOTE (
  git remote add origin "%REMOTE_URL%"
) else (
  git remote set-url origin "%REMOTE_URL%"
)

REM === pega o estado do remoto (se existir) ===
git fetch origin 2>nul

REM === cria (ou muda para) a branch desejada ===
git checkout -B "%BRANCH%"

REM === adiciona e commita tudo ===
git add -A
git commit -m "chore: sync local -> remote (push normal)" || echo Nada para commitar

REM === envia (sem -f) ===
git push -u origin "%BRANCH%"

echo.
echo ✅ Concluido: push normal para %BRANCH%.
pause
