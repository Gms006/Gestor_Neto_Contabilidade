# scripts/acessorias_client.py
"""Unified HTTP client for the Acessórias API."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin
import json
import os
import time
import random
import logging

import requests

from scripts.utils.logger import log
from scripts.utils import normalization

LOG = logging.getLogger("acessorias_client")

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
        # garante barra final
        self.base_url = (
            (self.base_url or os.getenv("ACESSORIAS_BASE_URL") or "https://api.acessorias.com")
            .rstrip("/")
            + "/"
        )
        self.session = requests.Session()
        # HEADERS CANÔNICOS
        self.session.headers.update({
            "Authorization": f"Bearer {token.strip()}",
            "Accept": "application/json",
            "User-Agent": "gestor-neto-contabilidade/1.0",
        })
        # rate limit (mínimo 0.2s entre chamadas)
        budget = self.rate_budget if self.rate_budget else 1
        self.sleep_seconds = max(0.2, 60.0 / float(budget))

    # ------------------------------------------------------------------
    def _request(
        self,
        path: str,
        params: dict | None = None,
        method: str = "GET",
        retries: int = 4,
        timeout: int = 30,
    ) -> Any:
        """Request robusto com backoff, tratamento de erros e diagnóstico.

        Observação: usa os headers da sessão HTTP configurada em __post_init__.
        """
        url = (self.base_url.rstrip("/") + "/" + path.lstrip("/"))
        last_status = None
        last_text = None
        last_exc = None

        for attempt in range(1, retries + 1):
            try:
                if method.upper() == "GET":
                    r = self.session.get(url, params=params, timeout=timeout)
                else:
                    r = self.session.post(url, json=params, timeout=timeout)

                last_status = r.status_code
                ct = (r.headers.get("Content-Type") or "")
                body_excerpt = r.text[:400] if r.text else ""
                last_text = body_excerpt

                # Sucesso direto
                if 200 <= r.status_code < 300:
                    if "application/json" in ct.lower():
                        return r.json()
                    # se não vier JSON, tenta mesmo assim
                    try:
                        return r.json()
                    except Exception:
                        return {"raw": body_excerpt}

                # Tratamentos específicos
                if r.status_code in (401, 403):
                    raise RuntimeError(f"HTTP {r.status_code} (auth). Verifique ACESSORIAS_TOKEN.")
                if r.status_code == 404:
                    raise RuntimeError(f"HTTP 404 (endpoint/identificador). URL={url}")
                if r.status_code == 429:
                    retry_after = r.headers.get("Retry-After")
                    if retry_after and str(retry_after).isdigit():
                        wait = int(retry_after)
                    else:
                        wait = 2 ** attempt + random.uniform(0, 1.0)
                    LOG.warning("429 rate limit. Aguardando %.1fs (tentativa %d/%d) - %s",
                                wait, attempt, retries, url)
                    time.sleep(wait)
                    continue

                # 5xx -> backoff exponencial
                if 500 <= r.status_code < 600:
                    wait = 2 ** attempt + random.uniform(0, 1.0)
                    LOG.warning("HTTP %s. Retry em %.1fs (tentativa %d/%d). Resp: %s",
                                r.status_code, wait, attempt, retries, body_excerpt)
                    time.sleep(wait)
                    continue

                # Demais erros
                raise RuntimeError(f"HTTP {r.status_code}. URL={url}. Body[:400]={body_excerpt!r}")

            except requests.RequestException as e:
                last_exc = e
                wait = 2 ** attempt + random.uniform(0, 1.0)
                LOG.warning("Exceção de rede (%s). Retry em %.1fs (tentativa %d/%d) - %s",
                            e.__class__.__name__, wait, attempt, retries, url)
                time.sleep(wait)
                continue

        # esgotou tentativas
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
                    data[key] = _clean_cnpj(str(data[key]))
            normalized.append(data)
        return normalized

    # ------------------------------------------------------------------
    def list_processes(
        self,
        statuses: Optional[Iterable[str]] = None,
        dt_last_dh: Optional[str] = None,
        page_size: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Varre /processes/ListAll paginando (?Pagina=, ?PageSize=) e,
        se informado, filtra por ProcStatus e DtLastDH (quando suportado).
        """
        values = [s for s in (statuses or []) if s]
        if not statuses or statuses == []:
            values = [None]  # ALL

        results: List[Dict[str, Any]] = []
        for status in values:
            page = 1
            while True:
                params: Dict[str, Any] = {"Pagina": page, "PageSize": page_size or self.page_size}
                if status:
                    params["ProcStatus"] = status
                if dt_last_dh:
                    params["DtLastDH"] = dt_last_dh

                # Prioriza o canônico; mantém fallbacks
                path_options = [
                    "/processes/ListAll",    # canônico
                    "/processes/ListAll/",   # barra final
                    "/processes/ListAll*/",  # variante legada (se existir)
                ]

                data = None
                used_path = None
                for path in path_options:
                    payload = self._request(path, params)
                    if payload is None:
                        continue
                    data = payload
                    used_path = path
                    break

                if used_path:
                    log(
                        "acessorias_client",
                        "DEBUG",
                        "process_endpoint",
                        status=status or "ALL",
                        page=page,
                        path=used_path,
                    )

                if data is None:
                    raise RuntimeError("Endpoints de processes não disponíveis (/processes/ListAll)")

                if not data:
                    break

                # aceita list direto ou dict com "items"
                if isinstance(data, dict) and "items" in data:
                    page_records = list(data.get("items") or [])
                elif isinstance(data, dict):
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
        variants = [f"/processes/{proc_id}", f"/processes/{proc_id}/", f"/processes/{proc_id}*/"]
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
            log("acessorias_client", "ERROR", "ListAll exige DtLastDH")
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

            payload = self._request(f"/deliveries/{identificador}/", params)
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
            log(
                "acessorias_client",
                "DEBUG",
                "deliveries_page",
                identificador=identificador,
                page=page,
                count=len(normalized),
            )
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

            payload = self._request(f"/companies/{identificador}/", params)
            if payload is None:
                payload = self._request(f"/companies/{identificador}", params)
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
