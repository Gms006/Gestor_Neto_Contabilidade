# -*- coding: utf-8 -*-
"""Coleta incremental de deliveries da API do Acessórias."""
from __future__ import annotations

import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from dateutil import parser
from dotenv import load_dotenv

from scripts.acessorias_client import list_deliveries
from scripts.utils.logger import setup_logger
from scripts.utils.normalization import normalize_structure

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG_PATH = ROOT / "scripts" / "config.json"
SYNC_STATE = DATA / ".sync_state.json"

logger = setup_logger("fetch_deliveries")


def ensure_data_dir() -> None:
    DATA.mkdir(exist_ok=True)


def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as fp:
        return json.load(fp)


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


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return parser.parse(value)
    except (parser.ParserError, TypeError, ValueError):
        return None


def default_range_for_today() -> tuple[str, str]:
    today = date.today()
    start = today.replace(day=1)
    next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    end = next_month - timedelta(days=1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def compute_last_dh(last_value: Optional[str]) -> str:
    """Aplica janela de segurança de 5 minutos e piso em ontem 00:00."""
    fallback_floor = datetime.combine(date.today() - timedelta(days=1), time.min)
    dt_last = _parse_dt(last_value)
    if not dt_last:
        dt_last = fallback_floor
    else:
        dt_last = dt_last - timedelta(minutes=5)
        if dt_last < fallback_floor:
            dt_last = fallback_floor
    return dt_last.replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")


def build_params(cfg: Dict[str, Any], sync_state: Dict[str, Any]) -> Dict[str, Any]:
    deliveries_cfg = cfg.get("deliveries", {})
    identificador = deliveries_cfg.get("identificador", "ListAll")
    include_config = bool(deliveries_cfg.get("include_config", True))

    dt_initial = deliveries_cfg.get("dt_initial")
    dt_final = deliveries_cfg.get("dt_final")
    if not dt_initial or not dt_final:
        dt_initial, dt_final = default_range_for_today()

    last_dh_value = (sync_state.get("api") or {}).get("deliveries_last_dh")
    dt_last_dh = compute_last_dh(last_dh_value) if last_dh_value else None

    if identificador == "ListAll":
        dt_last_dh = dt_last_dh or compute_last_dh(None)
    else:
        override = deliveries_cfg.get("dt_last_dh")
        if override:
            dt_last_dh = compute_last_dh(override)

    return {
        "identificador": identificador,
        "dt_ini": dt_initial,
        "dt_fim": dt_final,
        "dt_last_dh": dt_last_dh,
        "include_config": include_config,
    }


def main() -> None:
    load_dotenv()
    ensure_data_dir()
    cfg = load_config()

    deliveries_cfg = cfg.get("deliveries", {})
    if not deliveries_cfg.get("enabled", False):
        logger.info("Deliveries desabilitado no config.json; nada a fazer.")
        return

    sync_state = load_sync_state()
    params = build_params(cfg, sync_state)

    logger.info(
        "[fetch_deliveries] Coletando deliveries (identificador=%s, DtInitial=%s, DtFinal=%s, DtLastDH=%s)",
        params["identificador"],
        params["dt_ini"],
        params["dt_fim"],
        params["dt_last_dh"],
    )

    deliveries = list_deliveries(
        identificador=params["identificador"],
        dt_ini=params["dt_ini"],
        dt_fim=params["dt_fim"],
        dt_last_dh=params["dt_last_dh"],
        include_config=params["include_config"],
    )
    logger.info("Deliveries recebidos: %d", len(deliveries))

    normalized = [normalize_structure(item) for item in deliveries]
    output_path = DATA / "deliveries.json"
    output_path.write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("[fetch_deliveries] OK: %s", output_path)

    now_utc = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    sync_state.setdefault("api", {})["deliveries_last_dh"] = now_utc
    save_sync_state(sync_state)
    logger.info("[fetch_deliveries] Atualizado deliveries_last_dh -> %s", now_utc)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        logger.error("fetch_deliveries falhou: %s", exc)
        raise
