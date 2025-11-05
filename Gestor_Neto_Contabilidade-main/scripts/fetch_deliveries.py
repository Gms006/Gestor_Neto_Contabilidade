"""Collect deliveries (obrigações) and persist them locally."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dateutil import parser
from dotenv import load_dotenv

from scripts.acessorias_client import AcessoriasClient
from scripts.db import init_db, session_scope, upsert_deliveries
from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SNAPSHOT = DATA / "deliveries_raw.json"
SYNC_STATE = DATA / ".sync_state.json"
CONFIG_PATH = ROOT / "scripts" / "config.json"

load_dotenv(dotenv_path=ROOT / ".env", override=True)


def ensure_dirs() -> None:
    DATA.mkdir(parents=True, exist_ok=True)


def load_config() -> Dict[str, Any]:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {}


def load_sync_state() -> Dict[str, Any]:
    if SYNC_STATE.exists():
        try:
            return json.loads(SYNC_STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log("fetch_deliveries", "WARNING", "sync_state inválido, reiniciando")
    return {}


def save_sync_state(state: Dict[str, Any]) -> None:
    SYNC_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def compute_dt_last_dh(last_value: Optional[str]) -> str:
    if last_value:
        try:
            parsed = parser.isoparse(last_value)
        except (ValueError, TypeError, parser.ParserError):
            parsed = None
        if parsed:
            parsed = parsed.astimezone(timezone.utc).replace(microsecond=0)
            cutoff = datetime.now(timezone.utc) - timedelta(days=1)
            if parsed < cutoff:
                parsed = cutoff
            return parsed.strftime("%Y-%m-%d %H:%M:%S")

    today = datetime.now(timezone.utc)
    yesterday = today - timedelta(days=1)
    return yesterday.strftime("%Y-%m-%d %H:%M:%S")


def iter_pages(fn, **kwargs):
    page = 1
    while True:
        rows = fn(page=page, **kwargs)
        if not rows:
            break
        yield rows
        page += 1


def collect_delta(client: AcessoriasClient, dt_last_dh: str) -> List[Dict[str, Any]]:
    parsed = datetime.strptime(dt_last_dh, "%Y-%m-%d %H:%M:%S")
    target_date = parsed.date()
    today = date.today()
    if target_date < today:
        dt_initial = target_date.strftime("%Y-%m-%d")
    else:
        dt_initial = today.strftime("%Y-%m-%d")
    dt_final = dt_initial

    aggregated: List[Dict[str, Any]] = []
    for rows in iter_pages(
        client.list_deliveries_listall,
        dt_initial=dt_initial,
        dt_final=dt_final,
        dt_last_dh=dt_last_dh,
        include_config=False,
    ):
        aggregated.extend(rows)
        log("fetch_deliveries", "INFO", "pagina_delta", count=len(rows), dt=dt_initial)
    return aggregated


def collect_history(client: AcessoriasClient, cnpjs: List[str], start: date, end: date) -> List[Dict[str, Any]]:
    aggregated: List[Dict[str, Any]] = []
    dt_initial = start.strftime("%Y-%m-%d")
    dt_final = end.strftime("%Y-%m-%d")
    for cnpj in cnpjs:
        for rows in iter_pages(
            client.list_deliveries_by_cnpj,
            cnpj=cnpj,
            dt_initial=dt_initial,
            dt_final=dt_final,
            include_config=False,
        ):
            aggregated.extend(rows)
            # CODEx: histórico por CNPJ garante preenchimento dos cards do dashboard.
            log("fetch_deliveries", "INFO", "pagina_historico", cnpj=cnpj, count=len(rows))
    return aggregated


def load_company_ids() -> List[str]:
    from scripts.db import Company

    init_db()
    with session_scope() as session:
        companies = session.query(Company).all()
        return [company.id for company in companies if company.id]


def persist_deliveries(rows: List[Dict[str, Any]]) -> None:
    if not rows:
        log("fetch_deliveries", "INFO", "Nenhuma entrega para persistir")
        return

    init_db()
    with session_scope() as session:
        total = upsert_deliveries(session, rows)
        log("fetch_deliveries", "INFO", "deliveries_persistidos", total=total)


def build_snapshot(rows: List[Dict[str, Any]]) -> None:
    ensure_dirs()
    SNAPSHOT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_deliveries", "INFO", "snapshot_deliveries", arquivo=str(SNAPSHOT), total=len(rows))


def main() -> None:
    ensure_dirs()
    cfg = load_config()
    deliveries_cfg = cfg.get("deliveries", {})

    client = AcessoriasClient()
    sync_state = load_sync_state()

    history_days = int(deliveries_cfg.get("history_days", deliveries_cfg.get("days_back", 180)))
    history_end = date.today()
    history_start = history_end - timedelta(days=history_days)

    dt_last_dh = compute_dt_last_dh((sync_state.get("deliveries") or {}).get("last_sync"))

    history_rows: List[Dict[str, Any]] = []
    try:
        cnpjs = load_company_ids()
        history_rows = collect_history(client, cnpjs, history_start, history_end)
    except Exception as exc:
        log("fetch_deliveries", "ERROR", "historico_falhou", error=str(exc))

    delta_rows: List[Dict[str, Any]] = []
    try:
        delta_rows = collect_delta(client, dt_last_dh)
    except Exception as exc:
        log("fetch_deliveries", "ERROR", "delta_falhou", error=str(exc))

    combined = history_rows + delta_rows
    persist_deliveries(combined)
    build_snapshot(combined)

    now_utc = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    sync_state.setdefault("deliveries", {})["last_sync"] = now_utc
    save_sync_state(sync_state)
    log("fetch_deliveries", "INFO", "sync_state_atualizado", last_sync=now_utc)


if __name__ == "__main__":
    main()
