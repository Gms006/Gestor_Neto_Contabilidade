"""Fetch company obligation snapshots from Acessórias."""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from dateutil import parser
from dotenv import load_dotenv

from scripts.acessorias_client import AcessoriasClient
from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG_PATH = ROOT / "scripts" / "config.json"
OUTPUT = DATA / "companies_obligations.json"


STATUS_FIELDS = ("Status", "status", "EntStatus", "situacao")
TYPE_FIELDS = ("Tipo", "tipo", "Obligation", "obrigacao", "Descricao", "descricao")
DUE_FIELDS = ("Prazo", "prazo", "EntDtPrazo", "DataPrazo")
DELIVERY_FIELDS = ("Entrega", "entrega", "EntDtEntrega")


def ensure_dirs() -> None:
    DATA.mkdir(exist_ok=True)


def load_config() -> Dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def parse_date(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        dt = parser.parse(str(value))
        return dt
    except (ValueError, TypeError, parser.ParserError):
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


def main() -> None:
    load_dotenv()
    ensure_dirs()

    cfg = load_config()
    acessorias_cfg = cfg.get("acessorias", {})
    client = AcessoriasClient(
        base_url=acessorias_cfg.get("base_url"),
        page_size=int(acessorias_cfg.get("page_size", 20)),
        rate_budget=int(acessorias_cfg.get("rate_budget", 90)),
    )

    log("fetch_companies", "INFO", "Coletando obrigações por empresa")
    companies = client.list_companies_obligations()
    log("fetch_companies", "INFO", "Empresas coletadas", total=len(companies))

    processed: List[Dict[str, Any]] = []
    for company in companies:
        obligations = company.get("Obligations") or company.get("obligations") or []
        counters = build_counters(obligations if isinstance(obligations, list) else [])
        processed.append(
            {
                "empresa": company.get("RazaoSocial") or company.get("Nome") or company.get("Fantasia") or company.get("empresa"),
                "cnpj": company.get("CNPJ") or company.get("cnpj"),
                "raw": company,
                "counters": counters,
            }
        )

    OUTPUT.write_text(json.dumps(processed, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_companies", "INFO", "Salvo companies_obligations.json", total=len(processed))


if __name__ == "__main__":
    main()
