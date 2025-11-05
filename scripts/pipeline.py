"""Utilities to orchestrate the Gestor data pipeline."""
from __future__ import annotations

import json
import re
import threading
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean, median
from typing import Any, Dict, Iterable, List, Optional

from dateutil.relativedelta import relativedelta

from scripts.acessorias_client import AcessoriasClient
from scripts.db import (
    Company,
    Delivery,
    Event,
    Process,
    clear_events,
    ensure_database,
    get_session,
    get_sync_state,
    parse_datetime,
    reset_sync_state,
    save_sync_state,
    upsert_company,
    upsert_delivery,
    upsert_event,
    upsert_process,
)
from scripts.utils.logger import get_logger, log

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
LOGS_DIR = DATA_DIR / "logs"

FILES = {
    "processes": DATA_DIR / "processes.json",
    "api_processes": DATA_DIR / "api_processes.json",
    "deliveries": DATA_DIR / "deliveries.json",
    "deliveries_raw": DATA_DIR / "deliveries_raw.json",
    "companies": DATA_DIR / "companies.json",
    "events": DATA_DIR / "events.json",
    "alerts": DATA_DIR / "alerts.json",
    "kpis": DATA_DIR / "kpis.json",
    "meta": DATA_DIR / "meta.json",
    "fechamento": DATA_DIR / "fechamento_stats.json",
    "reinf": DATA_DIR / "reinf_competencia.json",
    "efd": DATA_DIR / "efdcontrib_competencia.json",
    "difal": DATA_DIR / "difal_tipo.json",
}

RULES_PATH = ROOT / "scripts" / "rules.json"

PIPELINE_LOG = get_logger("pipeline")
PIPELINE_LOCK = threading.Lock()

COUNTER_ALIASES = {
    "entregues": ["Entregues", "entregues", "total_entregues"],
    "atrasadas": ["Atrasadas", "atrasadas", "total_atrasadas"],
    "proximos30": ["Proximos30D", "Proximos30d", "Proximos30", "proximos30", "prox_30"],
    "futuras30": ["Futuras30+", "Futuras30", "futuras30", "fut_30"],
}


def ensure_environment() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    ensure_database()


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _safe_int(value: Any) -> int:
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0
    text = str(value).strip()
    if not text:
        return 0
    cleaned = re.sub(r"[^0-9,.-]", "", text)
    if not cleaned:
        return 0
    try:
        return int(float(cleaned.replace(".", "").replace(",", ".")))
    except (TypeError, ValueError):
        return 0


def _merge_counter_values(target: Dict[str, int], source: Dict[str, Any]) -> bool:
    changed = False
    for key, aliases in COUNTER_ALIASES.items():
        for alias in aliases + [key]:
            if alias in source:
                value = _safe_int(source.get(alias))
                if value:
                    target[key] += value
                    changed = True
                break
    return changed


def _counters_from_payload(payload: Optional[Dict[str, Any]]) -> Optional[Dict[str, int]]:
    if not isinstance(payload, dict):
        return None

    existing = payload.get("counters")
    if isinstance(existing, dict):
        totals = existing.get("totals")
        if isinstance(totals, dict):
            normalized = {key: _safe_int(value) for key, value in totals.items()}
            if any(normalized.values()):
                return normalized

    totals = {key: 0 for key in COUNTER_ALIASES}
    has_data = False

    obligations = payload.get("Obrigacoes") or payload.get("obligations") or []
    if isinstance(obligations, list):
        for item in obligations:
            if isinstance(item, dict) and _merge_counter_values(totals, item):
                has_data = True

    summary = payload.get("ObrigacoesTotais") or payload.get("obligations_totals")
    if isinstance(summary, dict) and _merge_counter_values(totals, summary):
        has_data = True

    return totals if has_data else None


def _counters_from_deliveries(deliveries: Iterable[Delivery]) -> Optional[Dict[str, int]]:
    totals = {key: 0 for key in COUNTER_ALIASES}
    has_data = False
    today = datetime.now(timezone.utc).date()

    for delivery in deliveries or []:
        dt_entrega = delivery.dt_entrega.date() if delivery.dt_entrega else None
        dt_prazo = delivery.dt_prazo.date() if delivery.dt_prazo else None
        situacao = (delivery.situacao or "").lower()

        if dt_entrega or "entreg" in situacao:
            totals["entregues"] += 1
            has_data = True
            continue

        if dt_prazo:
            diff = (dt_prazo - today).days
            has_data = True
            if diff < 0 or "atras" in situacao:
                totals["atrasadas"] += 1
            elif diff <= 30:
                totals["proximos30"] += 1
            else:
                totals["futuras30"] += 1
            continue

        if "atras" in situacao:
            totals["atrasadas"] += 1
            has_data = True

    return totals if has_data else None


def payload_counters(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    totals = _counters_from_payload(payload)
    if not totals:
        return None
    return {"totals": totals, "source": "payload"}


def company_counters(company: Company) -> Optional[Dict[str, Any]]:
    totals = _counters_from_payload(company.dados or {})
    if totals:
        return {"totals": totals, "source": "payload"}

    deliveries_totals = _counters_from_deliveries(company.deliveries or [])
    if deliveries_totals:
        return {"totals": deliveries_totals, "source": "deliveries"}

    return None


def collect_processes(
    *,
    statuses: Optional[List[str]] = None,
    full: bool = False,
    page_size: int = 100,
    reset_sync: bool = False,
    dt_from: Optional[date] = None,
) -> List[Dict[str, Any]]:
    ensure_environment()
    client = AcessoriasClient()
    session = get_session()

    try:
        if reset_sync:
            reset_sync_state(session, "processes")

        state = get_sync_state(session, "processes")
        statuses = statuses or []

        if state and state.last_sync_dh and not full:
            dt_last = state.last_sync_dh - timedelta(minutes=5)
        else:
            dt_last = None

        if full:
            dt_last = None

        filters: Dict[str, Any] = {}
        if dt_from:
            filters["ProcInicioIni"] = dt_from.strftime("%Y-%m-%d")

        fetched: List[Dict[str, Any]] = []
        max_last_dh = state.last_sync_dh if state else None

        status_list = statuses or [None]
        for status in status_list:
            page = 1
            while True:
                batch = client.list_processes(
                    status=status,
                    page=page,
                    per_page=page_size,
                    dt_last_dh=dt_last,
                    filters=filters,
                )
                if not batch:
                    break

                for row in batch:
                    upsert_process(session, row)
                    fetched.append(row)
                    if row.get("DtLastDH"):
                        candidate = parse_datetime(row.get("DtLastDH"))
                        if candidate and (
                            not max_last_dh or candidate > max_last_dh
                        ):
                            max_last_dh = candidate
                session.commit()
                log(
                    "pipeline",
                    "INFO",
                    "process_page",
                    status=status or "ALL",
                    page=page,
                    count=len(batch),
                )

                if len(batch) < page_size:
                    break

                page += 1
                time.sleep(client.sleep_seconds)

        if not max_last_dh:
            max_last_dh = datetime.now(timezone.utc)

        save_sync_state(session, endpoint="processes", last_sync_dh=max_last_dh, last_page=None)
        session.commit()
        _write_json(FILES["api_processes"], fetched)
        return fetched
    finally:
        session.close()


def _deliveries_incremental(
    session,
    client: AcessoriasClient,
    *,
    state,
    page_size: int,
) -> List[Dict[str, Any]]:
    today = datetime.now(timezone.utc)
    dt_initial = (today - timedelta(days=1)).strftime("%Y-%m-%d")
    dt_final = today.strftime("%Y-%m-%d")
    dt_last = state.last_sync_dh if state and state.last_sync_dh else today

    fetched: List[Dict[str, Any]] = []
    page = 1
    max_last = state.last_sync_dh if state else None

    while True:
        batch = client.list_deliveries(
            identificador="ListAll",
            page=page,
            per_page=page_size,
            dt_last_dh=dt_last,
            dt_initial=dt_initial,
            dt_final=dt_final,
        )
        if not batch:
            break

        for row in batch:
            upsert_delivery(session, row)
            fetched.append(row)
            if row.get("DtLastDH"):
                candidate = parse_datetime(row.get("DtLastDH"))
                if candidate and (not max_last or candidate > max_last):
                    max_last = candidate
            elif row.get("EntDtEvento"):
                candidate = parse_datetime(row.get("EntDtEvento"))
                if candidate and (not max_last or candidate > max_last):
                    max_last = candidate
        session.commit()
        log("pipeline", "INFO", "deliveries_page", mode="incremental", page=page, count=len(batch))
        if len(batch) < page_size:
            break
        page += 1
        time.sleep(client.sleep_seconds)

    return fetched, max_last


def _deliveries_full(
    session,
    client: AcessoriasClient,
    *,
    months: int,
    page_size: int,
) -> List[Dict[str, Any]]:
    start_date = (datetime.now(timezone.utc) - relativedelta(months=months)).date()
    dt_initial = start_date.replace(day=1).strftime("%Y-%m-%d")
    dt_final = datetime.now(timezone.utc).date().strftime("%Y-%m-%d")

    companies = session.query(Company).all()
    fetched: List[Dict[str, Any]] = []

    for company in companies:
        page = 1
        while True:
            batch = client.deliveries_by_cnpj(
                cnpj=company.cnpj,
                page=page,
                per_page=page_size,
                dt_initial=dt_initial,
                dt_final=dt_final,
            )
            if not batch:
                break
            for row in batch:
                if not row.get("CNPJ"):
                    row["CNPJ"] = company.cnpj
                upsert_delivery(session, row)
                fetched.append(row)
            session.commit()
            log("pipeline", "INFO", "deliveries_page", mode="full", cnpj=company.cnpj, page=page, count=len(batch))
            if len(batch) < page_size:
                break
            page += 1
            time.sleep(client.sleep_seconds)

    return fetched


def collect_deliveries(
    *,
    full: bool = False,
    months_history: int = 6,
    page_size: int = 100,
    reset_sync: bool = False,
) -> List[Dict[str, Any]]:
    ensure_environment()
    client = AcessoriasClient()
    session = get_session()
    try:
        if reset_sync:
            reset_sync_state(session, "deliveries")

        state = get_sync_state(session, "deliveries")
        fetched: List[Dict[str, Any]] = []
        max_last = state.last_sync_dh if state else None

        if full or not state or not state.last_sync_dh:
            fetched = _deliveries_full(
                session,
                client,
                months=months_history,
                page_size=page_size,
            )
            max_last = datetime.now(timezone.utc)
        else:
            fetched, max_last = _deliveries_incremental(
                session,
                client,
                state=state,
                page_size=page_size,
            )

            # Se incremental não retornou nada, roda um sweep curto do último mês
            if not fetched:
                fetched = _deliveries_full(
                    session,
                    client,
                    months=1,
                    page_size=page_size,
                )
                max_last = datetime.now(timezone.utc)

        save_sync_state(session, endpoint="deliveries", last_sync_dh=max_last, last_page=None)
        session.commit()

        _write_json(FILES["deliveries_raw"], fetched)
        return fetched
    finally:
        session.close()


def collect_companies(*, page_size: int = 100) -> List[Dict[str, Any]]:
    ensure_environment()
    client = AcessoriasClient()
    session = get_session()
    fetched: List[Dict[str, Any]] = []

    try:
        page = 1
        while True:
            batch = client.list_companies_obligations(page=page, per_page=page_size)
            if not batch:
                break
            for row in batch:
                if isinstance(row, dict):
                    row.setdefault(
                        "empresa",
                        row.get("EmpNome")
                        or row.get("Razao")
                        or row.get("RazaoSocial")
                        or row.get("Nome"),
                    )
                    row.setdefault("cnpj", row.get("CNPJ") or row.get("EmpCNPJ"))
                    counters = payload_counters(row)
                    if counters:
                        row["counters"] = counters
                upsert_company(session, row)
                fetched.append(dict(row) if isinstance(row, dict) else row)
            session.commit()
            log("pipeline", "INFO", "companies_page", page=page, count=len(batch))
            if len(batch) < page_size:
                break
            page += 1
            time.sleep(client.sleep_seconds)

        _write_json(FILES["companies"], fetched)
        return fetched
    finally:
        session.close()


def _load_rules() -> List[Dict[str, Any]]:
    if not RULES_PATH.exists():
        return []
    try:
        data = json.loads(RULES_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data.get("matchers", []) or []
        return []
    except Exception:
        return []


def _match_rule(name: str, rules: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    low = (name or "").lower()
    for rule in rules:
        needle = (rule.get("contains") or "").lower()
        if needle and needle in low:
            return rule
    return None


def _to_date_iso(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        if "T" in value:
            return value[:10]
        if " " in value:
            return datetime.strptime(value, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d")
        if "/" in value:
            return datetime.strptime(value, "%d/%m/%Y").strftime("%Y-%m-%d")
        if len(value) >= 10:
            return value[:10]
    except ValueError:
        return None
    return None


def _competence_from_date(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    return value[:7]


def _flatten_process_events(proc: Process, rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    raw = proc.raw or {}
    passos = raw.get("ProcPassos") or []
    empresa = raw.get("EmpNome") or (proc.company.nome if proc.company else None)
    cnpj = raw.get("EmpCNPJ") or (proc.company.cnpj if proc.company else None)
    regime = raw.get("ProcDepartamento") or raw.get("Departamento")
    proc_id = raw.get("ProcID") or proc.id_acessorias

    events: List[Dict[str, Any]] = []

    def walk(items: Iterable[Dict[str, Any]], parent: str = ""):
        for item in items:
            nome = item.get("Nome") or item.get("Descricao") or parent
            autom = item.get("Automacao") or item.get("AutomacaoEntrega") or {}
            entrega = autom.get("Entrega") or {}
            prazo = entrega.get("Prazo") or entrega.get("EntregaPrazo")
            responsavel = entrega.get("Responsavel") or autom.get("Responsavel")
            nome_entrega = entrega.get("Nome") or ""
            label = nome_entrega and f"{nome} | {nome_entrega}" or nome
            rule = _match_rule(label, rules)
            if rule:
                prazo_iso = _to_date_iso(prazo)
                data_evento = _to_date_iso(raw.get("ProcConclusao") or raw.get("ProcInicio"))
                events.append(
                    {
                        "source": "process",
                        "proc_id": proc_id,
                        "empresa": empresa,
                        "cnpj": cnpj,
                        "categoria": rule.get("categoria"),
                        "subtipo": rule.get("subtipo"),
                        "status": rule.get("status"),
                        "responsavel": responsavel,
                        "regime": regime,
                        "competencia": _competence_from_date(prazo_iso) or _competence_from_date(data_evento),
                        "data_evento": data_evento,
                        "prazo": prazo_iso,
                    }
                )
            sub = item.get("ProcPassos") or []
            if isinstance(sub, list) and sub:
                walk(sub, nome)

    if isinstance(passos, list):
        walk(passos)
    return events


def _delivery_to_event(delivery: Delivery) -> Dict[str, Any]:
    payload = delivery.payload or {}
    empresa = delivery.company.nome if delivery.company else payload.get("Empresa")
    cnpj = delivery.company.cnpj if delivery.company else payload.get("CNPJ")
    subtipo = (
        payload.get("Obrigacao")
        or payload.get("Descricao")
        or payload.get("Nome")
        or delivery.tipo
    )
    prazo = _to_date_iso(payload.get("EntDtPrazo") or payload.get("Prazo") or (delivery.dt_prazo.isoformat() if delivery.dt_prazo else None))
    entrega = _to_date_iso(payload.get("EntDtEntrega") or (delivery.dt_entrega.isoformat() if delivery.dt_entrega else None))
    atraso = _to_date_iso(payload.get("EntDtAtraso"))
    status_text = str(
        payload.get("EntStatus")
        or payload.get("Status")
        or delivery.situacao
        or ""
    ).lower()

    if entrega:
        status = "Entregue"
    elif "disp" in status_text:
        status = "Dispensada"
    elif "atras" in status_text or atraso:
        status = "Atrasada"
    elif "obrig" in status_text:
        status = "Obrigatória"
    else:
        status = status_text.title() if status_text else "Pendente"

    categoria = (delivery.tipo or "").lower()
    if "reinf" in categoria:
        categoria = "efd_reinf"
    elif "contrib" in categoria:
        categoria = "efd_contrib"
    elif "difal" in categoria:
        categoria = "difal"
    else:
        categoria = categoria or "outros"

    return {
        "source": "delivery",
        "proc_id": payload.get("ProcID"),
        "empresa": empresa,
        "cnpj": cnpj,
        "categoria": categoria,
        "subtipo": subtipo,
        "status": status,
        "responsavel": payload.get("Responsavel") or delivery.responsavel,
        "regime": payload.get("Regime"),
        "competencia": payload.get("Competencia") or delivery.competencia or _competence_from_date(prazo),
        "data_evento": _to_date_iso(payload.get("EntDtEvento") or (delivery.dt_evento.isoformat() if delivery.dt_evento else None)),
        "prazo": prazo,
        "entrega": entrega,
    }


def _process_events_from_process(proc: Process) -> Iterable[Dict[str, Any]]:
    return []


def _process_events_from_delivery(delivery: Delivery) -> Dict[str, Any]:
    return {}


def build_events() -> List[Dict[str, Any]]:
    ensure_environment()
    session = get_session()
    try:
        clear_events(session)
        session.commit()

        rules = _load_rules()
        serialized: List[Dict[str, Any]] = []

        processes = session.query(Process).all()
        for proc in processes:
            events = _flatten_process_events(proc, rules)
            for evt in events:
                dt = parse_datetime(evt.get("data_evento") or evt.get("prazo"))
                upsert_event(
                    session,
                    process=proc,
                    company=proc.company,
                    delivery=None,
                    tipo=evt.get("categoria") or "process",
                    dt=dt,
                    payload=evt,
                    referencia=evt.get("subtipo"),
                    processo_status=proc.status,
                )
                serialized.append(evt)
        session.commit()

        deliveries = session.query(Delivery).all()
        for delivery in deliveries:
            evt = _delivery_to_event(delivery)
            dt = parse_datetime(evt.get("data_evento") or evt.get("prazo"))
            upsert_event(
                session,
                process=None,
                company=delivery.company,
                delivery=delivery,
                tipo=evt.get("categoria") or "delivery",
                dt=dt,
                payload=evt,
                referencia=evt.get("subtipo"),
            )
            serialized.append(evt)
        session.commit()

        _write_json(FILES["events"], serialized)
        return serialized
    finally:
        session.close()


def _serialize_process(proc: Process) -> Dict[str, Any]:
    def _iso(dt: Optional[datetime]) -> Optional[str]:
        return dt.isoformat() if dt else None

    inicio = proc.dt_inicio
    conclusao = proc.dt_conclusao
    last_update = proc.ultimo_evento or getattr(proc, "updated_at", None)

    if inicio and conclusao:
        dias_corridos = max((conclusao - inicio).days, 0)
    elif inicio:
        dias_corridos = max((datetime.now(timezone.utc) - inicio).days, 0)
    else:
        dias_corridos = None

    return {
        "proc_id": str(proc.id_acessorias or proc.id),
        "empresa": proc.company.nome if proc.company else None,
        "cnpj": proc.company.cnpj if proc.company else None,
        "inicio": _iso(inicio),
        "conclusao": _iso(conclusao),
        "prev_conclusao": _iso(proc.dt_prev_conclusao),
        "dias_corridos": dias_corridos,
        "status": proc.status,
        "gestor": proc.gestor,
        "departamento": proc.departamento,
        "titulo": proc.titulo,
        "ultimo_update": _iso(last_update),
        "prioridade": proc.prioridade,
        "progresso": proc.progresso,
        "empresa_id": proc.empresa_id,
        "raw": proc.raw,
    }


def _serialize_delivery(delivery: Delivery) -> Dict[str, Any]:
    return {
        "id": delivery.id,
        "id_acessorias": delivery.id_acessorias,
        "empresa_id": delivery.empresa_id,
        "empresa": delivery.company.nome if delivery.company else None,
        "cnpj": delivery.company.cnpj if delivery.company else None,
        "tipo": delivery.tipo,
        "situacao": delivery.situacao,
        "competencia": delivery.competencia,
        "dt_evento": delivery.dt_evento.isoformat() if delivery.dt_evento else None,
        "dt_prazo": delivery.dt_prazo.isoformat() if delivery.dt_prazo else None,
        "dt_entrega": delivery.dt_entrega.isoformat() if delivery.dt_entrega else None,
        "responsavel": delivery.responsavel,
    }


def _serialize_company(company: Company) -> Dict[str, Any]:
    return {
        "id": company.id,
        "id_acessorias": company.id_acessorias,
        "cnpj": company.cnpj,
        "nome": company.nome,
        "nome_fantasia": company.nome_fantasia,
        "email": company.email,
        "telefone": company.telefone,
        "cidade": company.cidade,
        "uf": company.uf,
        "counters": company_counters(company),
        "raw": company.dados,
    }


def compute_kpis() -> Dict[str, Any]:
    ensure_environment()
    session = get_session()
    try:
        processes = session.query(Process).all()
        deliveries = session.query(Delivery).all()
        companies = session.query(Company).all()

        serialized_processes = [_serialize_process(proc) for proc in processes]
        serialized_deliveries = [_serialize_delivery(delivery) for delivery in deliveries]
        serialized_companies = [_serialize_company(company) for company in companies]

        _write_json(FILES["processes"], serialized_processes)
        _write_json(FILES["deliveries"], serialized_deliveries)
        _write_json(FILES["companies"], serialized_companies)

        process_status = Counter(proc.status or "Sem status" for proc in processes)
        deliveries_status = Counter(delivery.situacao or "Sem status" for delivery in deliveries)
        deliveries_tipo = Counter(delivery.tipo or "Sem tipo" for delivery in deliveries)

        concluido_hoje = sum(
            1
            for proc in processes
            if proc.dt_conclusao and proc.dt_conclusao.date() == datetime.now(timezone.utc).date()
        )

        concluidos_mes = sum(
            1
            for proc in processes
            if proc.dt_conclusao
            and proc.dt_conclusao.year == datetime.now(timezone.utc).year
            and proc.dt_conclusao.month == datetime.now(timezone.utc).month
        )

        dias_fechamento = [proc.dt_conclusao.day for proc in processes if proc.dt_conclusao]

        kpis = {
            "processos_total": len(processes),
            "processos_por_status": dict(process_status),
            "concluidos_no_mes": concluidos_mes,
            "concluidos_hoje": concluido_hoje,
            "deliveries_por_status": dict(deliveries_status),
            "deliveries_por_tipo": dict(deliveries_tipo),
            "empresas": len(companies),
            "fechamento": {
                "media": round(mean(dias_fechamento), 2) if dias_fechamento else None,
                "mediana": median(dias_fechamento) if dias_fechamento else None,
                "n": len(dias_fechamento),
            },
        }

        alerts = []
        now = datetime.now(timezone.utc)
        for delivery in deliveries:
            if delivery.dt_prazo and delivery.dt_prazo < now and not delivery.dt_entrega:
                alerts.append(
                    {
                        "tipo": "obrigacao_atrasada",
                        "empresa": delivery.company.nome if delivery.company else None,
                        "cnpj": delivery.company.cnpj if delivery.company else None,
                        "obrigacao": delivery.tipo,
                        "competencia": delivery.competencia,
                        "prazo": delivery.dt_prazo.isoformat(),
                    }
                )

        for proc in processes:
            if proc.status and proc.status.upper().startswith("C"):
                continue
            if proc.dt_prev_conclusao and proc.dt_prev_conclusao < now:
                alerts.append(
                    {
                        "tipo": "processo_atrasado",
                        "processo": proc.titulo,
                        "empresa": proc.company.nome if proc.company else None,
                        "gestor": proc.gestor,
                        "previsto": proc.dt_prev_conclusao.isoformat(),
                    }
                )

        reinf_series: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        efd_series: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        difal_series: Dict[str, int] = defaultdict(int)

        for delivery in deliveries:
            competencia = delivery.competencia or "Sem competência"
            status = delivery.situacao or "Sem status"
            tipo = (delivery.tipo or "").upper()
            if "REINF" in tipo:
                reinf_series[competencia][status] += 1
            elif "EFD" in tipo:
                efd_series[competencia][status] += 1
            elif "DIFAL" in tipo:
                difal_series[status] += 1

        states = session.query(Event).all()
        meta = {
            "last_sync": datetime.now(timezone.utc).isoformat(),
            "events": len(states),
        }

        reinf_payload = {competencia: dict(values) for competencia, values in reinf_series.items()}
        efd_payload = {competencia: dict(values) for competencia, values in efd_series.items()}
        difal_payload = dict(difal_series)

        snapshot = {
            "kpis": kpis,
            "alerts": alerts,
            "meta": meta,
            "reinf": reinf_payload,
            "efd": efd_payload,
            "difal": difal_payload,
        }

        _write_json(FILES["kpis"], snapshot)
        _write_json(FILES["alerts"], alerts)
        _write_json(FILES["fechamento"], kpis.get("fechamento", {}))
        _write_json(FILES["reinf"], reinf_payload)
        _write_json(FILES["efd"], efd_payload)
        _write_json(FILES["difal"], difal_payload)
        _write_json(FILES["meta"], meta)

        return snapshot
    finally:
        session.close()


def run_pipeline(
    *,
    full: bool = False,
    statuses: Optional[List[str]] = None,
    page_size: int = 100,
    reset_sync: bool = False,
    months_history: int = 6,
    dt_from: Optional[date] = None,
) -> Dict[str, Any]:
    with PIPELINE_LOCK:
        log(
            "pipeline",
            "INFO",
            "run_start",
            full=full,
            statuses=statuses,
            reset_sync=reset_sync,
            months_history=months_history,
        )
        processes = collect_processes(
            statuses=statuses,
            full=full,
            page_size=page_size,
            reset_sync=reset_sync,
            dt_from=dt_from,
        )
        deliveries = collect_deliveries(
            full=full,
            months_history=months_history,
            page_size=page_size,
            reset_sync=reset_sync,
        )
        companies = collect_companies()
        events = build_events()
        metrics = compute_kpis()
        log(
            "pipeline",
            "INFO",
            "run_complete",
            processes=len(processes),
            deliveries=len(deliveries),
            companies=len(companies),
            events=len(events),
        )
        return {
            "processes": len(processes),
            "deliveries": len(deliveries),
            "companies": len(companies),
            "events": len(events),
            "metrics": metrics,
        }


def trigger_refresh(
    *,
    full: bool = False,
    statuses: Optional[List[str]] = None,
    page_size: int = 100,
    reset_sync: bool = False,
    months_history: int = 6,
    dt_from: Optional[date] = None,
) -> bool:
    if PIPELINE_LOCK.locked():
        return False

    def _runner() -> None:
        try:
            run_pipeline(
                full=full,
                statuses=statuses,
                page_size=page_size,
                reset_sync=reset_sync,
                months_history=months_history,
                dt_from=dt_from,
            )
        except Exception as exc:  # pragma: no cover - apenas logging
            PIPELINE_LOG.exception("Falha ao executar refresh", exc_info=exc)

    thread = threading.Thread(target=_runner, name="pipeline-refresh", daemon=True)
    thread.start()
    return True

