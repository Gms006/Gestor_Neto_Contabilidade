# -*- coding: utf-8 -*-
"""
Funde events_api.json (fonte canônica) com events_email.json (complemento/auditoria)
Gera data/events.json + data/divergences.json
"""
import json
from pathlib import Path
from typing import Dict, Any, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EVT_API = DATA / "events_api.json"
EVT_MAIL = DATA / "events_email.json"
OUT_EVENTS = DATA / "events.json"
OUT_DIVERG = DATA / "divergences.json"

Key = Tuple[str, str, str, str]  # (proc_id, categoria, subtipo, competencia)

def loadj(p: Path):
    if not p.exists(): return []
    return json.loads(p.read_text(encoding="utf-8"))

def key_of(e: Dict[str, Any]) -> Key:
    return (
        str(e.get("proc_id") or ""),
        str(e.get("categoria") or ""),
        str(e.get("subtipo") or ""),
        str(e.get("competencia") or "")
    )

def main():
    api = loadj(EVT_API)
    mail = loadj(EVT_MAIL)

    canonic: Dict[Key, Dict[str, Any]] = {}
    for e in api:
        canonic[key_of(e)] = e

    diverg: List[Dict[str, Any]] = []
    # merge email (complementar)
    for e in mail:
        k = key_of(e)
        if k not in canonic:
            canonic[k] = e  # complementar
        else:
            a = canonic[k]
            # verificar divergências de status
            if (a.get("status") or "").lower() != (e.get("status") or "").lower():
                diverg.append({
                    "proc_id": e.get("proc_id"),
                    "categoria": e.get("categoria"),
                    "subtipo": e.get("subtipo"),
                    "competencia": e.get("competencia"),
                    "api": a.get("status"),
                    "email": e.get("status")
                })

    merged = list(canonic.values())
    OUT_EVENTS.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    OUT_DIVERG.write_text(json.dumps(diverg, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fuse_sources] OK: {OUT_EVENTS}  divergências: {len(diverg)}")

if __name__ == "__main__":
    main()
