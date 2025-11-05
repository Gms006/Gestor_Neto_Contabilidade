"""Build fallback JSON files for processes, KPIs and alerts."""
from __future__ import annotations

from scripts.pipeline import compute_kpis
from scripts.utils.logger import log


def main() -> None:
    log("build_kpis", "INFO", "starting")
    payload = compute_kpis()
    log("build_kpis", "INFO", "finished", kpis=len(payload.get("kpis", {})))


if __name__ == "__main__":
    main()

