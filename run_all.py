#!/usr/bin/env python3
"""Orchestrator for Gestor Neto Contabilidade."""
from __future__ import annotations

import argparse
import os
import threading
import time
import webbrowser
from datetime import datetime, timedelta
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv
import uvicorn

from scripts.pipeline import ensure_environment, run_pipeline
from scripts.utils.logger import get_logger, log

ROOT = Path(__file__).resolve().parent

LOG = get_logger("run_all")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Executa pipeline e sobe API/Frontend")
    parser.add_argument("--full", action="store_true", help="Executa coleta completa antes de iniciar o servidor")
    parser.add_argument("--reset-sync", action="store_true", help="Zera SyncState antes da coleta inicial")
    parser.add_argument("--serve-only", action="store_true", help="Não roda pipeline, apenas inicia o servidor")
    parser.add_argument("--no-browser", action="store_true", help="Não abre automaticamente o navegador")
    parser.add_argument("--host", default="0.0.0.0", help="Host do servidor uvicorn")
    parser.add_argument("--port", type=int, default=8088, help="Porta do servidor uvicorn")
    parser.add_argument("--page-size", type=int, default=100, help="Tamanho de página para coleta inicial")
    parser.add_argument("--months-history", type=int, default=6, help="Histórico em meses para deliveries full")
    return parser.parse_args()


def schedule_jobs(scheduler: BackgroundScheduler, *, page_size: int, months_history: int) -> None:
    cron_expr = os.getenv("SCHEDULE_CRON")
    hours = os.getenv("SCHEDULE_EVERY_HOURS", "3")
    if cron_expr:
        try:
            trigger = CronTrigger.from_crontab(cron_expr)
            scheduler.add_job(
                run_pipeline,
                trigger=trigger,
                kwargs={"full": False, "page_size": page_size, "months_history": months_history},
                name="pipeline-cron",
            )
            log("run_all", "INFO", "scheduler_registered", mode="cron", expression=cron_expr)
            return
        except Exception as exc:
            log("run_all", "WARNING", "invalid_cron", expression=cron_expr, error=str(exc))

    try:
        every_hours = max(1, int(hours))
    except ValueError:
        every_hours = 3

    trigger = IntervalTrigger(hours=every_hours, start_date=datetime.now() + timedelta(hours=every_hours))
    scheduler.add_job(
        run_pipeline,
        trigger=trigger,
        kwargs={"full": False, "page_size": page_size, "months_history": months_history},
        name="pipeline-interval",
    )
    log("run_all", "INFO", "scheduler_registered", mode="interval", hours=every_hours)


def open_browser(port: int) -> None:
    url = f"http://localhost:{port}/web/"
    try:
        webbrowser.open(url)
    except Exception:
        LOG.warning("Não foi possível abrir o navegador", extra={"url": url})


def main() -> None:
    args = parse_args()
    load_dotenv(dotenv_path=ROOT / ".env", override=True)
    ensure_environment()

    if not args.serve_only:
        log(
            "run_all",
            "INFO",
            "initial_pipeline",
            full=args.full,
            reset_sync=args.reset_sync,
        )
        run_pipeline(
            full=args.full,
            reset_sync=args.reset_sync,
            page_size=args.page_size,
            months_history=args.months_history,
        )

    scheduler = BackgroundScheduler()
    schedule_jobs(scheduler, page_size=args.page_size, months_history=args.months_history)
    scheduler.start()

    config = uvicorn.Config(
        "app.api:app",
        host=args.host,
        port=args.port,
        reload=False,
        access_log=False,
    )
    server = uvicorn.Server(config)

    if not args.no_browser:
        threading.Thread(target=lambda: (time.sleep(3), open_browser(args.port)), daemon=True).start()

    try:
        server.run()
    except KeyboardInterrupt:
        log("run_all", "INFO", "interrupted")
    finally:
        scheduler.shutdown()


if __name__ == "__main__":
    main()

