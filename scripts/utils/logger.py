"""Logging helpers with rotating file handler and token masking."""
from __future__ import annotations

from pathlib import Path
import logging
import os
import re
import sys
from logging.handlers import RotatingFileHandler
from typing import Any, Dict

_BASE = Path(__file__).resolve().parents[2]
_LOG_DIR = _BASE / "data" / "logs"
_LOG_PATH = _LOG_DIR / "gestor.log"
_LOGGER_NAME = "gestor"


def _ensure_logger() -> logging.Logger:
    """Configura o logger raiz se ainda não estiver configurado."""
    _LOG_DIR.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger(_LOGGER_NAME)
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        _LOG_PATH,
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)
    logger.propagate = False
    return logger


def _mask_sensitive(value: str) -> str:
    token = os.getenv("ACESSORIAS_TOKEN")
    if token:
        value = value.replace(token, "***")
    # mascarar sequências longas de caracteres sem espaços (como tokens)
    value = re.sub(r"[A-Za-z0-9_=\-]{20,}", "***", value)
    return value


def _stringify_extra(extra: Dict[str, Any]) -> str:
    safe_pairs = []
    for key, value in extra.items():
        try:
            text = _mask_sensitive(str(value))
        except Exception:
            text = "<unprintable>"
        safe_pairs.append(f"{key}={text}")
    return " ".join(safe_pairs)


def get_logger(component: str) -> logging.Logger:
    base = _ensure_logger()
    if component and component != _LOGGER_NAME:
        return base.getChild(component)
    return base


def log(component: str, level: str, message: str, **extra: Any) -> None:
    logger = get_logger(component)
    lvl = getattr(logging, (level or "INFO").upper(), logging.INFO)
    msg = _mask_sensitive(message)
    if extra:
        msg = f"{msg} | {_stringify_extra(extra)}"
    logger.log(lvl, msg)

