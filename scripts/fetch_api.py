# -*- coding: utf-8 -*-
"""
Busca incremental de processos na API do Acessórias e salva snapshots em data/raw_api
e um agregado em data/api_processes.json

Requer:
- .env com ACESSORIAS_TOKEN e TZ
- scripts/config.json com base_url, endpoints, proc_status e dt_last_dh (opcional)
"""
import json, os, time, sys, math
from datetime import datetime
from typing import Dict, Any, List, Optional
import requests

from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW_API = DATA / "raw_api"
CONFIG_PATH = ROOT / "scripts" / "config.json"

def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_config(cfg: Dict[str, Any]) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

def ensure_dirs():
    DATA.mkdir(exist_ok=True)
    RAW_API.mkdir(exist_ok=True)

def auth_header(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}

def list_processes(base_url: str, token: str, status_codes: str, page_size: int, dt_last_dh: Optional[str]) -> List[Dict[str, Any]]:
    """
    Percorre páginas de /processes/ListAll (usando {ProcID}* com filtros) até esgotar.
    Como a doc expõe '/processes/{ProcID}*/?Pagina=1', adotamos 'ListAll' implicitamente: usar coringa '*' sem ID específico.
    """
    results: List[Dict[str, Any]] = []
    pagina = 1
    headers = auth_header(token)
    while True:
        params = {"Pagina": pagina}
        if status_codes:
            params["ProcStatus"] = status_codes
        if dt_last_dh:
            params["DtLastDH"] = dt_last_dh
        url = f"{base_url}/processes/ListAll*"
        r = requests.get(url, headers=headers, params=params, timeout=60)
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code} - {r.text}")
        page = r.json()
        if not isinstance(page, list):
            raise RuntimeError("Resposta inesperada em ListAll* (esperado array JSON)")
        if not page:
            break
        # snapshot por página (debug)
        (RAW_API / f"list_{pagina:04d}.json").write_text(json.dumps(page, ensure_ascii=False, indent=2), encoding="utf-8")
        results.extend(page)
        pagina += 1
    return results

def get_process_detail(base_url: str, token: str, proc_id: str) -> Dict[str, Any]:
    headers = auth_header(token)
    url = f"{base_url}/processes/{proc_id}*/"
    r = requests.get(url, headers=headers, params={"Pagina": 1}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"Detalhe {proc_id}: HTTP {r.status_code} - {r.text}")
    arr = r.json()
    if not isinstance(arr, list) or not arr:
        return {"ProcID": proc_id, "detail": None}
    # Alguns backends retornam lista com um item
    return arr[0]

def main():
    load_dotenv()
    ensure_dirs()
    cfg = load_config()
    token = os.getenv("ACESSORIAS_TOKEN")
    if not token:
        raise RuntimeError("Faltou ACESSORIAS_TOKEN no .env")
    base = cfg["acessorias"]["base_url"]
    status_codes = cfg["acessorias"].get("proc_status", "A,C")
    page_size = cfg["acessorias"].get("page_size", 20)  # mantido para futuro uso
    dt_last_dh = cfg["acessorias"].get("dt_last_dh")

    print(f"[fetch_api] Coletando processos (status={status_codes}, dt_last_dh={dt_last_dh})...")
    lst = list_processes(base, token, status_codes, page_size, dt_last_dh)

    # Buscar detalhes (ProcPassos) por ProcID
    enriched: List[Dict[str, Any]] = []
    for i, item in enumerate(lst, 1):
        pid = str(item.get("ProcID"))
        try:
            detail = get_process_detail(base, token, pid)
        except Exception as e:
            print(f"[fetch_api] ERRO detalhe {pid}: {e}")
            detail = {"ProcID": pid, "detail_error": str(e)}
        enriched.append(detail)
        if i % 20 == 0:
            print(f"  Detalhes {i}/{len(lst)}")

    # salvar agregado
    outpath = DATA / "api_processes.json"
    outpath.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fetch_api] OK: {outpath}")

    # Atualiza dt_last_dh para incremental (usa agora)
    now_utc = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    cfg["acessorias"]["dt_last_dh"] = now_utc
    save_config(cfg)
    print(f"[fetch_api] Atualizado dt_last_dh -> {now_utc}")

if __name__ == "__main__":
    main()
