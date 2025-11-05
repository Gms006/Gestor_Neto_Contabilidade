"""CLI helper to collect deliveries/obligations."""
from __future__ import annotations

import argparse

from scripts.pipeline import collect_deliveries
from scripts.utils.logger import log


def main() -> None:
    parser = argparse.ArgumentParser(description="Coleta deliveries do Acessórias")
    parser.add_argument("--full", action="store_true", help="Executa sweep completo por CNPJ")
    parser.add_argument(
        "--months-history",
        dest="months_history",
        type=int,
        default=6,
        help="Histórico em meses quando executar --full",
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
        help="Zera SyncState antes de coletar",
    )

    args = parser.parse_args()

    log(
        "fetch_deliveries",
        "INFO",
        "starting",
        full=args.full,
        months_history=args.months_history,
        page_size=args.page_size,
        reset_sync=args.reset_sync,
    )

    rows = collect_deliveries(
        full=args.full,
        months_history=args.months_history,
        page_size=args.page_size,
        reset_sync=args.reset_sync,
    )

    log("fetch_deliveries", "INFO", "finished", rows=len(rows))


if __name__ == "__main__":
    main()

