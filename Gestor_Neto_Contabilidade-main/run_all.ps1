param([switch]$Serve)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Ir para a raiz do projeto (onde está este script)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

# Escolher Python do sistema (sem venv)
$PY = "python"
if (-not (Get-Command $PY -ErrorAction SilentlyContinue)) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    $PY = "py -3.10"
  } else {
    throw "Python 3.10+ não encontrado no PATH."
  }
}

# Helper simples para rodar módulos
function Run-Module {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [string[]]$Args = @(),
    [switch]$Tolerate  # não derruba o fluxo se falhar
  )
  Write-Host "`n>> $Name" -ForegroundColor Green
  & $PY -m $Name @Args
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

# Pipeline (sem venv). Deixa deliveries e email como tolerados p/ não travar testes.
Run-Module -Name "scripts.fetch_api" -Args @("--full")
Run-Module -Name "scripts.fetch_deliveries" -Tolerate
Run-Module -Name "scripts.fetch_companies"
Run-Module -Name "scripts.flatten_steps"
Run-Module -Name "scripts.fetch_email_imap" -Tolerate
Run-Module -Name "scripts.fuse_sources"
Run-Module -Name "scripts.build_processes_kpis_alerts"

# Checagem rápida
if (Test-Path "data\events.json") {
  $sz = (Get-Item "data\events.json").Length
  if ($sz -eq 0) { Write-Warning "events.json gerado porém vazio. Confira .env e scripts\config.json." }
} else {
  Write-Warning "data\events.json não foi gerado."
}

# Subir site local (opcional)
if ($Serve) {
  Write-Host "`nServidor: http://localhost:8000/web/" -ForegroundColor Magenta
  Start-Process powershell -ArgumentList "-NoExit","-Command","cd `"$Root`"; python -m http.server 8000"
  Start-Process "http://localhost:8000/web/"
}

Write-Host "`nOK" -ForegroundColor Cyan
