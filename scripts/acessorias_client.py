"""Unified HTTP client for the Acessórias API."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin
import json
import os
import time

import requests

from scripts.utils.logger import log
from scripts.utils import normalization

_BACKOFF_SECONDS = [1, 2, 4, 8, 16]


def _clean_cnpj(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits or value


@dataclass
class AcessoriasClient:
    base_url: str | None = None
    page_size: int = 20
    rate_budget: int = 90

    def __post_init__(self):
        token = os.getenv("ACESSORIAS_TOKEN")
        if not token:
            raise RuntimeError("ACESSORIAS_TOKEN não definido no .env")
        self.base_url = (self.base_url or os.getenv("ACESSORIAS_BASE_URL") or "https://api.acessorias.com").rstrip("/") + "/"
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}"})
        budget = self.rate_budget if self.rate_budget else 1
        self.sleep_seconds = max(0.2, 60.0 / float(budget))

    # ------------------------------------------------------------------
    def _request(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        url = urljoin(self.base_url, path)
        params = {k: v for k, v in (params or {}).items() if v not in (None, "")}
        for attempt, backoff in enumerate(_BACKOFF_SECONDS, start=1):
            try:
                log("acessorias_client", "DEBUG", "request", url=url, params=params, attempt=attempt)
                response = self.session.get(url, params=params, timeout=90)
            except Exception as exc:  # network error
                log("acessorias_client", "ERROR", "network error", url=url, attempt=attempt, error=str(exc))
                time.sleep(backoff)
                continue

            retry_after = response.headers.get("Retry-After")
            if response.status_code in (401, 403):
                log("acessorias_client", "ERROR", "auth error", status=response.status_code)
                raise RuntimeError("Token inválido ou ausente para Acessórias (401/403)")

            if response.status_code == 404:
                log("acessorias_client", "WARNING", "endpoint 404", url=url)
                return None

            if response.status_code == 204:
                log("acessorias_client", "INFO", "endpoint 204 vazio", url=url)
                return []

            if response.status_code == 429 or response.status_code >= 500:
                delay = backoff
                if retry_after:
                    try:
                        delay = max(delay, float(retry_after))
                    except ValueError:
                        pass
                log("acessorias_client", "WARNING", "backoff", status=response.status_code, delay=delay)
                time.sleep(delay)
                continue

            try:
                response.raise_for_status()
            except requests.HTTPError as exc:  # other error
                log("acessorias_client", "ERROR", "http error", status=response.status_code, url=url, error=str(exc))
                raise

            text = response.text.strip()
            if not text:
                return []
            if text.startswith("{") or text.startswith("["):
                try:
                    data = json.loads(text)
                except json.JSONDecodeError as exc:
                    log("acessorias_client", "ERROR", "json decode", error=str(exc))
                    raise
                return data
            return []
        raise RuntimeError("Falha ao contactar API após múltiplas tentativas")

    # ------------------------------------------------------------------
    def _normalize_records(self, payload: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            data = normalization.normalize_structure(raw)
            for key in list(data.keys()):
                if key.lower() in {"cnpj", "cnpjcpf", "cnpj_cpf"}:
                    data[key] = _clean_cnpj(str(data[key]))
            normalized.append(data)
        return normalized

    # ------------------------------------------------------------------
    def list_processes(
        self,
        statuses: Optional[Iterable[str]] = None,
        dt_last_dh: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        statuses = list(statuses or [None])
        results: List[Dict[str, Any]] = []
        for status in statuses:
            page = 1
            while True:
                params: Dict[str, Any] = {"Pagina": page, "PageSize": self.page_size}
                if status:
                    params["ProcStatus"] = status
                if dt_last_dh:
                    params["DtLastDH"] = dt_last_dh
                path_options = ["processes/ListAll*/", "processes/ListAll/"]
                data = None
                for path in path_options:
                    payload = self._request(path, params)
                    if payload is None:
                        continue
                    data = payload
                    break
                if data is None:
                    raise RuntimeError("Endpoints de processes não disponíveis (ListAll*/ / ListAll/)")
                if not data:
                    break
                if isinstance(data, dict):
                    page_records = [data]
                else:
                    page_records = list(data)
                normalized = self._normalize_records(page_records)
                results.extend(normalized)
                page += 1
                time.sleep(self.sleep_seconds)
        return results

    # ------------------------------------------------------------------
    def get_process(self, proc_id: str) -> Dict[str, Any]:
        variants = [f"processes/{proc_id}*/", f"processes/{proc_id}"]
        for path in variants:
            data = self._request(path, None)
            if data is None:
                continue
            if isinstance(data, list):
                if data:
                    record = data[0]
                    return self._normalize_records([record])[0]
                return {}
            if isinstance(data, dict):
                normalized = self._normalize_records([data])
                return normalized[0] if normalized else {}
        raise RuntimeError(f"Endpoint de processo {proc_id} não disponível")

    # ------------------------------------------------------------------
    def list_deliveries(
        self,
        identificador: str,
        dt_initial: str,
        dt_final: str,
        dt_last_dh: Optional[str] = None,
        include_config: bool = True,
        page_size: int = 50,
    ) -> List[Dict[str, Any]]:
        if identificador == "ListAll" and not dt_last_dh:
            raise ValueError("DtLastDH é obrigatório quando Identificador=ListAll")
        results: List[Dict[str, Any]] = []
        page = 1
        while True:
            params: Dict[str, Any] = {
                "Pagina": page,
                "DtInitial": dt_initial,
                "DtFinal": dt_final,
                "PageSize": page_size,
            }
            if dt_last_dh:
                params["DtLastDH"] = dt_last_dh
            if include_config:
                params["config"] = ""
            payload = self._request(f"deliveries/{identificador}/", params)
            if payload is None:
                raise RuntimeError("Endpoint deliveries não disponível")
            if not payload:
                break
            if isinstance(payload, dict):
                page_records = [payload]
            else:
                page_records = list(payload)
            normalized = self._normalize_records(page_records)
            for record in normalized:
                for key in list(record.keys()):
                    if key.lower().startswith("entdt"):
                        value = record[key]
                        if isinstance(value, str):
                            record[key] = normalization.normalize_string(value)
            results.extend(normalized)
            page += 1
            time.sleep(self.sleep_seconds)
        return results

    # ------------------------------------------------------------------
    def list_companies_obligations(
        self,
        identificador: str = "ListAll",
        page_size: int = 20,
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        page = 1
        while True:
            params: Dict[str, Any] = {
                "Pagina": page,
                "PageSize": page_size,
                "obligations": "",
            }
            payload = self._request(f"companies/{identificador}/", params)
            if payload is None:
                payload = self._request(f"companies/{identificador}", params)
                if payload is None:
                    raise RuntimeError("Endpoint companies não disponível")
            if not payload:
                break
            if isinstance(payload, dict):
                page_records = [payload]
            else:
                page_records = list(payload)
            results.extend(self._normalize_records(page_records))
            page += 1
            time.sleep(self.sleep_seconds)
        return results
