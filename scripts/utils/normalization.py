"""Utility helpers to normalize values returned by the Acessórias API."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from dateutil import parser

_BR_DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
_BR_DATETIME_RE = re.compile(r"^\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}(:\d{2})?$")
_MONEY_RE = re.compile(r"^-?\d{1,3}(\.\d{3})*,\d{2}$")


def _parse_br_datetime(value: str) -> datetime | None:
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _parse_br_date(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, "%d/%m/%Y")
    except ValueError:
        return None


def _to_iso(dt: datetime) -> str:
    dt = dt.replace(microsecond=0)
    if dt.tzinfo:
        return dt.astimezone().replace(microsecond=0).isoformat()
    return dt.isoformat(sep=" ")


def normalize_string(value: str) -> Any:
    raw = value.strip()
    if not raw:
        return value
    if _BR_DATETIME_RE.match(raw):
        parsed = _parse_br_datetime(raw)
        if parsed:
            return _to_iso(parsed)
    if _BR_DATE_RE.match(raw):
        parsed = _parse_br_date(raw)
        if parsed:
            return parsed.strftime("%Y-%m-%d")
    if _MONEY_RE.match(raw):
        as_float = float(raw.replace(".", "").replace(",", "."))
        return as_float
    # Attempt ISO parsing as a last resort (preserves already ISO strings)
    try:
        parsed = parser.isoparse(raw)
        return _to_iso(parsed)
    except (ValueError, TypeError):
        return value


def normalize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: normalize_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize_value(v) for v in value]
    if isinstance(value, datetime):
        return _to_iso(value)
    if isinstance(value, str):
        return normalize_string(value)
    return value


def normalize_structure(payload: Any) -> Any:
    """Normalize a nested payload of dicts/lists coming from the API."""
    return normalize_value(payload)
