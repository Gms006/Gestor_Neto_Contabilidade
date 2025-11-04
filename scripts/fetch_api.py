# -*- coding: utf-8 -*-
"""Busca incremental de processos na API do Acessórias com paginação resiliente."""
from __future__ import annotations

import json
from collections import OrderedDict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from dateutil import parser
from dotenv import load_dotenv

from scripts.acessorias_client import get_process_detail, list_processes
from scripts.utils.logger import setup_logger
from scripts.utils.normalization import normalize_structure

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW_API = DATA / "raw_api"
CONFIG_PATH = ROOT / "scripts" / "config.json"
SYNC_STATE = DATA / ".sync_state.json"

logger = setup_logger("fetch_api")

STATUS_MAP = {
    "A": "EM ANDAMENTO",
    "C": "CONCLUÍDO",
    "F": "FINALIZADO",
    "P": "PENDENTE",
    "R": "REJEITADO",
    "S": "SUSPENSO",
}


def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as fp:
        return json.load(fp)


def ensure_dirs() -> None:
    DATA.mkdir(exist_ok=True)
    RAW_API.mkdir(exist_ok=True)
    for path in RAW_API.glob("process_*.json"):
        try:
            path.unlink()
        except OSError:
            logger.warning("Não foi possível remover %s", path)


def load_sync_state() -> Dict[str, Any]:
    if SYNC_STATE.exists():
        with open(SYNC_STATE, "r", encoding="utf-8") as fp:
            try:
                return json.load(fp)
            except json.JSONDecodeError:
                logger.warning("Arquivo .sync_state.json inválido, reiniciando controles.")
    return {}


def save_sync_state(state: Dict[str, Any]) -> None:
    with open(SYNC_STATE, "w", encoding="utf-8") as fp:
        json.dump(state, fp, ensure_ascii=False, indent=2)


def _to_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return parser.parse(value)
    except (parser.ParserError, TypeError, ValueError):
        return None


def compute_dt_last_dh(last_value: Optional[str]) -> Optional[str]:
    dt_last = _to_dt(last_value)
    if not dt_last:
        return None
    dt_last = dt_last - timedelta(minutes=5)
    dt_last = dt_last.replace(microsecond=0)
    return dt_last.strftime("%Y-%m-%d %H:%M:%S")


def collect_statuses(cfg: Dict[str, Any]) -> List[Optional[str]]:
    acessorias = cfg.get("acessorias", {})
    statuses: Iterable[Any] = acessorias.get("status_filters") or acessorias.get("proc_status") or []
    if isinstance(statuses, str):
        statuses = [s.strip() for s in statuses.split(",") if s.strip()]
    statuses_list = [s if s else None for s in statuses]
    if not statuses_list:
        return [None]
    return list(statuses_list)


def deduplicate_processes(rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    ordered: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
    for row in rows:
        pid = str(row.get("ProcID") or row.get("ProcId") or row.get("proc_id") or "").strip()
        if pid:
            ordered[pid] = row
        else:
            ordered[f"_idx_{len(ordered)}"] = row
    return list(ordered.values())


def enrich_with_details(proc: Dict[str, Any]) -> Dict[str, Any]:
    if proc.get("ProcPassos"):
        return proc
    pid = proc.get("ProcID") or proc.get("ProcId")
    if not pid:
        return proc
    try:
        detail = get_process_detail(pid)
        merged = {**detail, **proc}
        return merged
    except Exception as exc:  # noqa: BLE001
        logger.warning("Falha ao obter detalhe %s: %s", pid, exc)
        return proc


def apply_status_label(proc: Dict[str, Any]) -> Dict[str, Any]:
    status_code = proc.get("ProcStatus") or proc.get("proc_status")
    if isinstance(status_code, str):
        label = STATUS_MAP.get(status_code.upper())
        if label:
            proc["ProcStatusLabel"] = label
    return proc


def main() -> None:
    load_dotenv()
    ensure_dirs()
    cfg = load_config()
    sync_state = load_sync_state()
    last_dh = (sync_state.get("api") or {}).get("processes_last_dh")
    dt_last_dh = compute_dt_last_dh(last_dh)

    statuses = collect_statuses(cfg)
    logger.info(
        "[fetch_api] Coletando processos (statuses=%s, dt_last_dh=%s)...",
        statuses,
        dt_last_dh,
    )

    collected: List[Dict[str, Any]] = []
    for status in statuses:
        try:
            rows = list_processes(status=status, dt_last_dh=dt_last_dh)
            logger.info("Status %s -> %d registros", status or "ALL", len(rows))
            collected.extend(rows)
        except Exception as exc:  # noqa: BLE001
            logger.error("Erro list_processes(status=%s): %s", status, exc)
            raise

    unique = deduplicate_processes(collected)
    logger.info("Total consolidado após deduplicação: %d", len(unique))

    enriched: List[Dict[str, Any]] = []
    for idx, proc in enumerate(unique, start=1):
        merged = enrich_with_details(proc)
        normalized = normalize_structure(merged)
        normalized = apply_status_label(normalized)
        enriched.append(normalized)
        (RAW_API / f"process_{idx:05d}.json").write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    output_path = DATA / "api_processes.json"
    output_path.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("[fetch_api] OK: %s", output_path)

    now_utc = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    sync_state.setdefault("api", {})["processes_last_dh"] = now_utc
    save_sync_state(sync_state)
    logger.info("[fetch_api] Atualizado processes_last_dh -> %s", now_utc)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        logger.error("fetch_api falhou: %s", exc)
        raise
