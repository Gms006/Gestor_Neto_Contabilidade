"""Generate API events from processes and deliveries."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
API_FILE = DATA / "api_processes.json"
DELIVERIES_FILE = DATA / "deliveries_raw.json"
EVENTS_API = DATA / "events_api.json"
RULES_PATH = ROOT / "scripts" / "rules.json"


def load_json(p: Path) -> Any:
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))


def match_rule(name: str, rules: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    low = (name or "").lower()
    for rule in rules:
        needle = rule.get("contains", "").lower()
        if needle and needle in low:
            return rule
    return None


def to_date_iso(br_date: Optional[str]) -> Optional[str]:
    if not br_date:
        return None
    try:
        if "T" in br_date and len(br_date) >= 10:
            return br_date[:10]
        if " " in br_date:
            parsed = datetime.strptime(br_date, "%Y-%m-%d %H:%M:%S")
            return parsed.strftime("%Y-%m-%d")
        if "/" in br_date:
            parsed = datetime.strptime(br_date, "%d/%m/%Y")
            return parsed.strftime("%Y-%m-%d")
        if len(br_date) >= 10:
            return br_date[:10]
    except ValueError:
        try:
            parsed = datetime.fromisoformat(br_date)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            return None
    return None


def competence_from_date(date_iso: Optional[str]) -> Optional[str]:
    if not date_iso:
        return None
    return date_iso[:7]


def flatten_proc(proc: Dict[str, Any], rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    pid = str(proc.get("ProcID") or proc.get("ProcId") or "")
    emp = proc.get("EmpNome") or proc.get("Empresa")
    cnpj = proc.get("EmpCNPJ") or proc.get("CNPJ")
    regime = proc.get("ProcDepartamento") or proc.get("Departamento") or ""
    passos = proc.get("ProcPassos") or []

    def walk(items: Iterable[Dict[str, Any]]):
        for item in items:
            nome = item.get("Nome") or item.get("Descricao") or ""
            status_passo = item.get("Status")
            autom = item.get("Automacao") or item.get("AutomacaoEntrega")
            bloqueante = None
            prazo = None
            responsavel = None
            nome_chk = nome

            if isinstance(autom, dict):
                bloqueante = autom.get("Bloqueante")
                entrega = autom.get("Entrega")
                if isinstance(entrega, dict):
                    prazo = entrega.get("Prazo") or entrega.get("EntregaPrazo")
                    responsavel = entrega.get("Responsavel")
                    nome_entrega = entrega.get("Nome") or ""
                    if nome_entrega:
                        nome_chk = f"{nome} | {nome_entrega}"
            rule = match_rule(nome_chk, rules)
            if rule:
                evt = {
                    "source": "api",
                    "categoria": "process_step",
                    "proc_id": pid,
                    "empresa": emp,
                    "cnpj": cnpj,
                    "regime": regime,
                    "subtipo": rule.get("subtipo"),
                    "status": rule.get("status"),
                    "responsavel": responsavel,
                    "prazo": to_date_iso(prazo),
                    "data_evento": to_date_iso(proc.get("ProcConclusao") or proc.get("ProcInicio")),
                    "competencia": None,
                    "passo_status": status_passo,
                    "bloqueante": str(bloqueante).lower() == "sim",
                }
                if evt["prazo"]:
                    evt["competencia"] = competence_from_date(evt["prazo"])
                elif evt["data_evento"]:
                    evt["competencia"] = competence_from_date(evt["data_evento"])
                out.append(evt)

            sub = item.get("ProcPassos")
            if isinstance(sub, list) and sub:
                walk(sub)

    walk(passos)
    return out


def delivery_events(deliveries: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for delivery in deliveries:
        if not isinstance(delivery, dict):
            continue
        empresa = delivery.get("Empresa") or delivery.get("EmpNome") or delivery.get("empresa")
        cnpj = delivery.get("CNPJ") or delivery.get("EmpCNPJ") or delivery.get("cnpj")
        proc_id = delivery.get("ProcID") or delivery.get("proc_id")
        subtipo = (
            delivery.get("Obrigacao")
            or delivery.get("Obligation")
            or delivery.get("Descricao")
            or delivery.get("Nome")
        )
        prazo = delivery.get("EntDtPrazo") or delivery.get("Prazo")
        entrega = delivery.get("EntDtEntrega") or delivery.get("Entrega")
        atraso = delivery.get("EntDtAtraso")
        competencia = delivery.get("Competencia") or delivery.get("competencia")
        responsavel = delivery.get("Responsavel") or delivery.get("EntResponsavel")
        status_text = str(
            delivery.get("EntStatus")
            or delivery.get("Status")
            or delivery.get("status")
            or ""
        ).lower()
        if entrega:
            status = "Entregue"
        elif "atras" in status_text or atraso:
            status = "Atrasada"
        elif "disp" in status_text:
            status = "Dispensada"
        elif "pend" in status_text:
            status = "Pendente"
        else:
            status = "Pendente"
        event = {
            "source": "api",
            "categoria": "obrigacao",
            "proc_id": proc_id,
            "empresa": empresa,
            "cnpj": cnpj,
            "subtipo": subtipo,
            "status": status,
            "prazo": to_date_iso(prazo),
            "entrega": to_date_iso(entrega),
            "competencia": competencia or competence_from_date(to_date_iso(prazo)),
            "responsavel": responsavel,
        }
        if atraso and not event["entrega"]:
            event["atraso"] = to_date_iso(atraso)
        events.append(event)
    return events


def main() -> None:
    processes = load_json(API_FILE)
    deliveries = load_json(DELIVERIES_FILE)
    rules = load_json(RULES_PATH).get("matchers", [])

    log("flatten_steps", "INFO", "Processando processos", count=len(processes))
    all_events: List[Dict[str, Any]] = []
    for proc in processes:
        if isinstance(proc, dict):
            all_events.extend(flatten_proc(proc, rules))

    log("flatten_steps", "INFO", "Eventos de passos", total=len(all_events))

    delivery_evts = delivery_events(deliveries)
    log("flatten_steps", "INFO", "Eventos de deliveries", total=len(delivery_evts))
    all_events.extend(delivery_evts)

    EVENTS_API.write_text(json.dumps(all_events, ensure_ascii=False, indent=2), encoding="utf-8")
    log("flatten_steps", "INFO", "Salvo events_api.json", total=len(all_events))


if __name__ == "__main__":
    main()
