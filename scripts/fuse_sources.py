"""Legacy entrypoint that ensures events fallback JSON is available."""
from __future__ import annotations

from scripts.pipeline import build_events
from scripts.utils.logger import log


def main() -> None:
    log("fuse_sources", "INFO", "starting")
    events = build_events()
    log("fuse_sources", "INFO", "finished", events=len(events))


if __name__ == "__main__":
    main()

