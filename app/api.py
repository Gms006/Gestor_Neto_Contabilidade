"""FastAPI application exposing Gestor data sourced from SQLite."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import json
import re

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func
from sqlalchemy.orm import Session

from scripts.db import Company, Delivery, Event, Process, SyncState, get_session
from scripts.pipeline import (
    company_counters,
    compute_kpis,
    ensure_environment,
    trigger_refresh,
)
from scripts.utils.logger import get_logger

LOG = get_logger("api")

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"


def get_db() -> Iterable[Session]:
    session = get_session()
    try:
        yield session
    finally:
        session.close()


def load_fallback(name: str) -> List[Dict[str, Any]]:
    path = DATA_DIR / name
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def serialize_process(proc: Process) -> Dict[str, Any]:
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


def serialize_delivery(delivery: Delivery) -> Dict[str, Any]:
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


def serialize_company(company: Company) -> Dict[str, Any]:
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


def last_sync_metadata(session: Session) -> Optional[str]:
    states = session.query(SyncState).all()
    values = [state.last_sync_dh for state in states if state.last_sync_dh]
    if not values:
        return None
    return max(values).isoformat()


app = FastAPI(title="Gestor Neto Contabilidade API", version="2024.11")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/web", StaticFiles(directory=ROOT / "web", html=True), name="web")


@app.on_event("startup")
async def _startup() -> None:
    ensure_environment()


@app.get("/api/health")
def health(session: Session = Depends(get_db)) -> Dict[str, Any]:
    last_sync = last_sync_metadata(session)
    return {"status": "ok", "last_sync": last_sync}


@app.get("/api/processes")
def processes_endpoint(
    status: Optional[str] = Query(None, description="Filtro ProcStatus"),
    empresa: Optional[str] = Query(None, description="Nome ou CNPJ"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    session: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = session.query(Process).join(Company, isouter=True)

    if status:
        query = query.filter(Process.status.ilike(f"%{status}%"))
    if empresa:
        pattern = f"%{empresa.replace('%', '')}%"
        digits = re.sub(r"\D", "", empresa)
        query = query.filter(
            func.lower(Company.nome).like(func.lower(pattern))
            | (Company.cnpj == digits)
        )
    if date_from:
        query = query.filter(Process.dt_inicio >= date_from)
    if date_to:
        query = query.filter(Process.dt_inicio <= f"{date_to} 23:59:59")

    total = query.count()
    items = (
        query.order_by(Process.dt_inicio.desc().nullslast())
        .offset(offset)
        .limit(limit)
        .all()
    )

    if total == 0 and not any([status, empresa, date_from, date_to]):
        fallback = load_fallback("processes.json")
        return {"items": fallback, "total": len(fallback), "source": "json"}

    return {
        "items": [serialize_process(proc) for proc in items],
        "total": total,
        "source": "db",
    }


@app.get("/api/processes/concluidos")
def processes_concluidos(
    competencia: Optional[str] = Query(None, description="Competência YYYY-MM"),
    session: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = session.query(Process)
    query = query.filter(Process.status.in_(["C", "CONCLUIDO", "CONCLUÍDO", "CONCLUIDO"]))
    if competencia:
        query = query.filter(func.strftime("%Y-%m", Process.dt_conclusao) == competencia)
    items = query.order_by(Process.dt_conclusao.desc().nullslast()).limit(200).all()
    return {
        "items": [serialize_process(proc) for proc in items],
        "total": len(items),
        "source": "db",
    }


@app.get("/api/deliveries")
def deliveries_endpoint(
    empresa: Optional[str] = Query(None, description="Nome ou CNPJ"),
    competencia: Optional[str] = None,
    tipo: Optional[str] = None,
    limit: int = Query(200, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_db),
) -> Dict[str, Any]:
    query = session.query(Delivery).join(Company, isouter=True)
    if empresa:
        pattern = f"%{empresa.replace('%', '')}%"
        digits = re.sub(r"\D", "", empresa)
        query = query.filter(
            func.lower(Company.nome).like(func.lower(pattern))
            | (Company.cnpj == digits)
        )
    if competencia:
        query = query.filter(Delivery.competencia == competencia)
    if tipo:
        query = query.filter(Delivery.tipo.ilike(f"%{tipo}%"))

    total = query.count()
    items = (
        query.order_by(Delivery.dt_prazo.desc().nullslast())
        .offset(offset)
        .limit(limit)
        .all()
    )

    if total == 0 and not any([empresa, competencia, tipo]):
        fallback = load_fallback("deliveries.json")
        return {"items": fallback, "total": len(fallback), "source": "json"}

    return {
        "items": [serialize_delivery(delivery) for delivery in items],
        "total": total,
        "source": "db",
    }


@app.get("/api/companies")
def companies_endpoint(session: Session = Depends(get_db)) -> Dict[str, Any]:
    companies = session.query(Company).order_by(Company.nome.asc()).all()
    if not companies:
        fallback = load_fallback("companies.json")
        return {"items": fallback, "total": len(fallback), "source": "json"}
    return {
        "items": [serialize_company(company) for company in companies],
        "total": len(companies),
        "source": "db",
    }


def serialize_event(event: Event) -> Dict[str, Any]:
    payload = event.payload or {}
    return {
        "proc_id": payload.get("proc_id"),
        "empresa": payload.get("empresa"),
        "cnpj": payload.get("cnpj"),
        "categoria": payload.get("categoria"),
        "subtipo": payload.get("subtipo"),
        "status": payload.get("status"),
        "responsavel": payload.get("responsavel"),
        "regime": payload.get("regime"),
        "competencia": payload.get("competencia"),
        "data_evento": payload.get("data_evento"),
        "prazo": payload.get("prazo"),
        "entrega": payload.get("entrega"),
        "source": payload.get("source") or ("delivery" if event.delivery_id else "process"),
    }


@app.get("/api/events")
def events_endpoint(
    limit: int = Query(2000, ge=1, le=5000),
    session: Session = Depends(get_db),
) -> Dict[str, Any]:
    events = (
        session.query(Event)
        .order_by(Event.dt.desc().nullslast())
        .limit(limit)
        .all()
    )
    if not events:
        fallback = load_fallback("events.json")
        return {"items": fallback, "total": len(fallback), "source": "json"}
    return {
        "items": [serialize_event(evt) for evt in events],
        "total": len(events),
        "source": "db",
    }


@app.get("/api/kpis")
def kpis_endpoint(session: Session = Depends(get_db)) -> Dict[str, Any]:
    processes_total = session.query(func.count(Process.id)).scalar() or 0
    if processes_total == 0:
        snapshot = load_fallback("kpis.json") or {}
        if "kpis" not in snapshot:
            snapshot = {
                "kpis": snapshot,
                "alerts": load_fallback("alerts.json"),
                "meta": load_fallback("meta.json"),
                "reinf": load_fallback("reinf_competencia.json"),
                "efd": load_fallback("efdcontrib_competencia.json"),
                "difal": load_fallback("difal_tipo.json"),
            }
        snapshot["source"] = "json"
        return snapshot

    # Como a contagem é pequena, reusa compute_kpis para manter consistência
    payload = compute_kpis()
    payload["source"] = "db"
    payload["meta"]["last_sync"] = last_sync_metadata(session)
    return payload


@app.post("/api/refresh")
def refresh_endpoint(
    full: bool = False,
    session: Session = Depends(get_db),
) -> JSONResponse:
    _ = session  # manter assinatura compatível para dependency injection
    started = trigger_refresh(full=full)
    if not started:
        raise HTTPException(status_code=409, detail="Uma atualização já está em andamento")
    return JSONResponse(status_code=202, content={"status": "accepted", "full": full})

