@echo off
setlocal enableextensions

REM === CONFIGURE AQUI ===
set "REPO_DIR=C:\Gestor_Neto_Contabilidade-main"
set "BRANCH=main"
set "REMOTE_URL=https://github.com/Gms006/Gestor_Neto_Contabilidade.git"
for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set DATESTAMP=%date:~6,4%%date:~3,2%%date:~0,2%
set "BACKUP_TAG=backup_before_force_%DATESTAMP%"

git config --global user.name  "Gms006"
git config --global user.email "joaovguimas@gmail.com"

cd /d "%REPO_DIR%" || (echo Pasta nao encontrada & exit /b 1)

if not exist ".git" git init

for /f "delims=" %%r in ('git remote') do set HASREMOTE=%%r
if not defined HASREMOTE (
  git remote add origin "%REMOTE_URL%"
) else (
  git remote set-url origin "%REMOTE_URL%"
)

REM pega estado remoto e cria tag de backup (se remoto existir)
git fetch origin
REM cria tag local e tenta enviar (nao falha se nao existir remoto ainda)
git tag -f "%BACKUP_TAG%" "origin/%BRANCH%" 2>nul
git push origin "%BACKUP_TAG%" 2>nul

git checkout -B "%BRANCH%"

git add -A
git commit -m "chore: replace remote with local snapshot" || echo Nada para commitar

REM === o pulo do gato: sobrescreve o remoto ===
git push -u origin "%BRANCH%" -f

echo.
echo ✅ Concluido: FORCE PUSH feito para %BRANCH%.
echo 💾 Tag de backup (se existia remoto): %BACKUP_TAG%
pause
