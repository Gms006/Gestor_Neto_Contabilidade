"""Collect processes from the Acessórias API and persist them locally."""
from __future__ import annotations

import argparse
import json
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

from dateutil import parser
from dotenv import load_dotenv

from scripts.acessorias_client import AcessoriasClient
from scripts.db import (
    Company,
    Process,
    init_db,
    session_scope,
    upsert_companies,
    upsert_processes,
)
from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SNAPSHOT = DATA / "api_processes.json"
SYNC_STATE = DATA / ".sync_state.json"

load_dotenv(dotenv_path=ROOT / ".env", override=True)

def ensure_dirs() -> None:
    DATA.mkdir(parents=True, exist_ok=True)


def load_sync_state() -> Dict[str, str]:
    if SYNC_STATE.exists():
        try:
            return json.loads(SYNC_STATE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log("fetch_api", "WARNING", "sync_state inválido, reiniciando")
    return {}


def save_sync_state(state: Dict[str, str]) -> None:
    SYNC_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def compute_dt_last_dh(last_value: Optional[str]) -> Optional[str]:
    if not last_value:
        return None
    try:
        dt_last = parser.isoparse(last_value)
    except (ValueError, TypeError, parser.ParserError):
        return None
    dt_last = dt_last - timedelta(minutes=5)
    dt_last = dt_last.astimezone(timezone.utc).replace(microsecond=0)
    return dt_last.strftime("%Y-%m-%d %H:%M:%S")


def deduplicate(rows: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    ordered: "OrderedDict[str, Dict[str, str]]" = OrderedDict()
    for row in rows:
        proc_id = str(row.get("ProcID") or row.get("proc_id") or "").strip()
        key = proc_id or f"idx_{len(ordered)}"
        ordered[key] = row
    return list(ordered.values())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sincroniza processos da Acessórias")
    parser.add_argument("--status", action="append", help="Filtro ProcStatus (A,C,S,D,P,W,X)")
    parser.add_argument("--include-steps", action="store_true", help="Usa ListAll* para incluir passos")
    parser.add_argument("--dt-last-dh", help="Valor customizado de DtLastDH")
    parser.add_argument("--full", action="store_true", help="Ignora estado incremental anterior")
    return parser.parse_args()


def collect_processes(
    client: AcessoriasClient,
    statuses: Iterable[Optional[str]],
    include_steps: bool,
    dt_last_dh: Optional[str],
) -> List[Dict[str, str]]:
    filters: Dict[str, str] = {}
    if dt_last_dh:
        filters["DtLastDH"] = dt_last_dh

    aggregated: List[Dict[str, str]] = []

    for status in statuses:
        page = 1
        while True:
            rows = client.list_processes(
                page=page,
                status=status,
                include_steps=include_steps,
                filters=filters,
            )
            if not rows:
                if page == 1:
                    log(
                        "fetch_api",
                        "INFO",
                        "processes_empty",
                        status=status or "ALL",
                        filters={k: str(v) for k, v in filters.items()},
                    )
                break

            log(
                "fetch_api",
                "INFO",
                "pagina_processos",
                status=status or "ALL",
                page=page,
                registros=len(rows),
            )
            aggregated.extend(rows)
            page += 1
    return deduplicate(aggregated)


def persist_processes(rows: List[Dict[str, str]]) -> None:
    if not rows:
        log("fetch_api", "INFO", "Nenhum processo para persistir")
        return

    init_db()

    with session_scope() as session:
        upserted_companies = 0
        upserted_processes = 0
        for row in rows:
            company_payload: Dict[str, str] = {}
            if row.get("ProcEmpresaNome") or row.get("EmpresaNome"):
                company_payload["nome"] = row.get("ProcEmpresaNome") or row.get("EmpresaNome") or ""
            if row.get("ProcEmpresaCNPJ") or row.get("EmpresaCNPJ"):
                company_payload["cnpj"] = row.get("ProcEmpresaCNPJ") or row.get("EmpresaCNPJ") or ""
            if company_payload.get("cnpj"):
                upsert_company_payload = {"nome": company_payload.get("nome", ""), "cnpj": company_payload["cnpj"]}
                upsert_companies(session, [upsert_company_payload])
                upserted_companies += 1

        upserted_processes = upsert_processes(session, rows)
        # CODEx: camada de persistência garante upsert atômico dentro de transaction scope.
        log(
            "fetch_api",
            "INFO",
            "processos_persistidos",
            processos=upserted_processes,
            empresas=upserted_companies,
        )


def build_snapshot() -> None:
    init_db()
    with session_scope() as session:
        processes = (
            session.query(Process)
            .outerjoin(Company, Company.id == Process.company_id)
            .order_by(Process.conclusao.desc().nullslast(), Process.inicio.desc().nullslast())
            .all()
        )

        snapshot: List[Dict[str, Optional[str]]] = []
        for proc in processes:
            snapshot.append(
                {
                    "proc_id": proc.proc_id,
                    "titulo": proc.titulo,
                    "status": proc.status,
                    "inicio": proc.inicio.isoformat() if proc.inicio else None,
                    "conclusao": proc.conclusao.isoformat() if proc.conclusao else None,
                    "dias_corridos": proc.dias_corridos,
                    "gestor": proc.gestor,
                    "company_id": proc.company_id,
                    "empresa": proc.company.nome if proc.company else None,
                    "last_dh": proc.last_dh.isoformat() if proc.last_dh else None,
                }
            )

    SNAPSHOT.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_api", "INFO", "snapshot_salvo", arquivo=str(SNAPSHOT), registros=len(snapshot))


def main() -> None:
    ensure_dirs()
    args = parse_args()

    statuses = args.status or [None]
    sync_state = load_sync_state()
    dt_last_dh = args.dt_last_dh or None
    if not dt_last_dh and not args.full:
        dt_last_dh = compute_dt_last_dh(sync_state.get("processes_dt_last_dh"))

    client = AcessoriasClient()

    log(
        "fetch_api",
        "INFO",
        "inicio_coleta",
        statuses=statuses,
        include_steps=args.include_steps,
        dt_last_dh=dt_last_dh,
    )

    rows = collect_processes(client, statuses, args.include_steps, dt_last_dh)
    persist_processes(rows)
    build_snapshot()

    now_utc = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    sync_state["processes_dt_last_dh"] = now_utc
    save_sync_state(sync_state)
    log("fetch_api", "INFO", "sync_state_atualizado", dt_last_dh=now_utc)


if __name__ == "__main__":
    main()
