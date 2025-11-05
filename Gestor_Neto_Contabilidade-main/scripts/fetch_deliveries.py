# -*- coding: utf-8 -*-
"""Collect deliveries from Acessórias API with incremental day slices."""
from __future__ import annotations

import os
import json
from datetime import date, datetime, timedelta, time, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dateutil import parser
from dotenv import load_dotenv

# ---- logger com fallback -----------------------------------
try:
    from scripts.utils.logger import log  # preferencial
except Exception:
    import logging, sys, json as _json_fallback
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    _logger = logging.getLogger("fetch_deliveries")

    def log(src: str, level: str, msg: str, **meta):
        lvl = getattr(logging, (level or "INFO").upper(), logging.INFO)
        if meta:
            try:
                meta_str = _json_fallback.dumps(meta, ensure_ascii=False)
            except Exception:
                meta_str = str(meta)
            _logger.log(lvl, "%s | %s | %s", src, msg, meta_str)
        else:
            _logger.log(lvl, "%s | %s", src, msg)

# ---- normalization com fallback -----------------------------
try:
    from scripts.utils.normalization import normalize_structure
except Exception:
    def normalize_structure(x):  # type: ignore
        return x

from scripts.acessorias_client import AcessoriasClient

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG_PATH = ROOT / "scripts" / "config.json"
SYNC_STATE = DATA / ".sync_state.json"
OUTPUT = DATA / "deliveries_raw.json"

# Carrega .env da raiz do projeto
load_dotenv(dotenv_path=ROOT / ".env", override=True)


def ensure_dirs() -> None:
    DATA.mkdir(exist_ok=True)


def load_config() -> Dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def load_sync_state() -> Dict[str, Any]:
    if SYNC_STATE.exists():
        try:
            return json.loads(SYNC_STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log("fetch_deliveries", "WARNING", "sync_state inválido, reiniciando")
    return {}


def save_sync_state(state: Dict[str, Any]) -> None:
    SYNC_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _parse_last(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt_last = parser.isoparse(value)
    except (ValueError, TypeError, parser.ParserError):
        return None
    if dt_last.tzinfo:
        dt_last = dt_last.astimezone().replace(tzinfo=None)
    return dt_last


def compute_dt_last_dh(last_value: Optional[str]) -> str:
    floor = datetime.combine(date.today() - timedelta(days=1), time.min)
    parsed = _parse_last(last_value)
    if not parsed:
        parsed = floor
    else:
        parsed = parsed - timedelta(minutes=5)
        if parsed < floor:
            parsed = floor
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def daterange(days_back: int, days_forward: int) -> List[date]:
    today = date.today()
    return [today + timedelta(days=offset) for offset in range(-days_back, days_forward + 1)]


def main() -> None:
    # token do .env
    token = (os.getenv("ACESSORIAS_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("ACESSORIAS_TOKEN ausente no .env (ou vazio).")
    # garante disponibilidade para clients que leem do ambiente
    os.environ["ACESSORIAS_TOKEN"] = token

    ensure_dirs()

    cfg = load_config()
    acessorias_cfg = cfg.get("acessorias", {})
    deliveries_cfg = cfg.get("deliveries", {})
    if not deliveries_cfg.get("enabled", True):
        log("fetch_deliveries", "INFO", "Deliveries desabilitado; encerrando")
        return

    sync_state = load_sync_state()
    last_sync = (sync_state.get("deliveries") or {}).get("last_sync")
    dt_last_dh: Optional[str] = None
    if deliveries_cfg.get("use_dt_last_dh", True):
        dt_last_dh = compute_dt_last_dh(last_sync)

    identificador = deliveries_cfg.get("identificador", "ListAll")
    if identificador == "ListAll" and not dt_last_dh:
        dt_last_dh = compute_dt_last_dh(None)

    client = AcessoriasClient(
        base_url=acessorias_cfg.get("base_url"),
        page_size=int(acessorias_cfg.get("page_size", 20)),
        rate_budget=int(acessorias_cfg.get("rate_budget", 90)),
    )

    days_back = int(deliveries_cfg.get("days_back", 0))
    days_forward = int(deliveries_cfg.get("days_forward", 0))
    include_config = True

    aggregated: List[Dict[str, Any]] = []
    days = daterange(days_back, days_forward)
    if days:
        range_start = days[0].strftime("%Y-%m-%d")
        range_end = days[-1].strftime("%Y-%m-%d")
    else:
        range_start = range_end = date.today().strftime("%Y-%m-%d")

    log(
        "fetch_deliveries",
        "INFO",
        "Iniciando coleta",
        identificador=identificador,
        dt_last_dh=dt_last_dh,
        dias=len(days) or 1,
        range_inicio=range_start,
        range_fim=range_end,
    )

    failed_days: List[str] = []

    for target_day in days or [date.today()]:
        day_str = target_day.strftime("%Y-%m-%d")
        log("fetch_deliveries","INFO","Coletando dia",
            identificador=identificador, dt_initial=day_str, dt_last_dh=dt_last_dh)
        try:
            rows = client.list_deliveries(
                identificador=identificador,
                dt_initial=day_str, dt_final=day_str,
                dt_last_dh=dt_last_dh, include_config=include_config,
                page_size=50,
            )
            log("fetch_deliveries","INFO","Dia coletado", day=day_str, count=len(rows))
            aggregated.extend(rows)
        except Exception as exc:
            failed_days.append(day_str)
            log("fetch_deliveries","ERROR","Falha list_deliveries",
                day=day_str, error=str(exc))
            continue

    normalized = [normalize_structure(item) for item in aggregated]
    OUTPUT.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_deliveries","INFO","Salvo deliveries_raw.json",
        total=len(normalized), dias_falhos=failed_days)

    now_utc = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    sync_state.setdefault("deliveries", {})["last_sync"] = now_utc
    save_sync_state(sync_state)
    log("fetch_deliveries", "INFO", "Atualizado sync", last_sync=now_utc)


if __name__ == "__main__":
    main()
