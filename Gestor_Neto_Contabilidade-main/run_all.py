#!/usr/bin/env python3
"""
Script alternativo para executar o pipeline completo sem restrições de PowerShell.
Funciona em Windows, Linux e macOS.

Uso:
    python run_all.py
    python3 run_all.py
"""
import os
import sys
import subprocess
import time
import webbrowser
from pathlib import Path
from dotenv import load_dotenv

# Cores para output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def print_header(text):
    """Imprime cabeçalho colorido."""
    print(f"\n{Colors.CYAN}{Colors.BOLD}{'='*60}{Colors.ENDC}")
    print(f"{Colors.CYAN}{Colors.BOLD}  {text}{Colors.ENDC}")
    print(f"{Colors.CYAN}{Colors.BOLD}{'='*60}{Colors.ENDC}\n")

def print_step(num, total, text):
    """Imprime passo do pipeline."""
    print(f"{Colors.BLUE}[{num}/{total}] {text}{Colors.ENDC}")

def print_success(text):
    """Imprime mensagem de sucesso."""
    print(f"{Colors.GREEN}[OK] {text}{Colors.ENDC}")

def print_error(text):
    """Imprime mensagem de erro."""
    print(f"{Colors.RED}[ERRO] {text}{Colors.ENDC}")

def print_warning(text):
    """Imprime mensagem de aviso."""
    print(f"{Colors.YELLOW}[AVISO] {text}{Colors.ENDC}")

def main():
    """Executa o pipeline completo."""
    root = Path(__file__).resolve().parent
    os.chdir(root)
    
    # Carregar .env
    env_path = root / ".env"
    if not env_path.exists():
        print_error(f".env não encontrado em {root}")
        sys.exit(1)
    
    load_dotenv(dotenv_path=env_path, override=True)
    
    # Validar token
    token = os.getenv("ACESSORIAS_TOKEN", "").strip()
    if not token:
        print_error("ACESSORIAS_TOKEN não configurado no .env")
        sys.exit(1)
    
    print_header("GESTOR NETO CONTABILIDADE - PIPELINE")
    print(f"Raiz do projeto: {root}\n")
    
    # Pipeline de 6 etapas
    steps = [
        ("scripts.fetch_api", "Coletando processos da API"),
        ("scripts.fetch_deliveries", "Coletando deliveries"),
        ("scripts.fetch_companies", "Coletando empresas"),
        ("scripts.flatten_steps", "Processando passos dos processos"),
        ("scripts.fetch_email_imap", "Coletando emails"),
        ("scripts.fuse_sources", "Fusionando dados"),
        ("scripts.build_processes_kpis_alerts", "Consolidando dados e gerando KPIs"),
    ]
    
    failed_steps = []
    
    for i, (module, description) in enumerate(steps, 1):
        print_step(i, len(steps), description)
        
        try:
            # Executar módulo Python
            result = subprocess.run(
                [sys.executable, "-m", module],
                cwd=root,
                capture_output=False,
                timeout=300  # 5 minutos por etapa
            )
            
            if result.returncode != 0:
                print_warning(f"{module} retornou código {result.returncode}")
                failed_steps.append(module)
            else:
                print_success(f"{description} concluída")
        
        except subprocess.TimeoutExpired:
            print_error(f"{module} expirou (timeout)")
            failed_steps.append(module)
        except Exception as e:
            print_error(f"Erro ao executar {module}: {e}")
            failed_steps.append(module)
    
    # Verificar arquivos gerados
    print_header("VERIFICAÇÃO DE ARQUIVOS GERADOS")
    
    data_dir = root / "data"
    expected_files = [
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
    ]
    
    all_files_ok = True
    for filename in expected_files:
        filepath = data_dir / filename
        if filepath.exists():
            size = filepath.stat().st_size
            if size > 0:
                print_success(f"{filename} ({size} bytes)")
            else:
                print_warning(f"{filename} (VAZIO)")
                all_files_ok = False
        else:
            print_error(f"{filename} (NÃO ENCONTRADO)")
            all_files_ok = False
    
    if not all_files_ok:
        print_warning("\nAlguns arquivos estão faltando ou vazios.")
        print_warning("Confira .env e scripts/config.json")
    
    # Relatório de erros
    if failed_steps:
        print_header("RELATÓRIO DE ERROS")
        for step in failed_steps:
            print_error(f"Falha em {step}")
        print_warning("\nO pipeline continuou mesmo com erros.")
        print_warning("Verifique os logs acima para detalhes.")
    
    # Iniciar servidor
    print_header("INICIANDO SERVIDOR FASTAPI")
    print(f"Web: http://localhost:8088/web/")
    print(f"API: http://localhost:8088/api/")
    print(f"\nAguarde alguns segundos para o servidor iniciar...\n")
    
    try:
        # Iniciar servidor em background
        server_process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "scripts.server:app", 
             "--host", "127.0.0.1", "--port", "8088"],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        # Aguardar servidor iniciar
        time.sleep(3)
        
        # Abrir navegador
        print_success("Abrindo navegador...")
        webbrowser.open("http://localhost:8088/web/")
        
        print_success("Servidor iniciado e navegador aberto!")
        print(f"\n{Colors.YELLOW}Para parar o servidor, pressione Ctrl+C{Colors.ENDC}\n")
        
        # Manter servidor rodando
        try:
            server_process.wait()
        except KeyboardInterrupt:
            print_warning("\nEncerrando servidor...")
            server_process.terminate()
            server_process.wait(timeout=5)
            print_success("Servidor encerrado")
    
    except Exception as e:
        print_error(f"Erro ao iniciar servidor: {e}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print_warning("\nOperação cancelada pelo usuário")
        sys.exit(0)
    except Exception as e:
        print_error(f"Erro fatal: {e}")
        sys.exit(1)
