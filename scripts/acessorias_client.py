"""HTTP client for the Acessórias API with resilience helpers."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import os
import random
import time
from typing import Any, Dict, Iterable, List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from scripts.utils.logger import get_logger, log

LOG = get_logger("acessorias")


def _normalize_cnpj(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return digits or None


def _ensure_list(value: Optional[Iterable[str] | str]) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    return [str(item) for item in value]


def _coerce_datetime(dt: Optional[datetime | str]) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    text = str(dt).strip()
    if len(text) == 10:
        return f"{text} 00:00:00"
    return text


@dataclass
class AcessoriasClient:
    """Pequeno wrapper sobre requests para lidar com rate-limit/backoff."""

    base_url: Optional[str] = None
    rate_budget: int = 90
    connect_timeout: float = 10.0
    read_timeout: float = 30.0
    session: requests.Session = field(init=False)
    sleep_seconds: float = field(init=False)

    def __post_init__(self) -> None:
        token = (os.getenv("ACESSORIAS_TOKEN") or "").strip()
        if not token:
            raise RuntimeError("ACESSORIAS_TOKEN não definido no .env")

        base_env = os.getenv("ACESSORIAS_BASE_URL") or "https://api.acessorias.com"
        self.base_url = (self.base_url or base_env).rstrip("/") + "/"

        budget_env = os.getenv("ACESSORIAS_RATE_BUDGET")
        if budget_env:
            try:
                self.rate_budget = max(1, int(budget_env))
            except ValueError:
                pass

        self.sleep_seconds = max(0.2, 60.0 / float(self.rate_budget or 60))

        connect_env = os.getenv("ACESSORIAS_CONNECT_TIMEOUT")
        read_env = os.getenv("ACESSORIAS_READ_TIMEOUT")
        if connect_env:
            try:
                self.connect_timeout = float(connect_env)
            except ValueError:
                pass
        if read_env:
            try:
                self.read_timeout = float(read_env)
            except ValueError:
                pass

        retry_strategy = Retry(
            total=3,
            connect=3,
            read=0,
            status=0,
            backoff_factor=0,
            allowed_methods=None,
            raise_on_status=False,
        )

        self.session = requests.Session()
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "gestor-neto-contabilidade/1.0",
            }
        )

    # ------------------------------------------------------------------
    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        timeout = (self.connect_timeout, self.read_timeout)
        attempt = 0
        last_error: Optional[str] = None

        while attempt < 7:
            attempt += 1
            try:
                if method.upper() == "GET":
                    response = self.session.get(url, params=params, timeout=timeout)
                else:
                    response = self.session.post(url, json=params, timeout=timeout)

                status = response.status_code
                body_excerpt = (response.text or "")[:400]
                log(
                    "acessorias_client",
                    "DEBUG",
                    "http_response",
                    url=url,
                    status=status,
                    params=params,
                )

                if 200 <= status < 300:
                    if not response.content:
                        return []
                    try:
                        return response.json()
                    except ValueError:
                        return response.text

                if status in (401, 403):
                    raise RuntimeError("Token inválido ou sem permissão na API da Acessórias")

                if status == 404:
                    raise RuntimeError(f"Endpoint não encontrado: {url}")

                if status == 429:
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            wait = float(retry_after)
                        except ValueError:
                            wait = 2 ** attempt + random.uniform(0, 0.5)
                    else:
                        wait = 2 ** attempt + random.uniform(0, 0.5)
                    LOG.warning(
                        "429 recebido. Aguardando %.1fs (tentativa %d/7)",
                        wait,
                        attempt,
                    )
                    time.sleep(wait)
                    continue

                if 500 <= status < 600:
                    wait = 2 ** attempt + random.uniform(0, 0.5)
                    LOG.warning(
                        "API respondeu %s. Nova tentativa em %.1fs (tentativa %d/7)",
                        status,
                        wait,
                        attempt,
                    )
                    time.sleep(wait)
                    continue

                last_error = f"HTTP {status}: {body_excerpt}"
                break

            except requests.RequestException as exc:
                last_error = str(exc)
                wait = 2 ** attempt + random.uniform(0, 0.5)
                LOG.warning(
                    "Erro de rede %s. Retry em %.1fs (tentativa %d/7)",
                    exc.__class__.__name__,
                    wait,
                    attempt,
                )
                time.sleep(wait)

        raise RuntimeError(f"Falha ao contactar API após múltiplas tentativas | {last_error}")

    # ------------------------------------------------------------------
    def list_processes(
        self,
        *,
        status: Optional[Iterable[str] | str] = None,
        page: int = 1,
        per_page: int = 100,
        dt_last_dh: Optional[datetime | str] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        statuses = _ensure_list(status) or [None]
        dt_param = _coerce_datetime(dt_last_dh)

        allowed_filters = {
            "ProcNome",
            "ProcInicioIni",
            "ProcInicioFim",
            "ProcConclusaoIni",
            "ProcConclusaoFim",
        }

        filters = filters or {}
        safe_filters = {k: v for k, v in filters.items() if k in allowed_filters and v}
        if dt_param:
            safe_filters["DtLastDH"] = dt_param

        results: List[Dict[str, Any]] = []
        for status_value in statuses:
            current_page = page
            while True:
                params = {"Pagina": current_page, "Registros": per_page, **safe_filters}
                if status_value:
                    params["ProcStatus"] = status_value

                payload = self._request("GET", "processes/ListAll", params)
                if not payload:
                    if current_page == page:
                        log(
                            "acessorias_client",
                            "INFO",
                            "processes_empty",
                            status=status_value or "ALL",
                            filters=params,
                        )
                    break

                if isinstance(payload, dict) and "items" in payload:
                    page_items = list(payload.get("items") or [])
                elif isinstance(payload, dict):
                    page_items = [payload]
                else:
                    page_items = list(payload)

                if not page_items:
                    break

                results.extend(self._normalize_records(page_items))
                log(
                    "acessorias_client",
                    "DEBUG",
                    "processes_page",
                    status=status_value or "ALL",
                    page=current_page,
                    count=len(page_items),
                )

                if len(page_items) < per_page:
                    break

                current_page += 1
                time.sleep(self.sleep_seconds)

        return results

    # ------------------------------------------------------------------
    def list_deliveries(
        self,
        *,
        identificador: str = "ListAll",
        page: int = 1,
        per_page: int = 100,
        dt_last_dh: Optional[datetime | str] = None,
        dt_initial: Optional[str] = None,
        dt_final: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"Pagina": page, "Registros": per_page}
        if dt_initial:
            params["DtInitial"] = dt_initial
        if dt_final:
            params["DtFinal"] = dt_final
        if dt_last_dh:
            params["DtLastDH"] = _coerce_datetime(dt_last_dh)
        params["config"] = ""

        payload = self._request("GET", f"deliveries/{identificador}/", params)
        if not payload:
            return []

        if isinstance(payload, dict) and "items" in payload:
            items = list(payload.get("items") or [])
        elif isinstance(payload, dict):
            items = [payload]
        else:
            items = list(payload)

        return self._normalize_records(items)

    # ------------------------------------------------------------------
    def deliveries_by_cnpj(
        self,
        *,
        cnpj: str,
        page: int = 1,
        per_page: int = 100,
        dt_initial: Optional[str] = None,
        dt_final: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        cleaned = _normalize_cnpj(cnpj)
        if not cleaned:
            raise ValueError("CNPJ inválido para deliveries_by_cnpj")

        params: Dict[str, Any] = {"Pagina": page, "Registros": per_page}
        if dt_initial:
            params["DtInitial"] = dt_initial
        if dt_final:
            params["DtFinal"] = dt_final

        payload = self._request("GET", f"deliveries/{cleaned}", params)
        if not payload:
            return []

        if isinstance(payload, dict) and "items" in payload:
            items = list(payload.get("items") or [])
        elif isinstance(payload, dict):
            items = [payload]
        else:
            items = list(payload)

        return self._normalize_records(items)

    # ------------------------------------------------------------------
    def list_companies_obligations(
        self,
        *,
        identificador: str = "ListAll",
        page: int = 1,
        per_page: int = 100,
    ) -> List[Dict[str, Any]]:
        params = {"Pagina": page, "Registros": per_page, "obligations": ""}
        payload = self._request("GET", f"companies/{identificador}/", params)
        if not payload:
            return []

        if isinstance(payload, dict) and "items" in payload:
            items = list(payload.get("items") or [])
        elif isinstance(payload, dict):
            items = [payload]
        else:
            items = list(payload)

        return self._normalize_records(items)

    # ------------------------------------------------------------------
    def _normalize_records(self, payload: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for record in payload:
            if not isinstance(record, dict):
                continue
            entry = {k: v for k, v in record.items()}
            for key, value in list(entry.items()):
                if key.lower() in {"cnpj", "cnpjcpf", "cnpj_cpf", "emp_cnpj"}:
                    entry[key] = _normalize_cnpj(str(value))
                elif isinstance(value, str):
                    entry[key] = value.strip()
            normalized.append(entry)
        return normalized

