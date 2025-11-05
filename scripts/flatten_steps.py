"""Generate Event entries derived from processes and deliveries."""
from __future__ import annotations

from scripts.pipeline import build_events
from scripts.utils.logger import log


def main() -> None:
    log("flatten_steps", "INFO", "starting")
    events = build_events()
    log("flatten_steps", "INFO", "finished", events=len(events))


if __name__ == "__main__":
    main()

