"""Database models and helper functions for the Gestor pipeline."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from dateutil import parser as date_parser

from dotenv import load_dotenv
from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    create_engine,
    event,
    func,
    select,
)
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)

from scripts.utils.logger import get_logger

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "gestor.db"

load_dotenv(dotenv_path=ROOT / ".env", override=True)

LOG = get_logger("db")


class Base(DeclarativeBase):
    """Base declarativa com suporte ao SQLAlchemy 2.0."""


class TimestampMixin:
    """Mixin para carimbos de criação/atualização."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Company(TimestampMixin, Base):
    """Empresa cadastrada na Acessórias."""

    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_acessorias: Mapped[Optional[int]] = mapped_column(Integer, index=True, unique=True)
    cnpj: Mapped[str] = mapped_column(String(14), unique=True, index=True)
    nome: Mapped[str] = mapped_column(String(255))
    nome_fantasia: Mapped[Optional[str]] = mapped_column(String(255))
    email: Mapped[Optional[str]] = mapped_column(String(255))
    telefone: Mapped[Optional[str]] = mapped_column(String(50))
    cidade: Mapped[Optional[str]] = mapped_column(String(120))
    uf: Mapped[Optional[str]] = mapped_column(String(2))
    dados: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)

    processes: Mapped[list["Process"]] = relationship(
        back_populates="company", cascade="all, delete-orphan"
    )
    deliveries: Mapped[list["Delivery"]] = relationship(
        back_populates="company", cascade="all, delete-orphan"
    )


class Process(TimestampMixin, Base):
    """Processo operacional."""

    __tablename__ = "processes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_acessorias: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    empresa_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    titulo: Mapped[Optional[str]] = mapped_column(String(255))
    status: Mapped[Optional[str]] = mapped_column(String(60), index=True)
    departamento: Mapped[Optional[str]] = mapped_column(String(120))
    dt_inicio: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    dt_prev_conclusao: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )
    dt_conclusao: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    gestor: Mapped[Optional[str]] = mapped_column(String(120))
    progresso: Mapped[Optional[float]] = mapped_column(Float)
    prioridade: Mapped[Optional[str]] = mapped_column(String(60))
    ultimo_evento: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    raw: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)

    company: Mapped[Company] = relationship(back_populates="processes")
    events: Mapped[list["Event"]] = relationship(
        back_populates="process", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_process_status_empresa", "status", "empresa_id"),)


class Delivery(TimestampMixin, Base):
    """Obrigação/entrega associada a uma empresa."""

    __tablename__ = "deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_acessorias: Mapped[Optional[int]] = mapped_column(Integer, unique=True)
    empresa_id: Mapped[int] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), index=True
    )
    competencia: Mapped[Optional[str]] = mapped_column(String(7), index=True)
    tipo: Mapped[Optional[str]] = mapped_column(String(120))
    situacao: Mapped[Optional[str]] = mapped_column(String(120), index=True)
    dt_evento: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    dt_prazo: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    dt_entrega: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    responsavel: Mapped[Optional[str]] = mapped_column(String(120))
    payload: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)

    company: Mapped[Company] = relationship(back_populates="deliveries")

    __table_args__ = (
        UniqueConstraint(
            "empresa_id", "tipo", "competencia", name="uq_delivery_empresa_tipo_comp"
        ),
    )


class SyncState(Base):
    """Controle incremental por endpoint."""

    __tablename__ = "sync_state"

    endpoint: Mapped[str] = mapped_column(String(120), primary_key=True)
    last_sync_dh: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_page: Mapped[Optional[int]] = mapped_column(Integer)
    misc: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Event(TimestampMixin, Base):
    """Eventos derivados dos processos e deliveries para dashboards e KPIs."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    process_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("processes.id", ondelete="CASCADE"), index=True
    )
    empresa_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("companies.id", ondelete="SET NULL"), index=True
    )
    delivery_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("deliveries.id", ondelete="SET NULL"), nullable=True
    )
    tipo: Mapped[str] = mapped_column(String(120))
    dt: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    payload: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON)
    processo_status: Mapped[Optional[str]] = mapped_column(String(60))
    referencia: Mapped[Optional[str]] = mapped_column(String(120))

    process: Mapped[Optional[Process]] = relationship(back_populates="events")
    company: Mapped[Optional[Company]] = relationship()
    delivery: Mapped[Optional[Delivery]] = relationship()


_engine: Optional[Engine] = None
SessionLocal: Optional[sessionmaker[Session]] = None


def _resolve_db_url() -> str:
    from os import getenv

    db_url = getenv("DB_URL")
    if db_url:
        return db_url
    return f"sqlite:///{DB_PATH}"


@event.listens_for(Engine, "connect")
def _sqlite_pragma(dbapi_connection, connection_record) -> None:  # pragma: no cover
    """Configurações adicionais para SQLite."""
    try:
        if hasattr(dbapi_connection, "execute"):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()
    except Exception as exc:  # pragma: no cover - melhor esforço
        LOG.warning("Falha ao aplicar PRAGMA SQLite", exc=str(exc))


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        db_url = _resolve_db_url()
        connect_args = {"check_same_thread": False} if db_url.startswith("sqlite") else {}
        _engine = create_engine(db_url, future=True, pool_pre_ping=True, connect_args=connect_args)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global SessionLocal
    if SessionLocal is None:
        SessionLocal = sessionmaker(bind=get_engine(), class_=Session, expire_on_commit=False, future=True)
    return SessionLocal


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(get_engine())


@contextmanager
def session_scope() -> Iterable[Session]:
    """Context manager para lidar com commits/rollback automaticamente."""

    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Session:
    return get_session_factory()()


def normalize_cnpj(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return digits or None


def parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc)
        parsed = date_parser.parse(str(value))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _as_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _store_raw(entity, payload: Dict[str, Any]) -> None:
    try:
        entity.raw = payload  # type: ignore[attr-defined]
    except Exception:
        try:
            entity.payload = payload  # type: ignore[attr-defined]
        except Exception:
            pass


def upsert_company(session: Session, payload: Dict[str, Any]) -> Company:
    """Insere ou atualiza uma empresa com base no ID do Acessórias ou CNPJ."""

    id_acessorias = _as_int(
        payload.get("EmpresaID")
        or payload.get("EmpID")
        or payload.get("id_acessorias")
        or payload.get("id")
    )
    cnpj = normalize_cnpj(
        payload.get("CNPJ")
        or payload.get("EmpCNPJ")
        or payload.get("cnpj")
        or payload.get("Documento")
    )
    if not cnpj:
        raise ValueError("CNPJ obrigatório para company")

    stmt = select(Company)
    if id_acessorias is not None:
        stmt = stmt.where(Company.id_acessorias == id_acessorias)
        company = session.execute(stmt).scalar_one_or_none()
    else:
        company = None

    if company is None:
        company = session.execute(select(Company).where(Company.cnpj == cnpj)).scalar_one_or_none()

    if company is None:
        company = Company(cnpj=cnpj, nome=str(payload.get("EmpNome") or payload.get("Nome") or ""))
        session.add(company)

    company.id_acessorias = id_acessorias or company.id_acessorias
    company.nome = str(payload.get("EmpNome") or payload.get("Nome") or company.nome or "").strip()
    company.nome_fantasia = (
        payload.get("NomeFantasia")
        or payload.get("fantasia")
        or company.nome_fantasia
    )
    company.email = payload.get("Email") or payload.get("email") or company.email
    company.telefone = payload.get("Telefone") or payload.get("telefone") or company.telefone
    company.cidade = payload.get("Cidade") or payload.get("cidade") or company.cidade
    company.uf = (payload.get("UF") or payload.get("estado") or company.uf or "").upper()[:2] or None
    company.dados = payload

    session.flush()
    return company


def upsert_process(session: Session, payload: Dict[str, Any]) -> Process:
    proc_id = _as_int(payload.get("ProcID") or payload.get("proc_id") or payload.get("id"))
    if proc_id is None:
        raise ValueError("ProcID obrigatório")

    company = upsert_company(session, payload)

    stmt = select(Process).where(Process.id_acessorias == proc_id)
    process = session.execute(stmt).scalar_one_or_none()

    if process is None:
        process = Process(id_acessorias=proc_id, empresa_id=company.id)
        session.add(process)

    process.empresa_id = company.id
    process.titulo = payload.get("ProcNome") or payload.get("titulo") or process.titulo
    process.status = payload.get("ProcStatus") or payload.get("status") or process.status
    process.departamento = (
        payload.get("ProcDepartamento")
        or payload.get("Departamento")
        or process.departamento
    )
    process.dt_inicio = parse_datetime(payload.get("ProcInicio") or payload.get("inicio")) or process.dt_inicio
    process.dt_prev_conclusao = parse_datetime(
        payload.get("ProcPrevisaoConclusao") or payload.get("dt_prev_conclusao")
    ) or process.dt_prev_conclusao
    process.dt_conclusao = parse_datetime(payload.get("ProcConclusao") or payload.get("conclusao")) or process.dt_conclusao
    process.ultimo_evento = parse_datetime(payload.get("DtLastDH") or payload.get("ultimo_evento")) or process.ultimo_evento
    process.gestor = payload.get("ProcGestor") or payload.get("GestorNome") or payload.get("gestor") or process.gestor
    process.progresso = (
        float(payload.get("ProcProgresso") or payload.get("progresso"))
        if payload.get("ProcProgresso") or payload.get("progresso")
        else process.progresso
    )
    process.prioridade = payload.get("ProcPrioridade") or payload.get("prioridade") or process.prioridade
    _store_raw(process, payload)

    session.flush()
    return process


def upsert_delivery(session: Session, payload: Dict[str, Any]) -> Delivery:
    company = upsert_company(session, payload)

    delivery_id = _as_int(
        payload.get("DeliveryID")
        or payload.get("EntID")
        or payload.get("id_acessorias")
        or payload.get("id")
    )

    competencia = (payload.get("Competencia") or payload.get("competencia") or "").strip() or None
    tipo = payload.get("Obrigacao") or payload.get("tipo") or payload.get("Nome")

    stmt = select(Delivery)
    if delivery_id is not None:
        stmt = stmt.where(Delivery.id_acessorias == delivery_id)
        delivery = session.execute(stmt).scalar_one_or_none()
    else:
        delivery = None

    if delivery is None:
        stmt = select(Delivery).where(
            Delivery.empresa_id == company.id,
            Delivery.tipo == tipo,
            Delivery.competencia == competencia,
        )
        delivery = session.execute(stmt).scalar_one_or_none()

    if delivery is None:
        delivery = Delivery(
            empresa_id=company.id,
            id_acessorias=delivery_id,
        )
        session.add(delivery)

    delivery.id_acessorias = delivery_id or delivery.id_acessorias
    delivery.empresa_id = company.id
    delivery.tipo = tipo or delivery.tipo
    delivery.situacao = payload.get("EntStatus") or payload.get("situacao") or payload.get("Status") or delivery.situacao
    delivery.competencia = competencia or delivery.competencia
    delivery.dt_evento = parse_datetime(payload.get("EntDtEvento") or payload.get("dt_evento")) or delivery.dt_evento
    delivery.dt_prazo = parse_datetime(payload.get("EntDtPrazo") or payload.get("prazo")) or delivery.dt_prazo
    delivery.dt_entrega = parse_datetime(payload.get("EntDtEntrega") or payload.get("entrega")) or delivery.dt_entrega
    delivery.responsavel = payload.get("Responsavel") or payload.get("responsavel") or delivery.responsavel
    _store_raw(delivery, payload)

    session.flush()
    return delivery


def upsert_event(
    session: Session,
    *,
    process: Optional[Process],
    company: Optional[Company],
    delivery: Optional[Delivery],
    tipo: str,
    dt: Optional[datetime],
    payload: Dict[str, Any],
    referencia: Optional[str] = None,
    processo_status: Optional[str] = None,
) -> Event:
    event = Event(
        process=process,
        company=company,
        delivery=delivery,
        tipo=tipo,
        dt=dt,
        payload=payload,
        referencia=referencia,
        processo_status=processo_status,
    )
    session.add(event)
    session.flush()
    return event


def bulk_upsert_processes(session: Session, rows: Iterable[Dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        try:
            upsert_process(session, row)
            count += 1
        except Exception as exc:
            LOG.warning("Falha ao upsert process", error=str(exc))
    session.flush()
    return count


def bulk_upsert_deliveries(session: Session, rows: Iterable[Dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        try:
            upsert_delivery(session, row)
            count += 1
        except Exception as exc:
            LOG.warning("Falha ao upsert delivery", error=str(exc))
    session.flush()
    return count


def bulk_upsert_companies(session: Session, rows: Iterable[Dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        try:
            upsert_company(session, row)
            count += 1
        except Exception as exc:
            LOG.warning("Falha ao upsert company", error=str(exc))
    session.flush()
    return count


def clear_events(session: Session) -> None:
    session.query(Event).delete()
    session.flush()


def get_sync_state(session: Session, endpoint: str) -> Optional[SyncState]:
    return session.get(SyncState, endpoint)


def save_sync_state(
    session: Session,
    *,
    endpoint: str,
    last_sync_dh: Optional[datetime],
    last_page: Optional[int] = None,
    misc: Optional[Dict[str, Any]] = None,
) -> SyncState:
    state = session.get(SyncState, endpoint)
    if state is None:
        state = SyncState(endpoint=endpoint)
        session.add(state)

    state.last_sync_dh = last_sync_dh
    state.last_page = last_page
    state.misc = misc
    session.flush()
    return state


def reset_sync_state(session: Session, endpoint: Optional[str] = None) -> None:
    if endpoint:
        obj = session.get(SyncState, endpoint)
        if obj:
            session.delete(obj)
    else:
        session.query(SyncState).delete()
    session.flush()


def ensure_database() -> None:
    try:
        init_db()
    except SQLAlchemyError as exc:
        LOG.error("Erro ao inicializar banco", error=str(exc))
        raise

