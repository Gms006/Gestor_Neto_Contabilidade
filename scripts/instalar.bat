@echo off
chcp 65001 >nul
echo ========================================
echo  Sistema de Gestão Contábil
echo  Instalação Automática
echo ========================================
echo.

REM Verificar se Node.js está instalado
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js não encontrado!
    echo.
    echo Por favor, instale o Node.js 18+ em:
    echo https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo ✅ Node.js encontrado!
node --version
echo.

REM Navegar para a pasta do backend
cd /d "%~dp0..\backend"

echo 📦 Instalando dependências...
echo.
call npm install

if errorlevel 1 (
    echo.
    echo ❌ Erro ao instalar dependências!
    pause
    exit /b 1
)

echo.
echo ✅ Dependências instaladas com sucesso!
echo.

echo 🔧 Gerando Prisma Client...
echo.
call npm run prisma:generate

if errorlevel 1 (
    echo.
    echo ❌ Erro ao gerar Prisma Client!
    pause
    exit /b 1
)

echo.
echo ✅ Prisma Client gerado com sucesso!
echo.

echo 🗄️  Criando banco de dados...
echo.
call npm run prisma:migrate

if errorlevel 1 (
    echo.
    echo ⚠️  Aviso: Erro ao criar banco de dados
    echo Tentando continuar...
)

echo.
echo 🌱 Populando banco com dados de exemplo...
echo.
call npm run prisma:seed

if errorlevel 1 (
    echo.
    echo ⚠️  Aviso: Erro ao popular banco de dados
    echo Você pode tentar novamente mais tarde com: npm run prisma:seed
)

echo.
echo ========================================
echo  ✅ Instalação Concluída com Sucesso!
echo ========================================
echo.
echo Para iniciar o sistema, execute:
echo   iniciar.bat
echo.
echo Ou acesse a pasta backend e execute:
echo   npm start
echo.
echo Depois, abra o navegador em:
echo   http://localhost:3000
echo.
pause
