"""Merge API-derived events with email events and persist the results."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from scripts.flatten_steps import build_api_events
from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EVT_MAIL = DATA / "events_email.json"
OUT_EVENTS = DATA / "events.json"
OUT_DIVERG = DATA / "divergences.json"


def load_email_events() -> List[Dict[str, Any]]:
    if not EVT_MAIL.exists():
        return []
    return json.loads(EVT_MAIL.read_text(encoding="utf-8"))


def make_key(event: Dict[str, Any]) -> str:
    pieces = [
        event.get("source") or "",
        event.get("empresa") or "",
        event.get("subtipo") or "",
        event.get("status") or "",
        event.get("competencia") or "",
        event.get("prazo") or "",
        event.get("entrega") or "",
    ]
    joined = "||".join(str(piece) for piece in pieces)
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()


def prefer_email(event: Dict[str, Any]) -> bool:
    blob = " ".join(
        str(event.get(field, ""))
        for field in ("subtipo", "status", "descricao", "mensagem")
    ).lower()
    return any(token in blob for token in ("mit", "dispensa", "confirma"))


def merge_events() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    api_events = build_api_events()
    email_events = load_email_events()

    merged: Dict[str, Dict[str, Any]] = {}
    divergences: List[Dict[str, Any]] = []

    for event in api_events:
        merged[make_key(event)] = event

    for event in email_events:
        key = make_key(event)
        existing = merged.get(key)
        if not existing:
            merged[key] = event
            continue
        if existing.get("categoria") == "obrigacao" and event.get("categoria") == "obrigacao":
            continue
        if prefer_email(event):
            divergences.append({
                "key": key,
                "api": existing,
                "email": event,
            })
            merged[key] = event

    return list(merged.values()), divergences


def main() -> None:
    events, divergences = merge_events()
    DATA.mkdir(parents=True, exist_ok=True)
    OUT_EVENTS.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_DIVERG.write_text(json.dumps(divergences, ensure_ascii=False, indent=2), encoding="utf-8")
    log(
        "fuse_sources",
        "INFO",
        "Fusionados",
        total=len(events),
        divergencias=len(divergences),
    )


if __name__ == "__main__":
    main()
