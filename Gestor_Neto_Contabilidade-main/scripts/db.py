"""Database layer for the Gestor Neto Contabilidade project."""
from __future__ import annotations

import hashlib
import os
from contextlib import contextmanager
from datetime import datetime
from typing import Dict, Iterable, Iterator, Optional

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    event,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

Base = declarative_base()


def _clean_digits(value: Optional[str]) -> str:
    if not value:
        return ""
    return "".join(ch for ch in value if ch.isdigit())


def _now() -> datetime:
    return datetime.utcnow().replace(microsecond=0)


def get_database_url() -> str:
    return os.getenv("DB_URL", "sqlite:///data/econtrole.db")


def _build_engine() -> Engine:
    url = get_database_url()
    connect_args = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    engine = create_engine(url, future=True, echo=False, connect_args=connect_args)

    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, connection_record):  # type: ignore
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

    return engine


engine = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)


class Company(Base):
    __tablename__ = "companies"

    id = Column(String, primary_key=True)
    nome = Column(String, nullable=False, default="")
    cnpj = Column(String, nullable=False, default="")
    updated_at = Column(DateTime)
    detalhes = Column(Text)

    __table_args__ = (Index("ix_companies_cnpj", "cnpj"),)


class Process(Base):
    __tablename__ = "processes"

    proc_id = Column(String, primary_key=True)
    titulo = Column(String)
    status = Column(String)
    inicio = Column(DateTime)
    conclusao = Column(DateTime)
    gestor = Column(String)
    dias_corridos = Column(Integer)
    company_id = Column(String, ForeignKey("companies.id"))
    last_dh = Column(DateTime)
    updated_at = Column(DateTime)
    raw_payload = Column(Text)

    company = relationship("Company")


class Delivery(Base):
    __tablename__ = "deliveries"

    id = Column(String, primary_key=True)
    company_id = Column(String, ForeignKey("companies.id"))
    nome = Column(String)
    categoria = Column(String)
    subtipo = Column(String)
    status = Column(String)
    competencia = Column(String)
    prazo = Column(DateTime)
    entregue_em = Column(DateTime)
    updated_at = Column(DateTime)
    detalhes = Column(Text)

    __table_args__ = (
        UniqueConstraint("company_id", "nome", "competencia", name="uq_delivery_key"),
        Index("ix_deliveries_cat_comp", "categoria", "competencia"),
    )

    company = relationship("Company")


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except SQLAlchemyError:
        session.rollback()
        raise
    finally:
        session.close()


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def upsert_company(session: Session, payload: Dict[str, str]) -> Company:
    company_id = _clean_digits(
        payload.get("cnpj")
        or payload.get("CNPJ")
        or payload.get("CompanyID")
        or payload.get("Identificador")
        or payload.get("id")
        or ""
    )
    if not company_id:
        raise ValueError("company payload missing CNPJ/ID")

    instance = session.get(Company, company_id)
    if not instance:
        instance = Company(id=company_id)
        session.add(instance)

    name_candidates = [
        payload.get("nome"),
        payload.get("Nome"),
        payload.get("RazaoSocial"),
        payload.get("RazaoSocialEmpresa"),
        payload.get("CompanyName"),
        payload.get("razao_social"),
        payload.get("Fantasia"),
    ]
    for candidate in name_candidates:
        if candidate:
            instance.nome = candidate
            break
    instance.cnpj = company_id
    instance.updated_at = _now()
    instance.detalhes = json_dumps(payload)
    return instance


def _process_status_label(payload: Dict[str, str]) -> Optional[str]:
    if payload.get("ProcStatusDesc"):
        return payload["ProcStatusDesc"]
    if payload.get("ProcStatusLabel"):
        return payload["ProcStatusLabel"]
    code = payload.get("ProcStatus")
    if not isinstance(code, str):
        return payload.get("status")
    mapping = {
        "A": "Em andamento",
        "C": "Concluído",
        "D": "Devolvido",
        "P": "Pendente",
        "S": "Suspenso",
        "W": "Em espera",
        "X": "Cancelado",
    }
    return mapping.get(code.upper(), code)


def upsert_process(session: Session, payload: Dict[str, str]) -> Process:
    proc_id = str(payload.get("ProcID") or payload.get("proc_id") or payload.get("id") or "").strip()
    if not proc_id:
        raise ValueError("process payload missing ProcID")

    instance = session.get(Process, proc_id)
    if not instance:
        instance = Process(proc_id=proc_id)
        session.add(instance)

    instance.titulo = payload.get("ProcNome") or payload.get("titulo") or payload.get("ProcTitulo")
    instance.status = _process_status_label(payload)
    instance.inicio = _parse_datetime(payload.get("ProcInicio") or payload.get("ProcDtInicio"))
    instance.conclusao = _parse_datetime(payload.get("ProcConclusao") or payload.get("ProcDtConclusao"))
    instance.gestor = payload.get("ProcGestor") or payload.get("gestor")

    try:
        instance.dias_corridos = int(payload.get("ProcDiasCorridos") or payload.get("dias_corridos") or 0)
    except (TypeError, ValueError):
        instance.dias_corridos = None  # type: ignore[assignment]

    company_keys = [
        "ProcEmpresaId",
        "ProcEmpresaCNPJ",
        "EmpresaCNPJ",
        "CNPJ",
    ]
    for key in company_keys:
        if payload.get(key):
            company_id = _clean_digits(str(payload.get(key)))
            if company_id:
                instance.company_id = company_id
                break

    instance.last_dh = _parse_datetime(payload.get("DtLastDH") or payload.get("last_dh"))
    instance.updated_at = _now()
    instance.raw_payload = json_dumps(payload)
    return instance


def _normalize_status(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    mapping = {
        "OBRIGATORIA": "Obrigatória",
        "OBRIGATÓRIA": "Obrigatória",
        "DISPENSADA": "Dispensada",
        "PENDENTE": "Pendente",
    }
    upper = value.upper()
    return mapping.get(upper, value)


def _categorize_delivery(name: str) -> (Optional[str], Optional[str]):
    lower = name.lower()
    categoria = None
    subtipo = None
    if "reinf" in lower:
        categoria = "efd_reinf"
    elif "efd contrib" in lower or "efdcontrib" in lower:
        categoria = "efd_contrib"
    elif "difal" in lower:
        categoria = "difal"
        if "consumo" in lower or "imobilizado" in lower:
            subtipo = "consumo_imobilizado"
        elif "comercial" in lower:
            subtipo = "comercializacao"
        elif "ambos" in lower:
            subtipo = "ambos"
    return categoria, subtipo


def _delivery_id(company_id: str, nome: str, competencia: str) -> str:
    base = f"{company_id}|{nome}|{competencia}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()


def json_dumps(data: Dict[str, str]) -> str:
    import json

    return json.dumps(data, ensure_ascii=False, sort_keys=True)


def upsert_delivery(session: Session, payload: Dict[str, str]) -> Delivery:
    company_raw = payload.get("CNPJ") or payload.get("company_id") or ""
    company_id = _clean_digits(company_raw)
    nome = payload.get("Nome") or payload.get("nome") or ""
    competencia = payload.get("Competencia") or payload.get("competencia") or ""

    if not (company_id and nome and competencia):
        raise ValueError("delivery payload missing key identifiers")

    competencia_norm = competencia
    if len(competencia) == 7 and competencia.count("-") == 1:
        competencia_norm = competencia
    elif len(competencia) == 6 and competencia.isdigit():
        competencia_norm = f"{competencia[:4]}-{competencia[4:]}"

    delivery_id = _delivery_id(company_id, nome, competencia_norm)

    instance = session.get(Delivery, delivery_id)
    if not instance:
        instance = Delivery(id=delivery_id)
        session.add(instance)

    categoria, subtipo = _categorize_delivery(nome)
    instance.company_id = company_id
    instance.nome = nome
    instance.categoria = categoria
    instance.subtipo = subtipo
    instance.status = _normalize_status(payload.get("Status") or payload.get("status"))
    instance.competencia = competencia_norm
    instance.prazo = _parse_datetime(payload.get("Prazo") or payload.get("prazo"))
    instance.entregue_em = _parse_datetime(payload.get("EntregueEm") or payload.get("entregue_em"))
    instance.updated_at = _now()
    instance.detalhes = json_dumps(payload)
    return instance


def upsert_companies(session: Session, rows: Iterable[Dict[str, str]]) -> int:
    count = 0
    for row in rows:
        upsert_company(session, row)
        count += 1
    return count


def upsert_processes(session: Session, rows: Iterable[Dict[str, str]]) -> int:
    count = 0
    for row in rows:
        upsert_process(session, row)
        count += 1
    return count


def upsert_deliveries(session: Session, rows: Iterable[Dict[str, str]]) -> int:
    count = 0
    for row in rows:
        upsert_delivery(session, row)
        count += 1
    return count
