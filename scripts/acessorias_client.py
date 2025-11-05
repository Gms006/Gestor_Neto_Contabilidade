# scripts/acessorias_client.py
"""Unified HTTP client for the Acessórias API."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional
import os
import time
import random
import logging
from datetime import datetime, timedelta

import requests

from scripts.utils.logger import log
from scripts.utils import normalization

LOG = logging.getLogger("acessorias_client")

_MAX_RETRIES = 7


def _clean_cnpj(value: Optional[str]) -> Optional[str]:
    if not value:
        return value
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits or value


@dataclass
class AcessoriasClient:
    base_url: str | None = None
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
        # Usa ACESSORIAS_RATE_BUDGET do .env se disponível
        budget_env = os.getenv("ACESSORIAS_RATE_BUDGET")
        if budget_env:
            try:
                self.rate_budget = int(budget_env)
            except ValueError:
                pass
        budget = self.rate_budget if self.rate_budget else 1
        self.sleep_seconds = max(0.2, 60.0 / float(budget))

    # ------------------------------------------------------------------
    def _request(
        self,
        path: str,
        params: dict | None = None,
        method: str = "GET",
        retries: int = _MAX_RETRIES,
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

                log(
                    "acessorias_client",
                    "DEBUG",
                    "http_response",
                    url=url,
                    status=r.status_code,
                    body_excerpt=body_excerpt,
                )

                # Sucesso direto
                if 200 <= r.status_code < 300:
                    if r.status_code == 204:
                        log(
                            "acessorias_client",
                            "INFO",
                            "http_no_content",
                            url=url,
                            params=params,
                        )
                        return []
                    if "application/json" in ct.lower():
                        return r.json()
                    # se não vier JSON, tenta mesmo assim
                    try:
                        return r.json()
                    except Exception:
                        return {"raw": body_excerpt}

                # Tratamentos específicos
                if r.status_code in (401, 403):
                    raise RuntimeError(
                        f"HTTP {r.status_code} (auth). Verifique ACESSORIAS_TOKEN."
                    )
                if r.status_code == 404:
                    raise RuntimeError(
                        f"HTTP 404. Rota não encontrada: {url}"
                    )
                if r.status_code == 429:
                    retry_after = r.headers.get("Retry-After")
                    wait: float
                    if retry_after:
                        try:
                            wait = float(retry_after)
                        except (TypeError, ValueError):
                            wait = 2 ** attempt + random.uniform(0, 1.0)
                    else:
                        wait = 2 ** attempt + random.uniform(0, 1.0)
                    log(
                        "acessorias_client",
                        "WARNING",
                        "http_rate_limited",
                        url=url,
                        status=r.status_code,
                        retry_after=retry_after,
                    )
                    LOG.warning(
                        "429 rate limit. Aguardando %.1fs (tentativa %d/%d) - %s",
                        wait,
                        attempt,
                        retries,
                        url,
                    )
                    time.sleep(wait)
                    continue

                # 5xx -> backoff exponencial
                if 500 <= r.status_code < 600:
                    wait = 2 ** attempt + random.uniform(0, 1.0)
                    log(
                        "acessorias_client",
                        "ERROR",
                        "http_server_error",
                        url=url,
                        status=r.status_code,
                        body_excerpt=body_excerpt,
                    )
                    LOG.error(
                        "API retornou %s. Retry em %.1fs (tentativa %d/%d). Resp: %s",
                        r.status_code,
                        wait,
                        attempt,
                        retries,
                        body_excerpt,
                    )
                    time.sleep(wait)
                    continue

                # Demais erros
                raise RuntimeError(
                    f"HTTP {r.status_code}. URL={url}. Body[:400]={body_excerpt!r}"
                )

            except requests.RequestException as e:
                last_exc = e
                wait = 2 ** attempt + random.uniform(0, 1.0)
                LOG.warning(
                    "Exceção de rede (%s). Retry em %.1fs (tentativa %d/%d) - %s",
                    e.__class__.__name__,
                    wait,
                    attempt,
                    retries,
                    url,
                )
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
        include_steps: bool = False,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Lista processos com suporte aos filtros documentados."""

        status_values = [s for s in (statuses or []) if s]
        if not status_values:
            status_values = [None]

        filters = dict(filters or {})
        allowed_filter_keys = {
            "ProcNome",
            "ProcInicioIni",
            "ProcInicioFim",
            "ProcConclusaoIni",
            "ProcConclusaoFim",
            "DtLastDH",
        }

        if dt_last_dh:
            filters["DtLastDH"] = dt_last_dh

        request_filters = {
            key: value
            for key, value in filters.items()
            if key in allowed_filter_keys and value not in (None, "")
        }

        results: List[Dict[str, Any]] = []
        path = "processes/ListAll*" if include_steps else "processes/ListAll"

        for status in status_values:
            page = 1
            while True:
                params: Dict[str, Any] = {"Pagina": page, **request_filters}
                if status:
                    params["ProcStatus"] = status

                payload = self._request(path, params)

                if payload is None:
                    raise RuntimeError("Rota /processes não retornou dados")

                if not payload:
                    if page == 1:
                        safe_filters = {
                            key: str(value)
                            for key, value in request_filters.items()
                        }
                        log(
                            "acessorias_client",
                            "INFO",
                            "processes_empty",
                            status=status or "ALL",
                            filters=safe_filters,
                        )
                    break

                if isinstance(payload, dict) and "items" in payload:
                    page_records = list(payload.get("items") or [])
                elif isinstance(payload, dict):
                    page_records = [payload]
                else:
                    page_records = list(payload)

                normalized = self._normalize_records(page_records)
                results.extend(normalized)

                log(
                    "acessorias_client",
                    "DEBUG",
                    "processes_page",
                    status=status or "ALL",
                    page=page,
                    count=len(normalized),
                    include_steps=include_steps,
                    filters={key: str(value) for key, value in request_filters.items()},
                )

                page += 1
                time.sleep(self.sleep_seconds)
        return results

    # ------------------------------------------------------------------
    def get_process(self, proc_id: str) -> Dict[str, Any]:
        variants = [
            f"processes/{proc_id}",
            f"processes/{proc_id}*",
            f"processes/{proc_id}/",
            f"processes/{proc_id}*/",
        ]
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
        raise RuntimeError(f"Processo {proc_id} não encontrado na rota /processes")

    # ------------------------------------------------------------------
    def list_deliveries(
        self,
        identificador: str,
        dt_initial: str,
        dt_final: str,
        dt_last_dh: Optional[str] = None,
        include_config: bool = True,
    ) -> List[Dict[str, Any]]:
        if identificador == "ListAll":
            if not dt_last_dh:
                log("acessorias_client", "ERROR", "ListAll exige DtLastDH")
                raise ValueError("DtLastDH é obrigatório quando Identificador=ListAll")
            try:
                normalized_last = dt_last_dh.replace("Z", "+00:00")
                dt = datetime.fromisoformat(normalized_last)
            except ValueError as exc:
                raise ValueError("DtLastDH deve estar no formato ISO YYYY-MM-DD HH:MM:SS") from exc
            today = datetime.now()
            if dt.tzinfo:
                today = datetime.now(tz=dt.tzinfo)
            if dt.date() < (today - timedelta(days=1)).date() or dt.date() > today.date():
                raise ValueError(
                    "DtLastDH para ListAll deve ser do dia atual ou anterior"
                )

        results: List[Dict[str, Any]] = []
        page = 1
        while True:
            params: Dict[str, Any] = {
                "Pagina": page,
                "DtInitial": dt_initial,
                "DtFinal": dt_final,
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
    def list_deliveries_listall(
        self,
        dt_initial: str,
        dt_final: str,
        dt_last_dh: str,
        page: int = 1,
    ) -> List[Dict[str, Any]]:
        """
        Busca deliveries via ListAll (delta hoje/ontem).
        DtLastDH é obrigatório neste endpoint.
        """
        if not dt_last_dh:
            raise ValueError("DtLastDH é obrigatório para list_deliveries_listall")
        
        results: List[Dict[str, Any]] = []
        current_page = page
        
        while True:
            params: Dict[str, Any] = {
                "Pagina": current_page,
                "DtInitial": dt_initial,
                "DtFinal": dt_final,
                "DtLastDH": dt_last_dh,
            }
            
            payload = self._request("deliveries/ListAll", params)
            if payload is None or not payload:
                break
            
            if isinstance(payload, dict):
                page_records = [payload]
            else:
                page_records = list(payload)
            
            normalized = self._normalize_records(page_records)
            results.extend(normalized)
            
            log(
                "acessorias_client",
                "DEBUG",
                "deliveries_listall_page",
                page=current_page,
                count=len(normalized),
            )
            
            current_page += 1
            time.sleep(self.sleep_seconds)
        
        return results

    # ------------------------------------------------------------------
    def list_deliveries_by_cnpj(
        self,
        cnpj: str,
        dt_initial: str,
        dt_final: str,
        page: int = 1,
    ) -> List[Dict[str, Any]]:
        """
        Busca deliveries por CNPJ (histórico).
        Não usa DtLastDH.
        """
        cnpj_clean = _clean_cnpj(cnpj)
        if not cnpj_clean:
            raise ValueError("CNPJ inválido para list_deliveries_by_cnpj")
        
        results: List[Dict[str, Any]] = []
        current_page = page
        
        while True:
            params: Dict[str, Any] = {
                "Pagina": current_page,
                "DtInitial": dt_initial,
                "DtFinal": dt_final,
            }
            
            payload = self._request(f"deliveries/{cnpj_clean}", params)
            if payload is None or not payload:
                break
            
            if isinstance(payload, dict):
                page_records = [payload]
            else:
                page_records = list(payload)
            
            normalized = self._normalize_records(page_records)
            results.extend(normalized)
            
            log(
                "acessorias_client",
                "DEBUG",
                "deliveries_by_cnpj_page",
                cnpj=cnpj_clean,
                page=current_page,
                count=len(normalized),
            )
            
            current_page += 1
            time.sleep(self.sleep_seconds)
        
        return results

    # ------------------------------------------------------------------
    def list_companies_obligations(
        self,
        identificador: str = "ListAll",
    ) -> List[Dict[str, Any]]:
        results: List[Dict[str, Any]] = []
        page = 1
        while True:
            params: Dict[str, Any] = {
                "Pagina": page,
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
