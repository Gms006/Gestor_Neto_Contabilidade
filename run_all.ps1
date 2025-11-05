param([switch]$Serve)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Ir para a raiz do projeto (onde está este script)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath "$Root"

# --- [AUTOLOAD .ENV] --------------------------------------------------------
function Load-DotEnv {
  param([Parameter(Mandatory=$true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Warning ".env não encontrado em $Path"
    return
  }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { return }

    $idx = $line.IndexOf('=')
    if ($idx -lt 0) { return }

    $name = $line.Substring(0, $idx).Trim()
    $val  = $line.Substring($idx + 1)

    # remove aspas externas simples ou duplas, se houver
    if ($val.Length -ge 2) {
      if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
        $val = $val.Substring(1, $val.Length - 2)
      }
    }

    [System.Environment]::SetEnvironmentVariable($name, $val, 'Process')
  }
}

# carrega .env da raiz
$envPath = Join-Path $Root ".env"
Load-DotEnv -Path $envPath

# validações mínimas
if (-not $env:ACESSORIAS_TOKEN -or $env:ACESSORIAS_TOKEN.Trim() -eq "") {
  throw "ACESSORIAS_TOKEN ausente no .env (ou vazio)."
}

# (opcional) feedback rápido sem expor o token
try {
  $len  = $env:ACESSORIAS_TOKEN.Length
  $mask = if ($len -ge 10) { $env:ACESSORIAS_TOKEN.Substring(0,6) + "..." + $env:ACESSORIAS_TOKEN.Substring($len-4) } else { "[curto]" }
  Write-Host "ACESSORIAS_TOKEN carregado: $mask" -ForegroundColor DarkGray
} catch {}

# ---------------------------------------------------------------------------

# Escolher Python (prefere .venv)
$PY = Join-Path $Root ".venv\Scripts\python.exe"
$PY_PARAMS = @()
if (-not (Test-Path -LiteralPath $PY)) {
  if (Get-Command python -ErrorAction SilentlyContinue) {
    $PY = "python"
  } elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $PY = "py"
    $PY_PARAMS = @("-3.10")
  } else {
    throw "Python 3.10+ não encontrado (.venv/python, python ou py)."
  }
}

# Helper para rodar módulos
function Run-Module {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [string[]]$Args = @(),
    [switch]$Tolerate  # não derruba o fluxo se falhar
  )
  Write-Host "`n>> $Name" -ForegroundColor Green
  & $PY @PY_PARAMS -m $Name @Args
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    if ($Tolerate) {
      Write-Warning "$Name falhou (tolerado). Veja logs em data\ps_run.log / data\logs.txt."
    } else {
      throw "Falha em $Name (exit $code)"
    }
  }
}

# Garantir pasta de dados
New-Item -ItemType Directory -Force -Path "data" | Out-Null

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  GESTOR NETO CONTABILIDADE - PIPELINE" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Pipeline (deixa deliveries e email tolerados pra não travar testes)
Write-Host "[1/6] Coletando processos da API..." -ForegroundColor Yellow
Run-Module -Name "scripts.fetch_api" -Args @("--full")

Write-Host "`n[2/6] Coletando deliveries..." -ForegroundColor Yellow
Run-Module -Name "scripts.fetch_deliveries" -Tolerate

Write-Host "`n[3/6] Coletando empresas..." -ForegroundColor Yellow
Run-Module -Name "scripts.fetch_companies"

Write-Host "`n[4/6] Processando passos dos processos..." -ForegroundColor Yellow
Run-Module -Name "scripts.flatten_steps"

Write-Host "`n[5/6] Coletando emails..." -ForegroundColor Yellow
Run-Module -Name "scripts.fetch_email_imap" -Tolerate

Write-Host "`n[6/6] Consolidando dados e gerando KPIs..." -ForegroundColor Yellow
Run-Module -Name "scripts.fuse_sources"
Run-Module -Name "scripts.build_processes_kpis_alerts"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  VERIFICACAO DE ARQUIVOS GERADOS" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Lista de arquivos JSON esperados
$expectedFiles = @(
  "processes.json",
  "kpis.json",
  "alerts.json",
  "meta.json",
  "fechamento_stats.json",
  "reinf_competencia.json",
  "efdcontrib_competencia.json",
  "difal_tipo.json",
  "deliveries.json",
  "events.json"
)

$allFilesOk = $true
foreach ($file in $expectedFiles) {
  $filePath = Join-Path "data" $file
  if (Test-Path $filePath) {
    $size = (Get-Item $filePath).Length
    if ($size -gt 0) {
      Write-Host "[OK] $file ($size bytes)" -ForegroundColor Green
    } else {
      Write-Host "[AVISO] $file (VAZIO)" -ForegroundColor Yellow
      $allFilesOk = $false
    }
  } else {
    Write-Host "[ERRO] $file (NAO ENCONTRADO)" -ForegroundColor Red
    $allFilesOk = $false
  }
}

if (-not $allFilesOk) {
  Write-Host "`n[AVISO] Alguns arquivos estao faltando ou vazios. Confira .env e scripts\config.json." -ForegroundColor Yellow
}

# Checagem adicional de events.json
if (Test-Path "data\events.json") {
  $sz = (Get-Item "data\events.json").Length
  if ($sz -eq 0) { 
    Write-Warning "`nevents.json gerado porem vazio. Confira .env e scripts\config.json." 
  }
} else {
  Write-Warning "`ndata\events.json nao foi gerado."
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  PIPELINE CONCLUIDO COM SUCESSO!" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Subir site local (sempre quando -Serve ou por padrão)
if ($Serve -or $true) {
  Write-Host "Iniciando servidor FastAPI..." -ForegroundColor Magenta
  Write-Host "  - Web: http://localhost:8088/web/" -ForegroundColor Cyan
  Write-Host "  - API: http://localhost:8088/api/" -ForegroundColor Cyan
  Write-Host "`nAguarde alguns segundos para o servidor iniciar...`n" -ForegroundColor Gray
  
  # Iniciar servidor em nova janela do PowerShell
  # Usar -WorkingDirectory para garantir que o caminho com espaços seja tratado corretamente
  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Write-Host 'Servidor FastAPI rodando...' -ForegroundColor Green; & `"$PY`" @PY_PARAMS -m uvicorn scripts.server:app --host 127.0.0.1 --port 8088"
  ) -WorkingDirectory "$Root"
  
  # Aguardar servidor iniciar
  Start-Sleep -Seconds 3
  
  # Abrir navegador
  Write-Host "Abrindo navegador..." -ForegroundColor Magenta
  Start-Process "http://localhost:8088/web/"
  
  Write-Host "`n[OK] Servidor iniciado e navegador aberto!" -ForegroundColor Green
  Write-Host "  Para parar o servidor, feche a janela do PowerShell que foi aberta.`n" -ForegroundColor Gray
}

Write-Host "Pressione qualquer tecla para sair..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
