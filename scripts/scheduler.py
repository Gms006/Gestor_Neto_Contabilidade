#!/usr/bin/env python3
"""
Scheduler para executar o pipeline de coleta de dados a cada 3 horas.
Usa APScheduler para agendamento.

Uso:
    python scripts/scheduler.py
    python -m scripts.scheduler
"""
import os
import sys
import subprocess
import logging
from pathlib import Path
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s | %(message)s"
)
logger = logging.getLogger("scheduler")

# Raiz do projeto
ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"

# Carregar .env
load_dotenv(dotenv_path=ENV_PATH, override=True)


def run_pipeline(full: bool = False):
    """
    Executa o pipeline completo de coleta de dados.
    
    Args:
        full: Se True, executa coleta full (ignora dt_last_dh).
    """
    logger.info("=" * 60)
    logger.info("INICIANDO PIPELINE DE COLETA")
    logger.info("=" * 60)
    
    modules = [
        ("scripts.fetch_api", "Coletando processos da API"),
        ("scripts.fetch_deliveries", "Coletando deliveries"),
        ("scripts.fetch_companies", "Coletando empresas"),
        ("scripts.flatten_steps", "Processando passos dos processos"),
        ("scripts.fetch_email_imap", "Coletando emails"),
        ("scripts.fuse_sources", "Fusionando dados"),
        ("scripts.build_processes_kpis_alerts", "Consolidando dados e gerando KPIs"),
    ]
    
    failed = []
    
    for i, (module, description) in enumerate(modules, 1):
        logger.info(f"[{i}/{len(modules)}] {description}")
        
        try:
            # Usar sys.executable para garantir a .venv
            cmd = [sys.executable, "-m", module]
            
            # Adicionar --full ao fetch_api se necessário
            if module == "scripts.fetch_api" and full:
                cmd.append("--full")
            
            result = subprocess.run(
                cmd,
                cwd=ROOT,
                capture_output=True,
                timeout=300,  # 5 minutos por módulo
                text=True
            )
            
            if result.returncode != 0:
                logger.warning(f"Módulo {module} retornou código {result.returncode}")
                if result.stderr:
                    logger.warning(f"Stderr: {result.stderr[:500]}")
                failed.append(module)
            else:
                logger.info(f"[OK] {description}")
        
        except subprocess.TimeoutExpired:
            logger.error(f"Timeout ao executar {module}")
            failed.append(module)
        except Exception as e:
            logger.error(f"Erro ao executar {module}: {e}")
            failed.append(module)
    
    logger.info("=" * 60)
    if failed:
        logger.warning(f"Pipeline concluído com {len(failed)} erro(s): {', '.join(failed)}")
    else:
        logger.info("Pipeline concluído com sucesso!")
    logger.info("=" * 60)


def main():
    """
    Inicia o scheduler.
    """
    logger.info("Iniciando scheduler de coleta de dados")
    logger.info(f"Raiz do projeto: {ROOT}")
    
    # Criar scheduler
    scheduler = BackgroundScheduler()
    
    # Executar pipeline na primeira vez (full=True)
    logger.info("Executando pipeline inicial (full=True)...")
    run_pipeline(full=True)
    
    # Agendar execução a cada 3 horas (incremental)
    scheduler.add_job(
        func=lambda: run_pipeline(full=False),
        trigger=IntervalTrigger(hours=3),
        id="pipeline_job",
        name="Pipeline de coleta a cada 3 horas",
        coalesce=True,
        max_instances=1,
        replace_existing=True
    )
    
    # Iniciar scheduler
    scheduler.start()
    logger.info("Scheduler iniciado. Pipeline será executado a cada 3 horas.")
    logger.info("Pressione Ctrl+C para parar.")
    
    try:
        # Manter o scheduler rodando
        while True:
            import time
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Encerrando scheduler...")
        scheduler.shutdown()
        logger.info("Scheduler encerrado.")


if __name__ == "__main__":
    main()
