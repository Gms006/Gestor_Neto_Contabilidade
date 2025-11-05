# -*- coding: utf-8 -*-
"""
Fetch processes from Acessórias with incremental DtLastDH control.
Gera:
- data/raw_api/process_*.json (1 arquivo por processo)
- data/api_processes.json (lista normalizada)
- data/.sync_state.json (controle incremental)
"""

# Logger robusto com fallback completo (get_logger + log)
try:
    from scripts.utils.logger import get_logger, log  # preferencial
    logger = get_logger("fetch_api")
except Exception:
    import logging, sys, json as _json_fallback
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    logger = logging.getLogger("fetch_api")

    def log(src: str, level: str, msg: str, **meta):
        """Fallback de log estruturado."""
        lvl = getattr(logging, (level or "INFO").upper(), logging.INFO)
        if meta:
            try:
                meta_str = _json_fallback.dumps(meta, ensure_ascii=False)
            except Exception:
                meta_str = str(meta)
            logger.log(lvl, "%s | %s | %s", src, msg, meta_str)
        else:
            logger.log(lvl, "%s | %s", src, msg)

import os
import json
import argparse
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from dateutil import parser
from dotenv import load_dotenv

# Carrega .env da raiz do projeto
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env", override=True)

from scripts.acessorias_client import AcessoriasClient

# normalize_structure com fallback (identidade) se util não existir
try:
    from scripts.utils.normalization import normalize_structure
except Exception:
    def normalize_structure(x):  # type: ignore
        return x

# Importar módulos do banco de dados
try:
    from scripts.db import get_session, init_db, bulk_upsert_processes, upsert_company
    DB_AVAILABLE = True
except Exception as e:
    logger.warning(f"Banco de dados não disponível: {e}")
    DB_AVAILABLE = False

# Paths
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW_API = DATA / "raw_api"
CONFIG_PATH = ROOT / "scripts" / "config.json"
SYNC_STATE = DATA / ".sync_state.json"


# ------------------------ Utilidades ------------------------ #
def load_config() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"Config não encontrada: {CONFIG_PATH}")
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def ensure_dirs() -> None:
    DATA.mkdir(exist_ok=True)
    RAW_API.mkdir(exist_ok=True)
    # limpa dumps antigos para não acumular
    for path in RAW_API.glob("process_*.json"):
        try:
            path.unlink()
        except OSError:
            logger.warning("Não foi possível remover %s", path)


def load_sync_state() -> Dict[str, Any]:
    if SYNC_STATE.exists():
        try:
            return json.loads(SYNC_STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log("fetch_api", "WARNING", "sync_state inválido, reiniciando")
    return {}


def save_sync_state(state: Dict[str, Any]) -> None:
    SYNC_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def compute_dt_last_dh(last_value: Optional[str]) -> Optional[str]:
    """
    Converte ISO para formato aceito pela API (YYYY-MM-DD HH:MM:SS),
    subtraindo 5 minutos para garantir captura de borda.
    """
    if not last_value:
        return None
    try:
        dt_last = parser.isoparse(last_value)
    except (ValueError, TypeError, parser.ParserError):
        return None
    dt_last = dt_last - timedelta(minutes=5)
    dt_last = dt_last.astimezone(timezone.utc).replace(microsecond=0)
    return dt_last.strftime("%Y-%m-%d %H:%M:%S")


def collect_statuses_from_cfg(cfg: Dict[str, Any]) -> List[str]:
    """
    Lê 'acessorias.statuses' do config. Se vier string, divide por vírgulas.
    Retorna lista (vazia significa 'ALL' para o client).
    """
    raw = cfg.get("acessorias", {}).get("statuses") or []
    if isinstance(raw, str):
        raw = [item.strip() for item in raw.split(",") if item.strip()]
    return [item for item in raw if item]


def deduplicate_processes(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    ordered: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
    for row in rows:
        pid = str(row.get("ProcID") or row.get("ProcId") or row.get("proc_id") or "").strip()
        key = pid or f"_idx_{len(ordered)}"
        ordered[key] = row
    return list(ordered.values())


def apply_status_label(proc: Dict[str, Any]) -> Dict[str, Any]:
    status_code = proc.get("ProcStatus") or proc.get("proc_status")
    mapping = {
        "A": "EM ANDAMENTO",
        "C": "CONCLUÍDO",
        "F": "FINALIZADO",
        "P": "PENDENTE",
        "R": "REJEITADO",
        "S": "SUSPENSO",
    }
    if isinstance(status_code, str):
        label = mapping.get(status_code.upper())
        if label:
            proc["ProcStatusLabel"] = label
    return proc


def normalize_rows(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    for row in rows:
        data = normalize_structure(row)
        normalized.append(apply_status_label(data))
    return normalized


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fetch Acessórias processes")
    p.add_argument(
        "--full",
        action="store_true",
        help="Ignora controle incremental (DtLastDH) e status; baixa tudo",
    )
    p.add_argument(
        "--since",
        type=str,
        default=None,
        help="Força DtLastDH (YYYY-MM-DD[ HH:MM:SS]) para coleta incremental",
    )
    p.add_argument(
        "--status",
        action="append",
        default=None,
        help="Adicionar filtro ProcStatus (pode repetir). Ex: --status C --status A",
    )
    return p.parse_args()


# ------------------------ Main ------------------------ #
def main() -> None:
    args = parse_args()

    # Valida token cedo para mensagens mais claras
    token = (os.getenv("ACESSORIAS_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("ACESSORIAS_TOKEN ausente no .env (ou vazio).")

    # Garante token no ambiente para qualquer client que leia do env
    os.environ["ACESSORIAS_TOKEN"] = token

    ensure_dirs()

    cfg = load_config()
    sync_state = load_sync_state()

    # Decide origem dos filtros
    force_full_env = (os.getenv("FETCH_FORCE_FULL") or "").lower() in {"1", "true", "yes"}
    force_full = args.full or force_full_env

    if force_full:
        dt_last_dh = None
        statuses: Optional[List[str]] = None
    else:
        # since explícito tem prioridade; senão usa incremental salvo
        if args.since:
            # aceita datas com/sem horário
            try:
                dt = parser.parse(args.since)
                dt = dt.astimezone(timezone.utc).replace(microsecond=0)
                dt_last_dh = dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                raise ValueError("--since inválido; use 'YYYY-MM-DD' ou 'YYYY-MM-DD HH:MM:SS'")
        else:
            last_sync_iso = (sync_state.get("api") or {}).get("last_sync")
            dt_last_dh = compute_dt_last_dh(last_sync_iso)

        # status via CLI > config.json
        if args.status:
            statuses = [s for s in args.status if s]
        else:
            statuses = collect_statuses_from_cfg(cfg)
        # lista vazia => ALL (client trata com None)
        if not statuses:
            statuses = None

    acessorias_cfg = cfg.get("acessorias", {})
    # Se seu AcessoriasClient aceitar token=..., pode passar explicitamente:
    client = AcessoriasClient(
        base_url=acessorias_cfg.get("base_url"),
        rate_budget=int(acessorias_cfg.get("rate_budget", 90)),
    )

    log(
        "fetch_api",
        "INFO",
        "Iniciando coleta",
        full=force_full,
        statuses=statuses if statuses else ["ALL"],
        dt_last_dh=dt_last_dh,
    )

    # Coleta
    collected: List[Dict[str, Any]] = client.list_processes(
        statuses=statuses, dt_last_dh=dt_last_dh
    )

    log("fetch_api", "INFO", "Coleta concluída", total=len(collected))

    if not collected:
        scope = ",".join(statuses) if statuses else "ALL"
        log("fetch_api", "INFO", f"0 processos (status={scope})")

    unique = deduplicate_processes(collected)
    normalized = normalize_rows(unique)

    # dumps individuais para auditoria
    for idx, item in enumerate(normalized, start=1):
        (RAW_API / f"process_{idx:05d}.json").write_text(
            json.dumps(item, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # Persistir no banco de dados
    if DB_AVAILABLE:
        try:
            init_db()
            session = get_session()
            
            # Extrair empresas únicas e fazer upsert
            companies_seen = set()
            for item in normalized:
                cnpj = item.get("CNPJ") or item.get("cnpj") or item.get("EmpCNPJ")
                if cnpj:
                    cnpj_clean = "".join(c for c in str(cnpj) if c.isdigit())
                    if cnpj_clean and cnpj_clean not in companies_seen:
                        companies_seen.add(cnpj_clean)
                        try:
                            upsert_company(session, {
                                "cnpj": cnpj_clean,
                                "nome": item.get("EmpNome") or item.get("empresa_nome") or ""
                            })
                        except Exception as e:
                            logger.warning(f"Erro ao fazer upsert de company {cnpj_clean}: {e}")
            
            session.commit()
            
            # Fazer upsert dos processos
            count = bulk_upsert_processes(session, normalized)
            session.close()
            
            log("fetch_api", "INFO", "Persistido no banco de dados", total=count)
        except Exception as e:
            logger.error(f"Erro ao persistir no banco: {e}")
    
    # arquivo agregado (snapshot JSON para fallback)
    output_path = DATA / "api_processes.json"
    output_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_api", "INFO", "Salvo api_processes.json", total=len(normalized))

    # atualiza controle incremental (sempre salva o “agora”)
    now_utc = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    sync_state.setdefault("api", {})["last_sync"] = now_utc
    save_sync_state(sync_state)
    log("fetch_api", "INFO", "Atualizado sync", last_sync=now_utc)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        logger.error("fetch_api falhou: %s", exc, exc_info=True)
        raise
