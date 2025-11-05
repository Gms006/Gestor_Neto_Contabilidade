# scripts/db.py
"""
Camada de banco de dados com SQLAlchemy.
Define modelos (Company, Process, Delivery) e helpers de upsert.
"""
from __future__ import annotations

import os
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    Column, String, Integer, DateTime, Boolean, Text, ForeignKey,
    UniqueConstraint, Index, create_engine, event
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker, Session
from sqlalchemy.engine import Engine
from dotenv import load_dotenv

# Carrega .env
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env", override=True)

# Base declarativa
Base = declarative_base()

# ============================================================================
# MODELOS
# ============================================================================

class Company(Base):
    """Representa uma empresa (CNPJ)."""
    __tablename__ = "companies"
    
    id = Column(String, primary_key=True)           # CNPJ somente dígitos
    nome = Column(String, nullable=False, default="")
    cnpj = Column(String, nullable=False, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relacionamentos
    processes = relationship("Process", back_populates="company")
    deliveries = relationship("Delivery", back_populates="company")
    
    __table_args__ = (
        Index("ix_companies_cnpj", "cnpj"),
    )


class Process(Base):
    """Representa um processo da API Acessórias."""
    __tablename__ = "processes"
    
    proc_id = Column(String, primary_key=True)      # ProcID único da API
    titulo = Column(String)
    status = Column(String)                         # "Concluído", "Em andamento", etc.
    inicio = Column(DateTime)
    conclusao = Column(DateTime)
    gestor = Column(String)
    dias_corridos = Column(Integer)
    company_id = Column(String, ForeignKey("companies.id"))
    last_dh = Column(DateTime)                      # DtLastDH da API
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Campos adicionais para armazenar dados completos
    raw_data = Column(Text)                         # JSON completo do processo
    
    # Relacionamento
    company = relationship("Company", back_populates="processes")
    
    __table_args__ = (
        Index("ix_processes_status", "status"),
        Index("ix_processes_conclusao", "conclusao"),
        Index("ix_processes_company", "company_id"),
    )


class Delivery(Base):
    """Representa uma obrigação/entrega fiscal."""
    __tablename__ = "deliveries"
    
    # Chave primária: hash de company_id + nome + competencia
    id = Column(String, primary_key=True)
    company_id = Column(String, ForeignKey("companies.id"))
    nome = Column(String)                           # Nome da obrigação
    categoria = Column(String)                      # efd_reinf, efd_contrib, difal, etc.
    subtipo = Column(String)                        # Para DIFAL: comercializacao/consumo_imobilizado/ambos
    status = Column(String)                         # Obrigatória/Dispensada/Pendente/etc.
    competencia = Column(String)                    # "YYYY-MM"
    prazo = Column(DateTime)
    entregue_em = Column(DateTime)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Campos adicionais
    raw_data = Column(Text)                         # JSON completo da delivery
    
    # Relacionamento
    company = relationship("Company", back_populates="deliveries")
    
    __table_args__ = (
        UniqueConstraint("company_id", "nome", "competencia", name="uq_delivery_key"),
        Index("ix_deliveries_cat_comp", "categoria", "competencia"),
        Index("ix_deliveries_company", "company_id"),
    )


# ============================================================================
# ENGINE E SESSION
# ============================================================================

def get_db_url() -> str:
    """Obtém a URL do banco de dados do .env ou usa padrão."""
    db_url = os.getenv("DB_URL", "sqlite:///data/econtrole.db")
    
    # Se for SQLite relativo, resolve o caminho
    if db_url.startswith("sqlite:///") and not db_url.startswith("sqlite:////"):
        # Caminho relativo - resolver a partir da raiz do projeto
        root = Path(__file__).resolve().parents[1]
        db_path = db_url.replace("sqlite:///", "")
        full_path = root / db_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        db_url = f"sqlite:///{full_path}"
    
    return db_url


# Habilitar WAL mode para SQLite (melhor concorrência)
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    """Configura PRAGMA para SQLite."""
    if "sqlite" in str(dbapi_conn.__class__):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


# Engine global
_engine: Optional[Engine] = None
_SessionLocal: Optional[sessionmaker] = None


def get_engine() -> Engine:
    """Retorna o engine do banco de dados (singleton)."""
    global _engine
    if _engine is None:
        db_url = get_db_url()
        _engine = create_engine(
            db_url,
            echo=False,
            pool_pre_ping=True,
            connect_args={"check_same_thread": False} if "sqlite" in db_url else {}
        )
    return _engine


def get_session_local() -> sessionmaker:
    """Retorna o sessionmaker (singleton)."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=get_engine(),
            expire_on_commit=False  # Evita DetachedInstanceError
        )
    return _SessionLocal


def init_db():
    """Inicializa o banco de dados criando todas as tabelas."""
    engine = get_engine()
    Base.metadata.create_all(bind=engine)


def get_session() -> Session:
    """Retorna uma nova sessão do banco de dados."""
    SessionLocal = get_session_local()
    return SessionLocal()


# ============================================================================
# HELPERS DE UPSERT
# ============================================================================

def normalize_cnpj(cnpj: Optional[str]) -> str:
    """Normaliza CNPJ para apenas dígitos."""
    if not cnpj:
        return ""
    return "".join(c for c in str(cnpj) if c.isdigit())


def generate_delivery_id(company_id: str, nome: str, competencia: str) -> str:
    """Gera ID único para delivery baseado em hash SHA1."""
    key = f"{company_id}|{nome}|{competencia}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def upsert_company(session: Session, data: Dict[str, Any]) -> Company:
    """
    Insere ou atualiza uma empresa.
    
    Args:
        session: Sessão do SQLAlchemy
        data: Dicionário com dados da empresa (deve conter 'cnpj' ou 'id')
    
    Returns:
        Instância de Company
    """
    cnpj = normalize_cnpj(data.get("cnpj") or data.get("CNPJ") or data.get("id"))
    if not cnpj:
        raise ValueError("CNPJ não fornecido para upsert_company")
    
    company = session.query(Company).filter_by(id=cnpj).first()
    
    if company:
        # Atualizar
        company.nome = data.get("nome") or data.get("Nome") or company.nome
        company.cnpj = cnpj
        company.updated_at = datetime.utcnow()
    else:
        # Inserir
        company = Company(
            id=cnpj,
            nome=data.get("nome") or data.get("Nome") or "",
            cnpj=cnpj,
            updated_at=datetime.utcnow()
        )
        session.add(company)
    
    return company


def upsert_process(session: Session, data: Dict[str, Any]) -> Process:
    """
    Insere ou atualiza um processo.
    
    Args:
        session: Sessão do SQLAlchemy
        data: Dicionário com dados do processo (deve conter 'proc_id' ou 'ProcID')
    
    Returns:
        Instância de Process
    """
    import json
    from dateutil import parser as date_parser
    
    proc_id = data.get("proc_id") or data.get("ProcID")
    if not proc_id:
        raise ValueError("proc_id não fornecido para upsert_process")
    
    process = session.query(Process).filter_by(proc_id=proc_id).first()
    
    # Parsear datas
    def parse_date(value):
        if not value:
            return None
        if isinstance(value, datetime):
            return value
        try:
            return date_parser.parse(value)
        except:
            return None
    
    inicio = parse_date(data.get("inicio") or data.get("ProcInicio"))
    conclusao = parse_date(data.get("conclusao") or data.get("ProcConclusao"))
    last_dh = parse_date(data.get("last_dh") or data.get("DtLastDH"))
    
    # Company ID
    company_cnpj = normalize_cnpj(
        data.get("company_id") or 
        data.get("cnpj") or 
        data.get("CNPJ") or 
        data.get("EmpCNPJ")
    )
    
    if process:
        # Atualizar
        process.titulo = data.get("titulo") or data.get("ProcNome") or process.titulo
        process.status = data.get("status") or data.get("ProcStatus") or process.status
        process.inicio = inicio or process.inicio
        process.conclusao = conclusao or process.conclusao
        process.gestor = data.get("gestor") or data.get("GestorNome") or process.gestor
        process.dias_corridos = data.get("dias_corridos") or data.get("ProcDiasCorridos") or process.dias_corridos
        process.company_id = company_cnpj or process.company_id
        process.last_dh = last_dh or process.last_dh
        process.raw_data = json.dumps(data, ensure_ascii=False)
        process.updated_at = datetime.utcnow()
    else:
        # Inserir
        process = Process(
            proc_id=proc_id,
            titulo=data.get("titulo") or data.get("ProcNome") or "",
            status=data.get("status") or data.get("ProcStatus") or "",
            inicio=inicio,
            conclusao=conclusao,
            gestor=data.get("gestor") or data.get("GestorNome") or "",
            dias_corridos=data.get("dias_corridos") or data.get("ProcDiasCorridos"),
            company_id=company_cnpj,
            last_dh=last_dh,
            raw_data=json.dumps(data, ensure_ascii=False),
            updated_at=datetime.utcnow()
        )
        session.add(process)
    
    return process


def upsert_delivery(session: Session, data: Dict[str, Any]) -> Delivery:
    """
    Insere ou atualiza uma delivery (obrigação fiscal).
    
    Args:
        session: Sessão do SQLAlchemy
        data: Dicionário com dados da delivery
    
    Returns:
        Instância de Delivery ou None se dados inválidos
    """
    import json
    from dateutil import parser as date_parser
    
    # Extrair campos chave
    company_cnpj = normalize_cnpj(
        data.get("company_id") or 
        data.get("cnpj") or 
        data.get("CNPJ") or
        data.get("Identificador") or ""
    )
    nome = (data.get("nome") or data.get("Nome") or "").strip()
    competencia = (data.get("competencia") or data.get("Competencia") or "").strip()
    
    # Se não tem competencia, tentar extrair de EntDtPrazo (YYYY-MM-DD -> YYYY-MM)
    if not competencia:
        prazo_str = data.get("EntDtPrazo") or data.get("EntDtprazo") or data.get("prazo") or ""
        if prazo_str and prazo_str != "0000-00-00":
            try:
                competencia = prazo_str[:7]  # YYYY-MM
            except:
                pass
    
    # Se ainda não tem competencia, usar mês atual
    if not competencia:
        from datetime import datetime
        competencia = datetime.utcnow().strftime("%Y-%m")
    
    # Validar campos mínimos
    if not company_cnpj:
        return None  # Sem CNPJ, não pode persistir
    
    if not nome:
        nome = "Entrega sem nome"  # Valor padrão
    
    # Gerar ID com valores seguros
    try:
        delivery_id = generate_delivery_id(company_cnpj, nome, competencia)
    except:
        return None  # Se falhar ao gerar ID, descartar
    
    try:
        delivery = session.query(Delivery).filter_by(id=delivery_id).first()
    except:
        delivery = None
    
    # Parsear datas
    def parse_date(value):
        if not value:
            return None
        if isinstance(value, datetime):
            return value
        try:
            return date_parser.parse(value)
        except:
            return None
    
    prazo = parse_date(data.get("prazo") or data.get("Prazo"))
    entregue_em = parse_date(data.get("entregue_em") or data.get("EntregueEm"))
    
    # Determinar categoria
    categoria = data.get("categoria", "")
    if not categoria:
        nome_upper = nome.upper()
        if "REINF" in nome_upper or "EFD-REINF" in nome_upper:
            categoria = "efd_reinf"
        elif "EFD CONTRIB" in nome_upper or "EFD-CONTRIB" in nome_upper:
            categoria = "efd_contrib"
        elif "DIFAL" in nome_upper:
            categoria = "difal"
        else:
            categoria = "outros"
    
    # Determinar subtipo (para DIFAL)
    subtipo = data.get("subtipo", "")
    if categoria == "difal" and not subtipo:
        nome_upper = nome.upper()
        if "CONSUMO" in nome_upper and "IMOBILIZADO" in nome_upper:
            subtipo = "ambos"
        elif "CONSUMO" in nome_upper or "IMOBILIZADO" in nome_upper:
            subtipo = "consumo_imobilizado"
        elif "COMERCIALIZAÇÃO" in nome_upper or "COMERCIALIZACAO" in nome_upper:
            subtipo = "comercializacao"
    
    if delivery:
        # Atualizar
        delivery.company_id = company_cnpj
        delivery.nome = nome
        delivery.categoria = categoria
        delivery.subtipo = subtipo
        delivery.status = data.get("status") or data.get("Status") or delivery.status
        delivery.competencia = competencia
        delivery.prazo = prazo or delivery.prazo
        delivery.entregue_em = entregue_em or delivery.entregue_em
        delivery.raw_data = json.dumps(data, ensure_ascii=False)
        delivery.updated_at = datetime.utcnow()
    else:
        # Inserir
        delivery = Delivery(
            id=delivery_id,
            company_id=company_cnpj,
            nome=nome,
            categoria=categoria,
            subtipo=subtipo,
            status=data.get("status") or data.get("Status") or "",
            competencia=competencia,
            prazo=prazo,
            entregue_em=entregue_em,
            raw_data=json.dumps(data, ensure_ascii=False),
            updated_at=datetime.utcnow()
        )
        session.add(delivery)
    
    return delivery


def bulk_upsert_companies(session: Session, companies: List[Dict[str, Any]]) -> int:
    """Faz upsert em lote de empresas."""
    count = 0
    for company_data in companies:
        try:
            upsert_company(session, company_data)
            count += 1
        except Exception as e:
            print(f"Erro ao fazer upsert de company: {e}")
    session.commit()
    return count


def bulk_upsert_processes(session: Session, processes: List[Dict[str, Any]]) -> int:
    """Faz upsert em lote de processos."""
    count = 0
    for process_data in processes:
        try:
            upsert_process(session, process_data)
            count += 1
        except Exception as e:
            print(f"Erro ao fazer upsert de process: {e}")
    session.commit()
    return count


def bulk_upsert_deliveries(session: Session, deliveries: List[Dict[str, Any]]) -> int:
    """Faz upsert em lote de deliveries."""
    count = 0
    for delivery_data in deliveries:
        try:
            result = upsert_delivery(session, delivery_data)
            if result:  # Só conta se foi bem-sucedido
                count += 1
        except Exception as e:
            # Log silencioso para não poluir output com erros de validação
            pass
    session.commit()
    return count
