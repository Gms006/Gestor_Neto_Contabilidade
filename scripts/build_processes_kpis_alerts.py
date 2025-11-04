"""Produce consolidated datasets for the portal (processes, KPIs, alerts, meta)."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any, Dict, Iterable, List, Optional

from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
API_FILE = DATA / "api_processes.json"
EVENTS_FILE = DATA / "events.json"
COMPANIES_FILE = DATA / "companies_obligations.json"
PROC_OUT = DATA / "processes.json"
KPI_FILE = DATA / "kpis.json"
ALERTS_FILE = DATA / "alerts.json"
META_FILE = DATA / "meta.json"
CONFIG = ROOT / "scripts" / "config.json"


def load_json(path: Path) -> Any:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def load_config() -> Dict[str, Any]:
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def normalize_date(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        if len(value) >= 10 and value[4] == "-":
            return value[:10]
        if "/" in value:
            parsed = datetime.strptime(value, "%d/%m/%Y")
            return parsed.strftime("%Y-%m-%d")
    except ValueError:
        return None
    return value[:10]


def build_processes(api_rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    processes: List[Dict[str, Any]] = []
    for row in api_rows:
        if not isinstance(row, dict):
            continue
        proc_id = str(row.get("ProcID") or row.get("proc_id") or "").strip()
        if not proc_id:
            continue
        processes.append(
            {
                "proc_id": proc_id,
                "empresa": row.get("EmpNome") or row.get("empresa"),
                "cnpj": row.get("EmpCNPJ") or row.get("cnpj"),
                "inicio": normalize_date(row.get("ProcInicio") or row.get("inicio")),
                "conclusao": normalize_date(row.get("ProcConclusao") or row.get("conclusao")),
                "dias_corridos": int(float(row.get("ProcDiasCorridos") or row.get("dias_corridos") or 0)),
                "status": row.get("ProcStatusLabel") or row.get("ProcStatus") or row.get("status"),
                "gestor": row.get("ProcGestor") or row.get("gestor"),
                "ultimo_update": row.get("DtLastDH") or row.get("ultimo_update"),
            }
        )
    return processes


def obligations_counters(events: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    by_subtipo = Counter()
    by_status = Counter()
    for event in events:
        if event.get("categoria") != "obrigacao":
            continue
        subtipo = (event.get("subtipo") or "").strip() or "Sem subtipo"
        status = (event.get("status") or "").strip() or "Sem status"
        by_subtipo[subtipo] += 1
        by_status[status] += 1
    return {
        "by_subtipo": dict(by_subtipo),
        "by_status": dict(by_status),
    }


def aggregate_company_totals(companies: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    totals: defaultdict[str, int] = defaultdict(int)
    for company in companies:
        counters = (company or {}).get("counters", {}).get("totals", {})
        for key, value in counters.items():
            try:
                totals[key] += int(value or 0)
            except (TypeError, ValueError):
                continue
    return dict(totals)


def process_status_counts(processes: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    counter: Counter[str] = Counter()
    for proc in processes:
        status = (proc.get("status") or "").strip() or "Sem status"
        counter[status] += 1
    return dict(counter)


def average_days_concluded(processes: Iterable[Dict[str, Any]]) -> Optional[float]:
    values = [p.get("dias_corridos") for p in processes if p.get("conclusao")]
    values = [v for v in values if isinstance(v, (int, float)) and v]
    if not values:
        return None
    return round(mean(values), 2)


def build_alerts(events: Iterable[Dict[str, Any]], cfg: Dict[str, Any]) -> Dict[str, Any]:
    deadlines = cfg.get("deadlines", {})
    reinf_day = int(deadlines.get("reinf_day", 15))
    efd_day = int(deadlines.get("efd_contrib_day", 20))
    risk_window = int(deadlines.get("risk_window_days", 5))

    today = date.today()
    reinf_due = date(today.year, today.month, reinf_day)
    efd_due = date(today.year, today.month, efd_day)

    reinf_alerts: List[Dict[str, Any]] = []
    efd_alerts: List[Dict[str, Any]] = []
    bloqueantes: List[Dict[str, Any]] = []

    def due_within(due: date) -> bool:
        delta = (due - today).days
        return 0 <= delta <= risk_window

    for event in events:
        if event.get("categoria") == "process_step" and event.get("bloqueante") and str(event.get("passo_status")).lower() != "ok":
            bloqueantes.append(
                {
                    "proc_id": event.get("proc_id"),
                    "empresa": event.get("empresa"),
                    "prazo": event.get("prazo"),
                    "responsavel": event.get("responsavel"),
                }
            )
            continue

        if event.get("categoria") != "obrigacao":
            continue

        subtipo = (event.get("subtipo") or "").lower()
        status = (event.get("status") or "").lower()
        prazo = normalize_date(event.get("prazo"))
        entrega = normalize_date(event.get("entrega"))

        if entrega and status.startswith("entreg"):
            continue

        target_list: Optional[List[Dict[str, Any]]] = None
        deadline_date: Optional[date] = None
        if "reinf" in subtipo:
            target_list = reinf_alerts
            deadline_date = reinf_due
        elif "efd" in subtipo and "contrib" in subtipo:
            target_list = efd_alerts
            deadline_date = efd_due

        if not target_list:
            continue

        if prazo:
            try:
                deadline_date = datetime.strptime(prazo, "%Y-%m-%d").date()
            except ValueError:
                pass

        if deadline_date and due_within(deadline_date):
            target_list.append(
                {
                    "proc_id": event.get("proc_id"),
                    "empresa": event.get("empresa"),
                    "competencia": event.get("competencia"),
                    "prazo": deadline_date.strftime("%Y-%m-%d"),
                    "status": event.get("status"),
                }
            )

    reinf_alerts.sort(key=lambda item: item.get("prazo") or "")
    efd_alerts.sort(key=lambda item: item.get("prazo") or "")
    bloqueantes.sort(key=lambda item: item.get("prazo") or "")

    return {
        "reinf_em_risco": reinf_alerts,
        "efd_contrib_em_risco": efd_alerts,
        "bloqueantes": bloqueantes,
    }
    for company in companies:
        counters = (company or {}).get("counters", {}).get("totals", {})
        for key in totals:
            totals[key] += int(counters.get(key, 0) or 0)
    kpis.setdefault("companies", {})["obligations_totals"] = totals


def main() -> None:
    cfg = load_config()
    api_rows = load_json(API_FILE)
    events = load_json(EVENTS_FILE)
    companies = load_json(COMPANIES_FILE)


def enrich_with_companies(kpis: Dict[str, Any], companies: Iterable[Dict[str, Any]]) -> None:
    totals = {
        "entregues": 0,
        "atrasadas": 0,
        "proximos30": 0,
        "futuras30": 0,
    }
    for company in companies:
        counters = (company or {}).get("counters", {}).get("totals", {})
        for key in totals:
            totals[key] += int(counters.get(key, 0) or 0)
    kpis.setdefault("companies", {})["obligations_totals"] = totals


def main() -> None:
    cfg = load_config()
    api_rows = load_json(API_FILE)
    events = load_json(EVENTS_FILE)
    companies = load_json(COMPANIES_FILE)

    log("build", "INFO", "Linhas carregadas", api=len(api_rows), events=len(events), companies=len(companies))

    processes = build_processes(api_rows)
    PROC_OUT.write_text(json.dumps(processes, ensure_ascii=False, indent=2), encoding="utf-8")

    obligations_data = obligations_counters(events)
    kpis = {
        "processes": {
            "by_status": process_status_counts(processes),
            "avg_days_concluded": average_days_concluded(processes),
        },
        "obligations": obligations_data,
    }
    enrich_with_companies(kpis, companies)
    if not events:
        fallback = aggregate_company_totals(companies)
        if fallback:
            obligations_data["totals"] = fallback
    KPI_FILE.write_text(json.dumps(kpis, ensure_ascii=False, indent=2), encoding="utf-8")

    alerts = build_alerts(events, cfg)
    ALERTS_FILE.write_text(json.dumps(alerts, ensure_ascii=False, indent=2), encoding="utf-8")

    meta = {
        "last_update_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "counts": {
            "processes": len(processes),
            "events": len(events),
            "companies": len(companies),
        },
    }
    META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    log("build", "INFO", "Arquivos gerados", processes=len(processes), alerts=len(alerts.get("bloqueantes", [])))


if __name__ == "__main__":
    main()
