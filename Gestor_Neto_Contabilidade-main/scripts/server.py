# scripts/server.py
"""
Servidor FastAPI para expor dados via API REST.
Serve também os arquivos estáticos do frontend.
"""
from __future__ import annotations

import os
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Carrega .env
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env", override=True)

# Importa módulos do banco
try:
    from scripts.db import (
        get_session, init_db,
        Company, Process, Delivery
    )
    DB_AVAILABLE = True
except Exception as e:
    logging.warning(f"Banco de dados não disponível: {e}")
    DB_AVAILABLE = False

# Paths
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
WEB = ROOT / "web"

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("server")

# Inicializa FastAPI
app = FastAPI(
    title="Gestor Neto Contabilidade API",
    description="API para gestão de processos e obrigações fiscais",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inicializa banco de dados
if DB_AVAILABLE:
    try:
        init_db()
        logger.info("Banco de dados inicializado com sucesso")
    except Exception as e:
        logger.error(f"Erro ao inicializar banco de dados: {e}")
        DB_AVAILABLE = False


# ============================================================================
# HELPERS
# ============================================================================

def load_json_fallback(filename: str) -> Any:
    """Carrega JSON do disco como fallback."""
    filepath = DATA / filename
    if not filepath.exists():
        return None
    try:
        return json.loads(filepath.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"Erro ao ler {filename}: {e}")
        return None


# ============================================================================
# ENDPOINTS
# ============================================================================

@app.get("/")
async def root():
    """Redireciona para o frontend."""
    return FileResponse(WEB / "index.html")


@app.get("/health")
async def health():
    """Health check."""
    return {
        "status": "ok",
        "database": "available" if DB_AVAILABLE else "unavailable",
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/processos")
async def get_processos(
    status: Optional[str] = Query(None, description="Filtrar por status (ex: Concluído)"),
    pagina: int = Query(1, ge=1, description="Número da página"),
    limite: int = Query(100, ge=1, le=10000, description="Itens por página"),
    empresa: Optional[str] = Query(None, description="Filtrar por CNPJ da empresa"),
    desde: Optional[str] = Query(None, description="Data inicial (YYYY-MM-DD)"),
    ate: Optional[str] = Query(None, description="Data final (YYYY-MM-DD)"),
):
    """
    Lista processos com filtros opcionais (alias para /api/processes).
    Tenta buscar do banco de dados, se falhar usa fallback JSON.
    """
    return await get_processes(status=status, pagina=pagina, limite=limite, empresa=empresa, desde=desde, ate=ate)


@app.get("/api/processes")
async def get_processes(
    status: Optional[str] = Query(None, description="Filtrar por status (ex: Concluído)"),
    pagina: int = Query(1, ge=1, description="Número da página"),
    limite: int = Query(100, ge=1, le=10000, description="Itens por página"),
    empresa: Optional[str] = Query(None, description="Filtrar por CNPJ da empresa"),
    desde: Optional[str] = Query(None, description="Data inicial (YYYY-MM-DD)"),
    ate: Optional[str] = Query(None, description="Data final (YYYY-MM-DD)"),
):
    """
    Lista processos com filtros opcionais.
    Tenta buscar do banco de dados, se falhar usa fallback JSON.
    """
    if DB_AVAILABLE:
        try:
            session = get_session()
            query = session.query(Process)
            
            # Aplicar filtros
            if status:
                query = query.filter(Process.status == status)
            
            if empresa:
                # Normalizar CNPJ
                empresa_clean = "".join(c for c in empresa if c.isdigit())
                query = query.filter(Process.company_id == empresa_clean)
            
            if desde:
                try:
                    dt_desde = datetime.fromisoformat(desde)
                    query = query.filter(Process.conclusao >= dt_desde)
                except:
                    pass
            
            if ate:
                try:
                    dt_ate = datetime.fromisoformat(ate)
                    query = query.filter(Process.conclusao <= dt_ate)
                except:
                    pass
            
            # Ordenar por conclusão descendente
            query = query.order_by(Process.conclusao.desc())
            
            # Paginação
            offset = (pagina - 1) * limite
            processes = query.offset(offset).limit(limite).all()
            
            # Converter para dict
            result = []
            for proc in processes:
                item = {
                    "proc_id": proc.proc_id,
                    "titulo": proc.titulo,
                    "status": proc.status,
                    "inicio": proc.inicio.isoformat() if proc.inicio else None,
                    "conclusao": proc.conclusao.isoformat() if proc.conclusao else None,
                    "gestor": proc.gestor,
                    "dias_corridos": proc.dias_corridos,
                    "company_id": proc.company_id,
                }
                
                # Adicionar dados completos se disponíveis
                if proc.raw_data:
                    try:
                        raw = json.loads(proc.raw_data)
                        item.update(raw)
                    except:
                        pass
                
                result.append(item)
            
            session.close()
            return JSONResponse(content=result)
            
        except Exception as e:
            logger.error(f"Erro ao buscar processos do DB: {e}")
            # Fallback para JSON
    
    # Fallback: carregar do JSON
    data = load_json_fallback("api_processes.json")
    if data is None:
        data = load_json_fallback("events_api.json")
    
    if data is None:
        raise HTTPException(status_code=503, detail="Dados não disponíveis")
    
    # Aplicar filtros no JSON
    if isinstance(data, list):
        filtered = data
        
        if status:
            filtered = [p for p in filtered if p.get("status") == status or p.get("ProcStatus") == status]
        
        if empresa:
            empresa_clean = "".join(c for c in empresa if c.isdigit())
            filtered = [
                p for p in filtered 
                if "".join(c for c in str(p.get("cnpj", "")) if c.isdigit()) == empresa_clean
                or "".join(c for c in str(p.get("CNPJ", "")) if c.isdigit()) == empresa_clean
            ]
        
        # Paginação
        offset = (pagina - 1) * limite
        filtered = filtered[offset:offset + limite]
        
        return JSONResponse(content=filtered)
    
    return JSONResponse(content=data)


@app.get("/api/companies")
async def get_companies():
    """
    Lista empresas.
    Tenta buscar do banco de dados, se falhar usa fallback JSON.
    """
    if DB_AVAILABLE:
        try:
            session = get_session()
            companies = session.query(Company).all()
            
            result = [
                {
                    "id": comp.id,
                    "nome": comp.nome,
                    "cnpj": comp.cnpj,
                }
                for comp in companies
            ]
            
            session.close()
            return JSONResponse(content=result)
            
        except Exception as e:
            logger.error(f"Erro ao buscar empresas do DB: {e}")
    
    # Fallback: carregar do JSON
    data = load_json_fallback("companies_obligations.json")
    if data is None:
        raise HTTPException(status_code=503, detail="Dados não disponíveis")
    
    return JSONResponse(content=data)


@app.get("/api/deliveries")
async def get_deliveries(
    from_date: Optional[str] = Query(None, alias="from", description="Data inicial (YYYY-MM-DD)"),
    to_date: Optional[str] = Query(None, alias="to", description="Data final (YYYY-MM-DD)"),
    cnpj: Optional[str] = Query(None, description="Filtrar por CNPJ"),
    categoria: Optional[str] = Query(None, description="Filtrar por categoria"),
    status: Optional[str] = Query(None, description="Filtrar por status"),
):
    """
    Lista deliveries (obrigações fiscais) com filtros opcionais.
    Tenta buscar do banco de dados, se falhar usa fallback JSON.
    """
    if DB_AVAILABLE:
        try:
            session = get_session()
            query = session.query(Delivery)
            
            # Aplicar filtros
            if cnpj:
                cnpj_clean = "".join(c for c in cnpj if c.isdigit())
                query = query.filter(Delivery.company_id == cnpj_clean)
            
            if categoria:
                query = query.filter(Delivery.categoria == categoria)
            
            if status:
                query = query.filter(Delivery.status == status)
            
            if from_date:
                try:
                    dt_from = datetime.fromisoformat(from_date)
                    query = query.filter(Delivery.prazo >= dt_from)
                except:
                    pass
            
            if to_date:
                try:
                    dt_to = datetime.fromisoformat(to_date)
                    query = query.filter(Delivery.prazo <= dt_to)
                except:
                    pass
            
            deliveries = query.all()
            
            # Converter para dict
            result = []
            for deliv in deliveries:
                item = {
                    "id": deliv.id,
                    "company_id": deliv.company_id,
                    "nome": deliv.nome,
                    "categoria": deliv.categoria,
                    "subtipo": deliv.subtipo,
                    "status": deliv.status,
                    "competencia": deliv.competencia,
                    "prazo": deliv.prazo.isoformat() if deliv.prazo else None,
                    "entregue_em": deliv.entregue_em.isoformat() if deliv.entregue_em else None,
                }
                
                # Adicionar dados completos se disponíveis
                if deliv.raw_data:
                    try:
                        raw = json.loads(deliv.raw_data)
                        item.update(raw)
                    except:
                        pass
                
                result.append(item)
            
            session.close()
            return JSONResponse(content=result)
            
        except Exception as e:
            logger.error(f"Erro ao buscar deliveries do DB: {e}")
    
    # Fallback: carregar do JSON
    data = load_json_fallback("deliveries_raw.json")
    if data is None:
        raise HTTPException(status_code=503, detail="Dados não disponíveis")
    
    return JSONResponse(content=data)


@app.get("/api/kpis")
async def get_kpis():
    """
    Retorna KPIs pré-computados.
    """
    # Carregar do JSON gerado por build_processes_kpis_alerts
    data = load_json_fallback("kpis.json")
    if data is None:
        # Tentar events.json como fallback
        data = load_json_fallback("events.json")
    
    if data is None:
        raise HTTPException(status_code=503, detail="KPIs não disponíveis")
    
    return JSONResponse(content=data)


@app.get("/api/dashboard/reinf")
async def get_dashboard_reinf():
    """
    Retorna dados de REINF por competência para o card do dashboard.
    Shape esperado: {"series": [{"competencia": "2025-11", "obrigatoria": 50, "dispensa": 10}]}
    """
    data = load_json_fallback("reinf_competencia.json")
    if data is None:
        # Retornar shape vazio compatível
        data = {"series": []}
    
    return JSONResponse(content=data)


@app.get("/api/dashboard/efdcontrib")
async def get_dashboard_efdcontrib():
    """
    Retorna dados de EFD-Contribuições por competência para o card do dashboard.
    Shape esperado: {"series": [{"competencia": "2025-11", "obrigatoria": 47, "dispensa": 13}]}
    """
    data = load_json_fallback("efdcontrib_competencia.json")
    if data is None:
        # Retornar shape vazio compatível
        data = {"series": []}
    
    return JSONResponse(content=data)


@app.get("/api/dashboard/difal")
async def get_dashboard_difal():
    """
    Retorna dados de DIFAL por tipo para o card do dashboard.
    Shape esperado: {"tipos": [{"tipo": "Comercialização", "qtd": 18}, {"tipo": "Consumo/Imobilizado", "qtd": 7}]}
    """
    data = load_json_fallback("difal_tipo.json")
    if data is None:
        # Retornar shape vazio compatível
        data = {"tipos": []}
    
    return JSONResponse(content=data)


@app.get("/api/dashboard/fechamento")
async def get_dashboard_fechamento():
    """
    Retorna estatísticas de fechamento de processos para o card do dashboard.
    Shape esperado: {"media": 14.7, "mediana": 15, "n": 120}
    """
    data = load_json_fallback("fechamento_stats.json")
    if data is None:
        # Retornar shape vazio compatível
        data = {"media": None, "mediana": None, "n": 0}
    
    return JSONResponse(content=data)


@app.get("/api/processos")
async def get_processos(
    status: Optional[str] = Query(None, description="Filtrar por status (ex: Concluído)"),
    pagina: int = Query(1, ge=1, description="Número da página"),
    limite: int = Query(100, ge=1, le=10000, description="Itens por página"),
    empresa: Optional[str] = Query(None, description="Filtrar por CNPJ da empresa"),
    desde: Optional[str] = Query(None, description="Data inicial (YYYY-MM-DD)"),
    ate: Optional[str] = Query(None, description="Data final (YYYY-MM-DD)"),
):
    """
    Lista processos com filtros opcionais (alias para /api/processes).
    Tenta buscar do banco de dados, se falhar usa fallback JSON.
    """
    return await get_processes(status=status, pagina=pagina, limite=limite, empresa=empresa, desde=desde, ate=ate)


@app.post("/api/sync")
async def sync_data():
    """
    Dispara coleta de dados (idempotente).
    Nota: Esta é uma implementação básica que apenas retorna sucesso.
    Para implementação completa, seria necessário executar os scripts de fetch em background.
    """
    return {
        "status": "success",
        "message": "Sincronização iniciada. Execute run_all.ps1 para atualizar os dados.",
        "timestamp": datetime.utcnow().isoformat()
    }


# ============================================================================
# SERVIR ARQUIVOS ESTÁTICOS
# ============================================================================

# Montar pasta web como estática
if WEB.exists():
    app.mount("/web", StaticFiles(directory=str(WEB), html=True), name="web")
    logger.info(f"Servindo arquivos estáticos de {WEB}")


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("SERVER_HOST", "127.0.0.1")
    port = int(os.getenv("SERVER_PORT", "8088"))
    
    logger.info(f"Iniciando servidor em http://{host}:{port}")
    logger.info(f"Frontend disponível em http://{host}:{port}/web/")
    logger.info(f"API disponível em http://{host}:{port}/api/")
    
    uvicorn.run(
        "scripts.server:app",
        host=host,
        port=port,
        reload=False,
        log_level="info"
    )
