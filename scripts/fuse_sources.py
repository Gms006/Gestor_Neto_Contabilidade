"""Fuse API and email events into a consolidated dataset."""
from __future__ import annotations

import hashlib
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List

from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EVT_API = DATA / "events_api.json"
EVT_MAIL = DATA / "events_email.json"
OUT_EVENTS = DATA / "events.json"
OUT_DIVERG = DATA / "divergences.json"


def load_events(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


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


def fuse(api_events: Iterable[Dict[str, Any]], email_events: Iterable[Dict[str, Any]]):
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
            # keep API version
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
    api_events = load_events(EVT_API)
    email_events = load_events(EVT_MAIL)
    log("fuse_sources", "INFO", "Eventos carregados", api=len(api_events), email=len(email_events))

    merged, divergences = fuse(api_events, email_events)
    OUT_EVENTS.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_DIVERG.write_text(json.dumps(divergences, ensure_ascii=False, indent=2), encoding="utf-8")

    log("fuse_sources", "INFO", "Fusionados", total=len(merged), divergencias=len(divergences))


if __name__ == "__main__":
    main()
