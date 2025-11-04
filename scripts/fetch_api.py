"""Fetch processes from Acessórias with incremental DtLastDH control."""
from __future__ import annotations

import json
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from dateutil import parser
from dotenv import load_dotenv

from scripts.acessorias_client import AcessoriasClient
from scripts.utils.logger import log
from scripts.utils.normalization import normalize_structure

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW_API = DATA / "raw_api"
CONFIG_PATH = ROOT / "scripts" / "config.json"
SYNC_STATE = DATA / ".sync_state.json"


def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


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


def load_sync_state() -> Dict[str, Any]:
    if SYNC_STATE.exists():
        try:
            return json.loads(SYNC_STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log("fetch_api", "WARNING", "sync_state inválido, reiniciando")
    return {}


def save_sync_state(state: Dict[str, Any]) -> None:
    SYNC_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")



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
    if not last_value:
        return None
    try:
        dt_last = parser.isoparse(last_value)
    except (ValueError, TypeError, parser.ParserError):
        return None
    dt_last = dt_last - timedelta(minutes=5)
    dt_last = dt_last.astimezone(timezone.utc).replace(microsecond=0)
    return dt_last.strftime("%Y-%m-%d %H:%M:%S")


def collect_statuses(cfg: Dict[str, Any]) -> List[str]:
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


def main() -> None:
    load_dotenv()
    ensure_dirs()

    cfg = load_config()
    sync_state = load_sync_state()
    last_sync = (sync_state.get("api") or {}).get("last_sync")
    dt_last_dh = compute_dt_last_dh(last_sync)

    acessorias_cfg = cfg.get("acessorias", {})
    client = AcessoriasClient(
        base_url=acessorias_cfg.get("base_url"),
        page_size=int(acessorias_cfg.get("page_size", 20)),
        rate_budget=int(acessorias_cfg.get("rate_budget", 90)),
    )
    statuses = collect_statuses(cfg)

    log(
        "fetch_api",
        "INFO",
        "Iniciando coleta",
        statuses=statuses if statuses else ["ALL"],
        dt_last_dh=dt_last_dh,
    )
    try:
        collected = client.list_processes(statuses=statuses or None, dt_last_dh=dt_last_dh)
    except Exception as exc:
        log("fetch_api", "ERROR", "Falha list_processes", error=str(exc))
        raise

    if not collected:
        scope = ",".join(statuses) if statuses else "ALL"
        log("fetch_api", "INFO", f"0 processos (status={scope})")

    unique = deduplicate_processes(collected)
    normalized = normalize_rows(unique)

    for idx, item in enumerate(normalized, start=1):
        (RAW_API / f"process_{idx:05d}.json").write_text(
            json.dumps(item, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    output_path = DATA / "api_processes.json"
    output_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_api", "INFO", "Salvo api_processes.json", total=len(normalized))

    now_utc = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    sync_state.setdefault("api", {})["last_sync"] = now_utc
    save_sync_state(sync_state)
    log("fetch_api", "INFO", "Atualizado sync", last_sync=now_utc)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        logger.error("fetch_api falhou: %s", exc)
        raise
