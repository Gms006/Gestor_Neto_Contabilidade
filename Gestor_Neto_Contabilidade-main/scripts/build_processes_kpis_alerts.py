"""Produce consolidated datasets for the portal (processes, KPIs, alerts, meta)."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from statistics import mean, median
from typing import Any, Dict, Iterable, List, Optional

from scripts.utils.logger import log

# Importar módulos do banco de dados
try:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from scripts.db import get_session, Process, Delivery, Company
    DB_AVAILABLE = True
except Exception as e:
    import logging
    logging.warning(f"Banco de dados não disponível: {e}")
    DB_AVAILABLE = False

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

# Novos arquivos JSON para o frontend
FECHAMENTO_STATS_FILE = DATA / "fechamento_stats.json"
REINF_COMPETENCIA_FILE = DATA / "reinf_competencia.json"
EFDCONTRIB_COMPETENCIA_FILE = DATA / "efdcontrib_competencia.json"
DIFAL_TIPO_FILE = DATA / "difal_tipo.json"
DELIVERIES_FILE = DATA / "deliveries.json"


def load_json(path: Path) -> Any:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj: Any) -> None:
    """Escreve objeto como JSON no caminho especificado."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


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


def calculate_closing_day_stats(processes: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    """Calcula dia médio e mediano de fechamento dos processos."""
    closing_days = []
    for proc in processes:
        conclusao = proc.get("conclusao")
        if not conclusao:
            continue
        
        try:
            if isinstance(conclusao, str):
                dt = datetime.strptime(conclusao[:10], "%Y-%m-%d")
            else:
                dt = conclusao
            closing_days.append(dt.day)
        except (ValueError, AttributeError):
            continue
    
    if not closing_days:
        return {"media": None, "mediana": None, "n": 0}
    
    return {
        "media": round(mean(closing_days), 1),
        "mediana": int(median(closing_days)),
        "n": len(closing_days)
    }


def load_processes_from_db() -> List[Dict[str, Any]]:
    """Carrega processos do banco de dados com eager loading."""
    if not DB_AVAILABLE:
        return []
    
    try:
        session = get_session()
        
        # Usar selectinload para carregar company junto
        stmt = select(Process).options(selectinload(Process.company))
        processes_db = session.execute(stmt).scalars().all()
        
        processes = []
        for proc in processes_db:
            processes.append({
                "proc_id": proc.proc_id,
                "titulo": proc.titulo,
                "empresa": proc.company.nome if proc.company else "",
                "cnpj": proc.company_id,
                "inicio": proc.inicio.isoformat() if proc.inicio else None,
                "conclusao": proc.conclusao.isoformat() if proc.conclusao else None,
                "dias_corridos": proc.dias_corridos,
                "status": proc.status,
                "gestor": proc.gestor,
                "ultimo_update": proc.last_dh.isoformat() if proc.last_dh else None,
            })
        
        session.close()
        return processes
        
    except Exception as e:
        log("build", "ERROR", "Erro ao carregar processos do banco", error=str(e))
        return []


def load_deliveries_from_db() -> List[Dict[str, Any]]:
    """Carrega deliveries do banco de dados com eager loading."""
    if not DB_AVAILABLE:
        return []
    
    try:
        session = get_session()
        
        # Usar selectinload para carregar company junto
        stmt = select(Delivery).options(selectinload(Delivery.company))
        deliveries_db = session.execute(stmt).scalars().all()
        
        deliveries = []
        for deliv in deliveries_db:
            deliveries.append({
                "id": deliv.id,
                "company_id": deliv.company_id,
                "empresa": deliv.company.nome if deliv.company else "",
                "cnpj": deliv.company.cnpj if deliv.company else deliv.company_id,
                "nome": deliv.nome,
                "categoria": deliv.categoria,
                "subtipo": deliv.subtipo,
                "status": deliv.status,
                "competencia": deliv.competencia,
                "prazo": deliv.prazo.isoformat() if deliv.prazo else None,
                "entregue_em": deliv.entregue_em.isoformat() if deliv.entregue_em else None,
            })
        
        session.close()
        return deliveries
        
    except Exception as e:
        log("build", "ERROR", "Erro ao carregar deliveries do banco", error=str(e))
        return []


def build_reinf_competencia(deliveries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Agrega dados de REINF por competência."""
    by_comp = defaultdict(lambda: {"obrigatoria": 0, "dispensa": 0})
    
    for deliv in deliveries:
        if not deliv.get("categoria") or "reinf" not in deliv["categoria"].lower():
            continue
        
        comp = deliv.get("competencia", "")
        if not comp:
            continue
        
        status = (deliv.get("status") or "").lower()
        if "obrig" in status:
            by_comp[comp]["obrigatoria"] += 1
        elif "dispens" in status:
            by_comp[comp]["dispensa"] += 1
    
    series = [{"competencia": comp, **counts} for comp, counts in sorted(by_comp.items())]
    return {"series": series}


def build_efdcontrib_competencia(deliveries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Agrega dados de EFD-Contribuições por competência."""
    by_comp = defaultdict(lambda: {"obrigatoria": 0, "dispensa": 0})
    
    for deliv in deliveries:
        if not deliv.get("categoria") or "efd" not in deliv["categoria"].lower() or "contrib" not in deliv["categoria"].lower():
            continue
        
        comp = deliv.get("competencia", "")
        if not comp:
            continue
        
        status = (deliv.get("status") or "").lower()
        if "obrig" in status:
            by_comp[comp]["obrigatoria"] += 1
        elif "dispens" in status:
            by_comp[comp]["dispensa"] += 1
    
    series = [{"competencia": comp, **counts} for comp, counts in sorted(by_comp.items())]
    return {"series": series}


def build_difal_tipo(deliveries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Agrega dados de DIFAL por tipo."""
    by_tipo = Counter()
    
    for deliv in deliveries:
        if not deliv.get("categoria") or "difal" not in deliv["categoria"].lower():
            continue
        
        subtipo = deliv.get("subtipo", "").lower()
        if "comercializa" in subtipo:
            by_tipo["Comercialização"] += 1
        elif "consumo" in subtipo or "imobilizado" in subtipo:
            by_tipo["Consumo/Imobilizado"] += 1
        elif "ambos" in subtipo:
            by_tipo["Comercialização"] += 1
            by_tipo["Consumo/Imobilizado"] += 1
        else:
            by_tipo["Outros"] += 1
    
    tipos = [{"tipo": tipo, "qtd": qtd} for tipo, qtd in by_tipo.items()]
    return {"tipos": tipos}


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
    
    # Tentar carregar do banco primeiro, depois fallback para JSON
    if DB_AVAILABLE:
        processes = load_processes_from_db()
        deliveries = load_deliveries_from_db()
        
        if not processes:
            api_rows = load_json(API_FILE)
            processes = build_processes(api_rows)
    else:
        api_rows = load_json(API_FILE)
        processes = build_processes(api_rows)
        deliveries = []
    
    events = load_json(EVENTS_FILE)
    companies = load_json(COMPANIES_FILE)

    log("build", "INFO", "Linhas carregadas", processes=len(processes), events=len(events), companies=len(companies), deliveries=len(deliveries))
    
    # 1. Salvar processes.json
    write_json(PROC_OUT, processes)

    # 2. Calcular e salvar estatísticas de fechamento
    closing_stats = calculate_closing_day_stats(processes)
    write_json(FECHAMENTO_STATS_FILE, closing_stats)
    log("build", "INFO", "Estatísticas de fechamento", stats=closing_stats)

    # 3. Gerar agregações de deliveries
    if deliveries:
        reinf_data = build_reinf_competencia(deliveries)
        write_json(REINF_COMPETENCIA_FILE, reinf_data)
        
        efdcontrib_data = build_efdcontrib_competencia(deliveries)
        write_json(EFDCONTRIB_COMPETENCIA_FILE, efdcontrib_data)
        
        difal_data = build_difal_tipo(deliveries)
        write_json(DIFAL_TIPO_FILE, difal_data)
        
        # Salvar snapshot de deliveries
        write_json(DELIVERIES_FILE, deliveries)
        
        log("build", "INFO", "Deliveries agregadas", 
            reinf=len(reinf_data.get("series", [])),
            efdcontrib=len(efdcontrib_data.get("series", [])),
            difal=len(difal_data.get("tipos", [])))
    else:
        # Placeholders vazios
        write_json(REINF_COMPETENCIA_FILE, {"series": []})
        write_json(EFDCONTRIB_COMPETENCIA_FILE, {"series": []})
        write_json(DIFAL_TIPO_FILE, {"tipos": []})
        write_json(DELIVERIES_FILE, [])
        log("build", "WARNING", "Nenhuma delivery encontrada, gerando placeholders vazios")

    # 4. Gerar KPIs
    obligations_data = obligations_counters(events)
    kpis = {
        "processes": {
            "by_status": process_status_counts(processes),
            "avg_days_concluded": average_days_concluded(processes),
            "closing_day_avg": closing_stats.get("media"),
            "closing_day_median": closing_stats.get("mediana"),
        },
        "obligations": obligations_data,
    }
    enrich_with_companies(kpis, companies)
    if not events:
        fallback = aggregate_company_totals(companies)
        if fallback:
            obligations_data["totals"] = fallback
    write_json(KPI_FILE, kpis)

    # 5. Gerar alertas
    alerts = build_alerts(events, cfg)
    write_json(ALERTS_FILE, alerts)

    # 6. Gerar meta
    meta = {
        "last_update_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "counts": {
            "processes": len(processes),
            "events": len(events),
            "companies": len(companies),
            "deliveries": len(deliveries),
        },
    }
    write_json(META_FILE, meta)

    log("build", "INFO", "Arquivos gerados", 
        processes=len(processes), 
        deliveries=len(deliveries),
        alerts=len(alerts.get("bloqueantes", [])))


if __name__ == "__main__":
    main()
