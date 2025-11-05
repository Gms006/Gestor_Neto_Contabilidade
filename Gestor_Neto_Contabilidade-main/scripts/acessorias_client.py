"""HTTP client for the Acessórias API with rate limiting and retries."""
from __future__ import annotations

import logging
import os
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

import requests

from scripts.utils import normalization
from scripts.utils.logger import log

LOG = logging.getLogger("acessorias_client")


def _clean_digits(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits or value


def _coerce_datetime(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def _validate_dt_last_dh(dt_last_dh: str) -> None:
    try:
        parsed = _coerce_datetime(dt_last_dh)
    except ValueError as exc:
        raise ValueError("DtLastDH deve estar no formato ISO YYYY-MM-DD HH:MM:SS") from exc

    today = datetime.now(parsed.tzinfo)
    min_date = (today - timedelta(days=1)).date()
    if parsed.date() < min_date or parsed.date() > today.date():
        raise ValueError("DtLastDH deve ser do dia atual ou anterior para ListAll")


def _default_rate_budget(explicit: Optional[int]) -> int:
    if explicit:
        return explicit
    env_value = os.getenv("ACESSORIAS_RATE_BUDGET")
    if env_value:
        try:
            return max(1, int(env_value))
        except ValueError:
            pass
    return 70


@dataclass
class AcessoriasClient:
    base_url: Optional[str] = None
    rate_budget: Optional[int] = None
    session: requests.Session = field(init=False)
    sleep_seconds: float = field(init=False)
    _last_request_at: float = field(default=0.0, init=False, repr=False)

    def __post_init__(self) -> None:
        token = os.getenv("ACESSORIAS_TOKEN")
        if not token:
            raise RuntimeError("ACESSORIAS_TOKEN não definido no .env")

        base = self.base_url or os.getenv("ACESSORIAS_BASE_URL") or "https://api.acessorias.com"
        self.base_url = base.rstrip("/") + "/"

        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token.strip()}",
                "Accept": "application/json",
                "User-Agent": "gestor-neto-contabilidade/1.0",
            }
        )

        budget = _default_rate_budget(self.rate_budget)
        self.sleep_seconds = max(0.2, 60.0 / float(budget))

    # ------------------------------------------------------------------
    def _throttle(self) -> None:
        elapsed = time.time() - self._last_request_at
        if elapsed < self.sleep_seconds:
            time.sleep(self.sleep_seconds - elapsed)

    # ------------------------------------------------------------------
    def _request(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        method: str = "GET",
        retries: int = 8,
        timeout: int = 30,
    ) -> Any:
        url = self.base_url.rstrip("/") + "/" + path.lstrip("/")
        last_status = None
        last_text = None
        last_exc: Optional[Exception] = None

        for attempt in range(1, retries + 1):
            self._throttle()
            try:
                self._last_request_at = time.time()
                if method.upper() == "GET":
                    response = self.session.get(url, params=params, timeout=timeout)
                else:
                    response = self.session.request(method.upper(), url, json=params, timeout=timeout)

                last_status = response.status_code
                content_type = response.headers.get("Content-Type", "")
                body_excerpt = response.text[:400] if response.text else ""
                last_text = body_excerpt

                log(
                    "acessorias_client",
                    "DEBUG",
                    "http_response",
                    url=url,
                    status=response.status_code,
                    body_excerpt=body_excerpt,
                )

                if 200 <= response.status_code < 300:
                    if response.status_code == 204:
                        log(
                            "acessorias_client",
                            "INFO",
                            "http_no_content",
                            url=url,
                            params=params,
                        )
                        return []
                    if "application/json" in content_type.lower():
                        return response.json()
                    try:
                        return response.json()
                    except Exception:
                        return {"raw": body_excerpt}

                if response.status_code in (401, 403):
                    raise RuntimeError(f"HTTP {response.status_code}. Verifique ACESSORIAS_TOKEN.")
                if response.status_code == 404:
                    raise RuntimeError(f"HTTP 404. Rota não encontrada: {url}")
                if response.status_code == 429:
                    retry_after_header = response.headers.get("Retry-After")
                    wait: float
                    if retry_after_header:
                        try:
                            wait = float(retry_after_header)
                        except (TypeError, ValueError):
                            wait = 2 ** attempt + random.uniform(0, 1.0)
                    else:
                        wait = 2 ** attempt + random.uniform(0, 1.0)
                    # CODEx: honra Retry-After e orçamento configurado para backoff do rate limit.
                    log(
                        "acessorias_client",
                        "WARNING",
                        "http_rate_limited",
                        url=url,
                        status=response.status_code,
                        retry_after=retry_after_header,
                    )
                    LOG.warning(
                        "429 rate limit. Aguardando %.2fs (tentativa %d/%d) - %s",
                        wait,
                        attempt,
                        retries,
                        url,
                    )
                    time.sleep(wait)
                    continue

                if 500 <= response.status_code < 600:
                    wait = 2 ** attempt + random.uniform(0, 1.0)
                    log(
                        "acessorias_client",
                        "ERROR",
                        "http_server_error",
                        url=url,
                        status=response.status_code,
                        body_excerpt=body_excerpt,
                    )
                    LOG.error(
                        "API retornou %s. Retry em %.2fs (tentativa %d/%d). Resp: %s",
                        response.status_code,
                        wait,
                        attempt,
                        retries,
                        body_excerpt,
                    )
                    time.sleep(wait)
                    continue

                raise RuntimeError(
                    f"HTTP {response.status_code}. URL={url}. Body[:200]={body_excerpt[:200]!r}"
                )

            except requests.RequestException as exc:
                last_exc = exc
                wait = 2 ** attempt + random.uniform(0, 1.0)
                LOG.warning(
                    "Exceção de rede (%s). Retry em %.2fs (tentativa %d/%d) - %s",
                    exc.__class__.__name__,
                    wait,
                    attempt,
                    retries,
                    url,
                )
                time.sleep(wait)
                continue

        details = f"status={last_status}, body[:200]={repr((last_text or '')[:200])}, url={url}"
        if last_exc:
            details += f", err={last_exc.__class__.__name__}: {last_exc}"
        raise RuntimeError(f"Falha ao contactar API após múltiplas tentativas | {details}")

    # ------------------------------------------------------------------
    def _normalize_records(self, payload: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            data = normalization.normalize_structure(raw)
            for key in list(data.keys()):
                if key.lower() in {"cnpj", "cnpjcpf", "cnpj_cpf"}:
                    data[key] = _clean_digits(str(data[key]))
            normalized.append(data)
        return normalized

    # ------------------------------------------------------------------
    def list_processes(
        self,
        page: int,
        *,
        status: Optional[str] = None,
        include_steps: bool = False,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        allowed_filters = {
            "ProcStatus",
            "ProcNome",
            "ProcInicioIni",
            "ProcInicioFim",
            "ProcConclusaoIni",
            "ProcConclusaoFim",
            "DtLastDH",
        }
        params: Dict[str, Any] = {"Pagina": page}
        if status:
            params["ProcStatus"] = status
        for key, value in (filters or {}).items():
            if key in allowed_filters and value not in (None, ""):
                params[key] = value

        path = "processes/ListAll*" if include_steps else "processes/ListAll"
        payload = self._request(path, params)
        if not payload:
            return []

        if isinstance(payload, dict) and "items" in payload:
            records = list(payload.get("items") or [])
        elif isinstance(payload, dict):
            records = [payload]
        else:
            records = list(payload)
        return self._normalize_records(records)

    # ------------------------------------------------------------------
    def get_process(self, proc_id: str, include_steps: bool = False) -> Dict[str, Any]:
        variants = [
            f"processes/{proc_id}{'*' if include_steps else ''}",
            f"processes/{proc_id}{'*' if include_steps else ''}/",
        ]
        for path in variants:
            data = self._request(path)
            if not data:
                continue
            if isinstance(data, list) and data:
                return self._normalize_records([data[0]])[0]
            if isinstance(data, dict):
                normalized = self._normalize_records([data])
                if normalized:
                    return normalized[0]
        raise RuntimeError(f"Processo {proc_id} não encontrado na rota /processes")

    # ------------------------------------------------------------------
    def list_companies(self, page: int, identificador: str = "ListAll") -> List[Dict[str, Any]]:
        params = {"Pagina": page, "obligations": ""}
        path = f"companies/{identificador}/"
        payload = self._request(path, params)
        if not payload:
            return []
        if isinstance(payload, dict) and "items" in payload:
            records = list(payload.get("items") or [])
        elif isinstance(payload, dict):
            records = [payload]
        else:
            records = list(payload)
        return self._normalize_records(records)

    # ------------------------------------------------------------------
    def list_deliveries_listall(
        self,
        dt_initial: str,
        dt_final: str,
        dt_last_dh: str,
        page: int,
        include_config: bool = False,
    ) -> List[Dict[str, Any]]:
        _validate_dt_last_dh(dt_last_dh)
        params: Dict[str, Any] = {
            "DtInitial": dt_initial,
            "DtFinal": dt_final,
            "DtLastDH": dt_last_dh,
            "Pagina": page,
        }
        if include_config:
            params["config"] = ""
        payload = self._request("deliveries/ListAll/", params)
        if not payload:
            return []
        records = list(payload) if isinstance(payload, list) else [payload]
        normalized = self._normalize_records(records)
        for record in normalized:
            for key in list(record.keys()):
                if key.lower().startswith("entdt"):
                    value = record[key]
                    if isinstance(value, str):
                        record[key] = normalization.normalize_string(value)
        return normalized

    # ------------------------------------------------------------------
    def list_deliveries_by_cnpj(
        self,
        cnpj: str,
        dt_initial: str,
        dt_final: str,
        page: int,
        include_config: bool = False,
    ) -> List[Dict[str, Any]]:
        clean = _clean_digits(cnpj) or cnpj
        params: Dict[str, Any] = {
            "DtInitial": dt_initial,
            "DtFinal": dt_final,
            "Pagina": page,
        }
        if include_config:
            params["config"] = ""
        payload = self._request(f"deliveries/{clean}/", params)
        if not payload:
            return []
        records = list(payload) if isinstance(payload, list) else [payload]
        normalized = self._normalize_records(records)
        # CODEx: coleta histórica por CNPJ sem DtLastDH para preencher dashboards.
        for record in normalized:
            for key in list(record.keys()):
                if key.lower().startswith("entdt"):
                    value = record[key]
                    if isinstance(value, str):
                        record[key] = normalization.normalize_string(value)
        return normalized
