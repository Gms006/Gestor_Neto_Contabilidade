# scripts/fetch_deliveries.py
"""
Collect deliveries from Acessórias API.
- Histórico: busca por CNPJ (sem DtLastDH)
- Delta diário: busca via ListAll com DtLastDH
"""
from __future__ import annotations

import os
import json
from datetime import date, datetime, timedelta, time, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dateutil import parser
from dotenv import load_dotenv

# ---- logger com fallback -----------------------------------
try:
    from scripts.utils.logger import log  # preferencial
except Exception:
    import logging, sys, json as _json_fallback
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    _logger = logging.getLogger("fetch_deliveries")

    def log(src: str, level: str, msg: str, **meta):
        lvl = getattr(logging, (level or "INFO").upper(), logging.INFO)
        if meta:
            try:
                meta_str = _json_fallback.dumps(meta, ensure_ascii=False)
            except Exception:
                meta_str = str(meta)
            _logger.log(lvl, "%s | %s | %s", src, msg, meta_str)
        else:
            _logger.log(lvl, "%s | %s", src, msg)

# ---- normalization com fallback -----------------------------
try:
    from scripts.utils.normalization import normalize_structure
except Exception:
    def normalize_structure(x):  # type: ignore
        return x

from scripts.acessorias_client import AcessoriasClient

# Importar módulos do banco de dados
try:
    from scripts.db import get_session, init_db, bulk_upsert_deliveries, Company
    DB_AVAILABLE = True
except Exception as e:
    _logger.warning(f"Banco de dados não disponível: {e}")
    DB_AVAILABLE = False

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG_PATH = ROOT / "scripts" / "config.json"
SYNC_STATE = DATA / ".sync_state.json"
OUTPUT = DATA / "deliveries_raw.json"

# Carrega .env da raiz do projeto
load_dotenv(dotenv_path=ROOT / ".env", override=True)


def ensure_dirs() -> None:
    DATA.mkdir(exist_ok=True)


def load_config() -> Dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def load_sync_state() -> Dict[str, Any]:
    if SYNC_STATE.exists():
        try:
            return json.loads(SYNC_STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log("fetch_deliveries", "WARNING", "sync_state inválido, reiniciando")
    return {}


def save_sync_state(state: Dict[str, Any]) -> None:
    SYNC_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def compute_dt_last_dh(last_value: Optional[str]) -> str:
    """
    Calcula DtLastDH para delta diário.
    Se não houver último valor, usa ontem.
    """
    floor = datetime.combine(date.today() - timedelta(days=1), time.min)
    
    if last_value:
        try:
            parsed = parser.isoparse(last_value)
            if parsed.tzinfo:
                parsed = parsed.astimezone().replace(tzinfo=None)
            parsed = parsed - timedelta(minutes=5)
            if parsed < floor:
                parsed = floor
        except:
            parsed = floor
    else:
        parsed = floor
    
    return parsed.strftime("%Y-%m-%d %H:%M:%S")


def fetch_historical_by_cnpj(client: AcessoriasClient, months_back: int = 6) -> List[Dict[str, Any]]:
    """
    Busca histórico de deliveries por CNPJ (sem DtLastDH).
    """
    if not DB_AVAILABLE:
        log("fetch_deliveries", "WARNING", "DB não disponível, pulando histórico por CNPJ")
        return []
    
    try:
        session = get_session()
        companies = session.query(Company).all()
        session.close()
        
        if not companies:
            log("fetch_deliveries", "INFO", "Nenhuma empresa no banco, pulando histórico")
            return []
        
        # Período: últimos N meses
        dt_final = date.today()
        dt_initial = dt_final - timedelta(days=30 * months_back)
        
        dt_initial_str = dt_initial.strftime("%Y-%m-%d")
        dt_final_str = dt_final.strftime("%Y-%m-%d")
        
        log("fetch_deliveries", "INFO", "Buscando histórico por CNPJ",
            total_empresas=len(companies),
            periodo=f"{dt_initial_str} a {dt_final_str}")
        
        aggregated: List[Dict[str, Any]] = []
        
        for company in companies:
            cnpj = company.cnpj or company.id
            if not cnpj:
                continue
            
            try:
                log("fetch_deliveries", "DEBUG", "Buscando deliveries",
                    cnpj=cnpj, empresa=company.nome)
                
                rows = client.list_deliveries_by_cnpj(
                    cnpj=cnpj,
                    dt_initial=dt_initial_str,
                    dt_final=dt_final_str
                )
                
                # Adicionar company_id a cada registro
                for row in rows:
                    row["company_id"] = company.id
                
                aggregated.extend(rows)
                
                log("fetch_deliveries", "DEBUG", "Deliveries coletadas",
                    cnpj=cnpj, count=len(rows))
                
            except Exception as e:
                log("fetch_deliveries", "ERROR", "Erro ao buscar deliveries por CNPJ",
                    cnpj=cnpj, error=str(e))
                continue
        
        return aggregated
        
    except Exception as e:
        log("fetch_deliveries", "ERROR", "Erro ao buscar histórico por CNPJ", error=str(e))
        return []


def fetch_delta_listall(client: AcessoriasClient, dt_last_dh: str) -> List[Dict[str, Any]]:
    """
    Busca delta diário via ListAll com DtLastDH.
    """
    today = date.today()
    yesterday = today - timedelta(days=1)
    
    # Buscar hoje e ontem
    dates_to_fetch = [yesterday, today]
    
    aggregated: List[Dict[str, Any]] = []
    
    for target_date in dates_to_fetch:
        date_str = target_date.strftime("%Y-%m-%d")
        
        try:
            log("fetch_deliveries", "INFO", "Buscando delta ListAll",
                data=date_str, dt_last_dh=dt_last_dh)
            
            rows = client.list_deliveries_listall(
                dt_initial=date_str,
                dt_final=date_str,
                dt_last_dh=dt_last_dh
            )
            
            aggregated.extend(rows)
            
            log("fetch_deliveries", "INFO", "Delta coletado",
                data=date_str, count=len(rows))
            
        except Exception as e:
            log("fetch_deliveries", "ERROR", "Erro ao buscar delta ListAll",
                data=date_str, error=str(e))
            continue
    
    return aggregated


def main() -> None:
    # token do .env
    token = (os.getenv("ACESSORIAS_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("ACESSORIAS_TOKEN ausente no .env (ou vazio).")
    # garante disponibilidade para clients que leem do ambiente
    os.environ["ACESSORIAS_TOKEN"] = token

    ensure_dirs()

    cfg = load_config()
    acessorias_cfg = cfg.get("acessorias", {})
    deliveries_cfg = cfg.get("deliveries", {})
    
    if not deliveries_cfg.get("enabled", True):
        log("fetch_deliveries", "INFO", "Deliveries desabilitado; encerrando")
        return

    sync_state = load_sync_state()
    last_sync = (sync_state.get("deliveries") or {}).get("last_sync")
    
    client = AcessoriasClient(
        base_url=acessorias_cfg.get("base_url"),
        rate_budget=int(acessorias_cfg.get("rate_budget", 90)),
    )

    log("fetch_deliveries", "INFO", "Iniciando coleta de deliveries")

    aggregated: List[Dict[str, Any]] = []

    # 1. Buscar histórico por CNPJ (se DB disponível)
    if DB_AVAILABLE:
        months_back = deliveries_cfg.get("history_months", 6)
        historical = fetch_historical_by_cnpj(client, months_back=months_back)
        aggregated.extend(historical)
        log("fetch_deliveries", "INFO", "Histórico coletado", total=len(historical))

    # 2. Buscar delta diário via ListAll
    dt_last_dh = compute_dt_last_dh(last_sync)
    delta = fetch_delta_listall(client, dt_last_dh)
    aggregated.extend(delta)
    log("fetch_deliveries", "INFO", "Delta coletado", total=len(delta))

    # Normalizar
    normalized = [normalize_structure(item) for item in aggregated]
    
    # Persistir no banco de dados
    if DB_AVAILABLE and normalized:
        try:
            init_db()
            session = get_session()
            count = bulk_upsert_deliveries(session, normalized)
            session.close()
            log("fetch_deliveries", "DEBUG", "Persistido no banco de dados", total=count)
        except Exception as e:
            log("fetch_deliveries", "ERROR", "Erro ao persistir no banco", error=str(e))
    
    # Salvar snapshot JSON (fallback)
    OUTPUT.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_deliveries", "DEBUG", "Salvo deliveries_raw.json", total=len(normalized))
    
    # Salvar snapshot para o frontend
    deliveries_frontend = DATA / "deliveries.json"
    deliveries_frontend.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_deliveries", "DEBUG", "Salvo deliveries.json para frontend", total=len(normalized))

    # Atualizar sync state
    now_utc = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    sync_state.setdefault("deliveries", {})["last_sync"] = now_utc
    save_sync_state(sync_state)
    log("fetch_deliveries", "INFO", "Atualizado sync", last_sync=now_utc)


if __name__ == "__main__":
    main()
