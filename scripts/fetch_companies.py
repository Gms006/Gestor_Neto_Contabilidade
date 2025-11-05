"""CLI helper to collect companies and obligations."""
from __future__ import annotations

import argparse

from scripts.pipeline import collect_companies
from scripts.utils.logger import log


def main() -> None:
    parser = argparse.ArgumentParser(description="Coleta empresas do Acessórias")
    parser.add_argument(
        "--page-size",
        dest="page_size",
        type=int,
        default=100,
        help="Tamanho da página na API",
    )

    args = parser.parse_args()

    log("fetch_companies", "INFO", "starting", page_size=args.page_size)

    rows = collect_companies(page_size=args.page_size)

    log("fetch_companies", "INFO", "finished", rows=len(rows))


if __name__ == "__main__":
    main()

