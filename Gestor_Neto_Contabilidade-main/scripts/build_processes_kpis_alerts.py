"""Generate consolidated KPIs and alerts using persisted DB data."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any, Dict, Iterable, List, Optional

from scripts.db import Company, Process, init_db, session_scope
from scripts.flatten_steps import delivery_events, load_delivery_payloads
from scripts.fuse_sources import merge_events
from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PROC_OUT = DATA / "processes.json"
KPI_FILE = DATA / "kpis.json"
ALERTS_FILE = DATA / "alerts.json"
META_FILE = DATA / "meta.json"
CONFIG = ROOT / "scripts" / "config.json"


def load_config() -> Dict[str, Any]:
    if CONFIG.exists():
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    return {}


def normalize_date(value: Optional[datetime]) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    return None


def load_processes_from_db() -> List[Dict[str, Any]]:
    init_db()
    with session_scope() as session:
        records = (
            session.query(Process)
            .outerjoin(Company, Company.id == Process.company_id)
            .all()
        )

    processes: List[Dict[str, Any]] = []
    for record in records:
        processes.append(
            {
                "proc_id": record.proc_id,
                "empresa": record.company.nome if record.company else None,
                "cnpj": record.company_id,
                "inicio": normalize_date(record.inicio),
                "conclusao": normalize_date(record.conclusao),
                "dias_corridos": record.dias_corridos,
                "status": record.status,
                "gestor": record.gestor,
                "ultimo_update": record.last_dh.isoformat() if record.last_dh else None,
            }
        )
    return processes


def obligations_counters(events: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    by_subtipo = Counter()
    by_status = Counter()
    totals = Counter()
    for event in events:
        if event.get("categoria") != "obrigacao":
            continue
        subtipo = (event.get("subtipo") or "").strip() or "Sem subtipo"
        status = (event.get("status") or "").strip() or "Sem status"
        competencia = (event.get("competencia") or "").strip() or "Sem competencia"
        by_subtipo[subtipo] += 1
        by_status[status] += 1
        totals[status] += 1
    return {
        "by_subtipo": dict(by_subtipo),
        "by_status": dict(by_status),
        "totals": dict(totals),
    }


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
        prazo = event.get("prazo")
        entrega = event.get("entrega")

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


def company_totals_from_deliveries() -> Dict[str, int]:
    deliveries = delivery_events(load_delivery_payloads())
    totals: defaultdict[str, int] = defaultdict(int)
    for event in deliveries:
        status = (event.get("status") or "").strip() or "Sem status"
        totals[status] += 1
    return dict(totals)


def main() -> None:
    cfg = load_config()
    processes = load_processes_from_db()
    events, _ = merge_events()

    log(
        "build", "INFO", "Linhas carregadas", processes=len(processes), events=len(events)
    )

    PROC_OUT.write_text(json.dumps(processes, ensure_ascii=False, indent=2), encoding="utf-8")

    obligations_data = obligations_counters(events)
    kpis = {
        "processes": {
            "by_status": process_status_counts(processes),
            "avg_days_concluded": average_days_concluded(processes),
        },
        "obligations": obligations_data,
        "companies": {"obligations_totals": company_totals_from_deliveries()},
    }
    KPI_FILE.write_text(json.dumps(kpis, ensure_ascii=False, indent=2), encoding="utf-8")

    alerts = build_alerts(events, cfg)
    ALERTS_FILE.write_text(json.dumps(alerts, ensure_ascii=False, indent=2), encoding="utf-8")

    meta = {
        "last_update_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "counts": {
            "processes": len(processes),
            "events": len(events),
        },
    }
    META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    log(
        "build",
        "INFO",
        "Arquivos gerados",
        processes=len(processes),
        alerts=len(alerts.get("bloqueantes", [])),
    )


if __name__ == "__main__":
    main()
