"""FastAPI server exposing persisted data to the frontend."""
from __future__ import annotations

import json
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from scripts.db import Company, Delivery, Process, SessionLocal, init_db
from scripts.fuse_sources import merge_events

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

app = FastAPI(title="Gestor Neto API")


def get_session() -> Generator[Session, None, None]:
    init_db()
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Data inválida: {value}") from exc


def process_to_dict(process: Process) -> dict:
    return {
        "proc_id": process.proc_id,
        "titulo": process.titulo,
        "status": process.status,
        "inicio": process.inicio.isoformat() if process.inicio else None,
        "conclusao": process.conclusao.isoformat() if process.conclusao else None,
        "dias_corridos": process.dias_corridos,
        "gestor": process.gestor,
        "company_id": process.company_id,
        "last_dh": process.last_dh.isoformat() if process.last_dh else None,
    }


def delivery_to_dict(delivery: Delivery) -> dict:
    return {
        "id": delivery.id,
        "company_id": delivery.company_id,
        "nome": delivery.nome,
        "categoria": delivery.categoria,
        "subtipo": delivery.subtipo,
        "status": delivery.status,
        "competencia": delivery.competencia,
        "prazo": delivery.prazo.isoformat() if delivery.prazo else None,
        "entregue_em": delivery.entregue_em.isoformat() if delivery.entregue_em else None,
    }


def _parse_company_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _classify_obligation(record: Dict[str, Any], today: datetime) -> str:
    status_text = "".join(str(record.get(field, "")) for field in ("Status", "status", "EntStatus", "situacao")).lower()
    if "entreg" in status_text:
        return "entregues"
    if record.get("Entrega") or record.get("EntDtEntrega"):
        return "entregues"
    due = None
    for field in ("Prazo", "prazo", "EntDtPrazo", "DataPrazo"):
        due = _parse_company_date(record.get(field))
        if due:
            break
    if due:
        if due.date() < today.date():
            return "atrasadas"
        if due.date() <= (today + timedelta(days=30)).date():
            return "proximos30"
        return "futuras30"
    return "futuras30"


def company_counters_from_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    obligations = payload.get("Obligations") or payload.get("obligations") or []
    if not isinstance(obligations, list):
        return {"totals": {}, "by_tipo": {}}
    today = datetime.now()
    totals = defaultdict(int)
    by_tipo: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for item in obligations:
        if not isinstance(item, dict):
            continue
        bucket = _classify_obligation(item, today)
        tipo = (
            item.get("Tipo")
            or item.get("tipo")
            or item.get("Obligation")
            or item.get("obrigacao")
            or item.get("Descricao")
            or item.get("descricao")
            or "Geral"
        )
        totals[bucket] += 1
        by_tipo[tipo][bucket] += 1
    return {
        "totals": dict(totals),
        "by_tipo": {tipo: dict(counts) for tipo, counts in by_tipo.items()},
    }


@app.get("/api/processes")
def api_processes(
    status: Optional[str] = Query(default=None),
    pagina: int = Query(default=1, ge=1),
    limite: int = Query(default=100, ge=1, le=1000),
    empresa: Optional[str] = Query(default=None),
    desde: Optional[str] = Query(default=None),
    ate: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
):
    query = session.query(Process)
    if status:
        query = query.filter(Process.status.ilike(f"%{status}%"))
    if empresa:
        query = query.join(Company, Company.id == Process.company_id, isouter=True).filter(
            Company.nome.ilike(f"%{empresa}%")
        )
    since_dt = parse_date(desde)
    until_dt = parse_date(ate)
    if since_dt:
        query = query.filter(Process.conclusao >= since_dt)
    if until_dt:
        query = query.filter(Process.conclusao <= until_dt)

    total = query.count()
    items = (
        query.order_by(Process.conclusao.desc().nullslast())
        .offset((pagina - 1) * limite)
        .limit(limite)
        .all()
    )

    return {
        "pagina": pagina,
        "limite": limite,
        "total": total,
        "items": [process_to_dict(item) for item in items],
    }


@app.get("/api/companies")
def api_companies(session: Session = Depends(get_session)):
    records = session.query(Company).order_by(Company.nome.asc()).all()
    return [
        {
            "id": company.id,
            "nome": company.nome,
            "cnpj": company.cnpj,
            "updated_at": company.updated_at.isoformat() if company.updated_at else None,
            "counters": company_counters_from_payload(json.loads(company.detalhes)) if company.detalhes else {},
        }
        for company in records
    ]


@app.get("/api/deliveries")
def api_deliveries(
    from_date: Optional[str] = Query(default=None, alias="from"),
    to_date: Optional[str] = Query(default=None, alias="to"),
    cnpj: Optional[str] = Query(default=None),
    categoria: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    pagina: int = Query(default=1, ge=1),
    limite: int = Query(default=100, ge=1, le=1000),
    session: Session = Depends(get_session),
):
    query = session.query(Delivery)
    if cnpj:
        query = query.filter(Delivery.company_id == "".join(ch for ch in cnpj if ch.isdigit()))
    if categoria:
        query = query.filter(Delivery.categoria == categoria)
    if status:
        query = query.filter(Delivery.status.ilike(f"%{status}%"))
    start = parse_date(from_date)
    end = parse_date(to_date)
    if start:
        query = query.filter(Delivery.prazo >= start)
    if end:
        query = query.filter(Delivery.prazo <= end)

    total = query.count()
    items = (
        query.order_by(Delivery.prazo.desc().nullslast())
        .offset((pagina - 1) * limite)
        .limit(limite)
        .all()
    )

    return {
        "pagina": pagina,
        "limite": limite,
        "total": total,
        "items": [delivery_to_dict(item) for item in items],
    }


@app.get("/api/kpis")
def api_kpis():
    path = DATA / "kpis.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/events")
def api_events():
    events, divergences = merge_events()
    return {"events": events, "divergences": divergences}


def run_sync_pipeline() -> None:
    commands: List[List[str]] = [
        [sys.executable, "-m", "scripts.fetch_api", "--full"],
        [sys.executable, "-m", "scripts.fetch_deliveries"],
        [sys.executable, "-m", "scripts.fetch_companies"],
        [sys.executable, "-m", "scripts.flatten_steps"],
        [sys.executable, "-m", "scripts.fuse_sources"],
        [sys.executable, "-m", "scripts.build_processes_kpis_alerts"],
    ]
    # CODEx: sincronização executada em background para não bloquear o servidor.
    for cmd in commands:
        subprocess.run(cmd, check=True)


@app.post("/api/sync")
def api_sync(background: BackgroundTasks):
    background.add_task(run_sync_pipeline)
    return JSONResponse({"status": "accepted"})


app.mount("/web", StaticFiles(directory=str(ROOT / "web"), html=True), name="web")
