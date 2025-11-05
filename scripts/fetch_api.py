"""CLI helper to collect processes from the Acessórias API."""
from __future__ import annotations

import argparse
from datetime import datetime
from typing import List, Optional

from scripts.pipeline import collect_processes
from scripts.utils.logger import log


def parse_statuses(values: Optional[List[str]]) -> List[str]:
    if not values:
        return []
    cleaned: List[str] = []
    for value in values:
        for token in value.split(","):
            token = token.strip()
            if token:
                cleaned.append(token.upper())
    return cleaned


def main() -> None:
    parser = argparse.ArgumentParser(description="Coleta processos do Acessórias")
    parser.add_argument("--full", action="store_true", help="Executa coleta completa ignorando estado incremental")
    parser.add_argument(
        "--status",
        action="append",
        help="Filtro ProcStatus (letras A/C/S/D/P/W). Pode repetir ou separar por vírgula.",
    )
    parser.add_argument(
        "--from",
        dest="dt_from",
        help="Data inicial (YYYY-MM-DD) para ProcInicioIni",
    )
    parser.add_argument(
        "--page-size",
        dest="page_size",
        type=int,
        default=100,
        help="Tamanho da página na API",
    )
    parser.add_argument(
        "--reset-sync",
        action="store_true",
        help="Limpa SyncState antes de coletar",
    )

    args = parser.parse_args()

    statuses = parse_statuses(args.status)
    dt_from = None
    if args.dt_from:
        dt_from = datetime.strptime(args.dt_from, "%Y-%m-%d").date()

    log(
        "fetch_api",
        "INFO",
        "starting",
        full=args.full,
        statuses=statuses,
        page_size=args.page_size,
        reset_sync=args.reset_sync,
        dt_from=dt_from.isoformat() if dt_from else None,
    )

    rows = collect_processes(
        statuses=statuses,
        full=args.full,
        page_size=args.page_size,
        reset_sync=args.reset_sync,
        dt_from=dt_from,
    )

    log("fetch_api", "INFO", "finished", rows=len(rows))


if __name__ == "__main__":
    main()

