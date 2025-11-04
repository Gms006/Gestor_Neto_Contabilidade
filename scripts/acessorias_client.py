"""HTTP client helpers for Acessórias API interactions."""
from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Optional

import requests


def _base() -> str:
    return os.getenv("ACESSORIAS_BASE_URL", "https://api.acessorias.com").rstrip("/")


def _rate_sleep() -> float:
    try:
        return float(os.getenv("ACESSORIAS_RATE_SLEEP", "0.7"))
    except ValueError:
        return 0.7


def _headers() -> Dict[str, str]:
    token = os.getenv("ACESSORIAS_TOKEN")
    if not token:
        raise RuntimeError("ACESSORIAS_TOKEN não definido no .env")
    return {"Authorization": f"Bearer {token}"}


def _get(url: str, params: Optional[Dict[str, Any]] = None, timeout: int = 60):
    """GET com tratamento de 204, 404 (fallback de endpoint), 429 (rate limit) e erros gerais."""
    for attempt in range(5):
        r = requests.get(url, headers=_headers(), params=params, timeout=timeout)
        if r.status_code == 429:
            time.sleep(2 + attempt)  # backoff simples
            continue
        if r.status_code == 204:
            return [], r
        if r.status_code == 404:
            return None, r  # sinaliza p/ fallback do chamador
        r.raise_for_status()
        txt = r.text.strip()
        return (
            json.loads(txt)
            if txt and (txt.startswith("[") or txt.startswith("{"))
            else []
        ), r
    r.raise_for_status()


def list_processes(status: Optional[str] = None, dt_last_dh: Optional[str] = None) -> List[Dict[str, Any]]:
    """Lista processos com fallback de endpoint e paginação.
    status: 'A' | 'C' | ... ou None para ALL
    """
    results: List[Dict[str, Any]] = []
    page = 1
    variants = ["processes/ListAll*/", "processes/ListAll/"]
    while True:
        params: Dict[str, Any] = {"Pagina": page}
        if status:
            params["ProcStatus"] = status
        if dt_last_dh:
            params["DtLastDH"] = dt_last_dh
        data = None
        for path in variants:
            url = f"{_base()}/{path}"
            data, r = _get(url, params)
            if data is None:
                # 404: tenta próximo variant
                continue
            break
        if data is None:
            # todos 404 -> erro de instalação/endpoint
            raise RuntimeError("Endpoints de processes não disponíveis (ListAll*/ / ListAll/)")
        if not data:
            break
        results.extend(data)
        page += 1
        time.sleep(_rate_sleep())
    return results


def get_process_detail(proc_id: Any) -> Dict[str, Any]:
    variants = [f"processes/{proc_id}*/", f"processes/{proc_id}*"]
    params = {"Pagina": 1}
    for path in variants:
        url = f"{_base()}/{path}"
        data, r = _get(url, params)
        if data is None:
            continue
        if isinstance(data, list):
            if data:
                first = data[0]
                if isinstance(first, dict):
                    return first
                return {"ProcID": proc_id, "payload": first}
            return {}
        if isinstance(data, dict):
            return data
    raise RuntimeError(f"Process detail not available for {proc_id}")


def list_deliveries(
    identificador: str,
    dt_ini: str,
    dt_fim: str,
    dt_last_dh: Optional[str] = None,
    include_config: bool = True,
) -> List[Dict[str, Any]]:
    """
    deliveries/{Identificador}/ com paginação.
    Se Identificador='ListAll': dt_last_dh é obrigatório (API impõe janela curta).
    """
    if identificador == "ListAll" and not dt_last_dh:
        raise ValueError("DtLastDH é obrigatório quando Identificador=ListAll para Deliveries.")
    results: List[Dict[str, Any]] = []
    page = 1
    while True:
        params: Dict[str, Any] = {"Pagina": page, "DtInitial": dt_ini, "DtFinal": dt_fim}
        if dt_last_dh:
            params["DtLastDH"] = dt_last_dh
        if include_config:
            params["config"] = ""  # ativa bloco Config
        url = f"{_base()}/deliveries/{identificador}/"
        data, r = _get(url, params)
        if data is None:
            # deliveries endpoint inexistente? Tratar como erro
            raise RuntimeError("Endpoint deliveries não disponível")
        if not data:
            break
        results.extend(data)
        page += 1
        time.sleep(_rate_sleep())
    return results


def list_companies(identificador: str = "ListAll", with_obligations: bool = False) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    page = 1
    while True:
        params: Dict[str, Any] = {"Pagina": page}
        if with_obligations:
            params["obligations"] = ""
        url = f"{_base()}/companies/{identificador}/"
        data, r = _get(url, params)
        if data is None:
            # tentar sem barra final
            url = f"{_base()}/companies/{identificador}"
            data, r = _get(url, params)
            if data is None:
                raise RuntimeError("Endpoint companies não disponível")
        if not data:
            break
        # companies retorna objeto quando Identificador != ListAll
        if isinstance(data, dict):
            return [data]
        results.extend(data)
        page += 1
        time.sleep(_rate_sleep())
    return results


def list_invoices(identificador: str = "Geral", **dates_and_filters) -> List[Dict[str, Any]]:
    """Obrigatório enviar algum intervalo de data (VIni/VFim, VOIni/VOFim, PgtoIni/PgtoFim, DtCriaIni/DtCriaFim)."""
    if not dates_and_filters:
        raise ValueError("É obrigatório informar intervalo de datas para invoices.")
    results: List[Dict[str, Any]] = []
    page = 1
    while True:
        params: Dict[str, Any] = {"Pagina": page, **dates_and_filters}
        url = f"{_base()}/invoices/{identificador}/"
        data, r = _get(url, params)
        if data is None:
            url = f"{_base()}/invoices/{identificador}"
            data, r = _get(url, params)
            if data is None:
                raise RuntimeError("Endpoint invoices não disponível")
        if not data:
            break
        results.extend(data)
        page += 1
        time.sleep(_rate_sleep())
    return results
