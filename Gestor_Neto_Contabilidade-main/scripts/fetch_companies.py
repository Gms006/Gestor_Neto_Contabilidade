"""Collect companies and their obligations from the Acessórias API."""
from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from dotenv import load_dotenv

from scripts.acessorias_client import AcessoriasClient
from scripts.db import init_db, session_scope, upsert_companies
from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SNAPSHOT = DATA / "companies_obligations.json"

load_dotenv(dotenv_path=ROOT / ".env", override=True)

STATUS_FIELDS = ("Status", "status", "EntStatus", "situacao")
TYPE_FIELDS = ("Tipo", "tipo", "Obligation", "obrigacao", "Descricao", "descricao")
DUE_FIELDS = ("Prazo", "prazo", "EntDtPrazo", "DataPrazo")
DELIVERY_FIELDS = ("Entrega", "entrega", "EntDtEntrega")


def ensure_dirs() -> None:
    DATA.mkdir(parents=True, exist_ok=True)


def parse_date(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        try:
            return datetime.strptime(str(value), "%Y-%m-%d")
        except ValueError:
            return None


def classify_obligation(record: Dict[str, Any], today: datetime) -> str:
    status_text = "".join(str(record.get(field, "")) for field in STATUS_FIELDS).lower()
    if "entreg" in status_text:
        return "entregues"
    for field in DELIVERY_FIELDS:
        if record.get(field):
            return "entregues"
    due_date = None
    for field in DUE_FIELDS:
        due_date = parse_date(record.get(field))
        if due_date:
            break
    if due_date:
        due_date = due_date.replace(tzinfo=None)
        if due_date.date() < today.date():
            return "atrasadas"
        if due_date.date() <= (today + timedelta(days=30)).date():
            return "proximos30"
        return "futuras30"
    return "futuras30"


def extract_tipo(record: Dict[str, Any]) -> str:
    for field in TYPE_FIELDS:
        value = record.get(field)
        if value:
            return str(value)
    return "Geral"


def build_counters(obligations: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    today = datetime.now()
    totals = defaultdict(int)
    by_tipo: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for record in obligations:
        bucket = classify_obligation(record, today)
        tipo = extract_tipo(record)
        totals[bucket] += 1
        by_tipo[tipo][bucket] += 1
    return {
        "totals": dict(totals),
        "by_tipo": {tipo: dict(counts) for tipo, counts in by_tipo.items()},
    }


def collect_companies() -> List[Dict[str, Any]]:
    client = AcessoriasClient()
    page = 1
    aggregated: List[Dict[str, Any]] = []
    while True:
        rows = client.list_companies(page=page)
        if not rows:
            break
        aggregated.extend(rows)
        log("fetch_companies", "INFO", "pagina_companies", page=page, registros=len(rows))
        page += 1
    return aggregated


def persist_companies(rows: List[Dict[str, Any]]) -> None:
    init_db()
    with session_scope() as session:
        count = upsert_companies(session, rows)
        # CODEx: upsert garante que o frontend tenha dados mesmo sem API.
        log("fetch_companies", "INFO", "companies_persistidos", total=count)


def build_snapshot(rows: List[Dict[str, Any]]) -> None:
    ensure_dirs()
    processed: List[Dict[str, Any]] = []
    for company in rows:
        obligations = company.get("Obligations") or company.get("obligations") or []
        counters = build_counters(obligations if isinstance(obligations, list) else [])
        processed.append(
            {
                "empresa": company.get("RazaoSocial")
                or company.get("Nome")
                or company.get("Fantasia")
                or company.get("empresa"),
                "cnpj": company.get("CNPJ") or company.get("cnpj"),
                "raw": company,
                "counters": counters,
            }
        )

    SNAPSHOT.write_text(json.dumps(processed, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_companies", "INFO", "snapshot_companies", arquivo=str(SNAPSHOT), total=len(processed))


def main() -> None:
    ensure_dirs()
    rows = collect_companies()
    persist_companies(rows)
    build_snapshot(rows)


if __name__ == "__main__":
    main()
