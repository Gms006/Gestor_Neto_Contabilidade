"""Simple structured logger writing to data/logs.txt"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import threading

_BASE = Path(__file__).resolve().parents[2]
_LOG_FILE = _BASE / "data" / "logs.txt"
_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
_LOCK = threading.Lock()

def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def log(component: str, level: str, message: str, **extra):
    """Append a structured log line."""
    payload = {
        "ts": _ts(),
        "component": component,
        "level": level.upper(),
        "msg": message,
    }
    if extra:
        payload["extra"] = extra
    line = json.dumps(payload, ensure_ascii=False)
    with _LOCK:
        with _LOG_FILE.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    print(f"[{payload['level']}] {component}: {message}")
