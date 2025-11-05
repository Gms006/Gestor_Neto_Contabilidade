# -*- coding: utf-8 -*-
"""
Achata ProcPassos (recursivo) aplicando regras de rules.json e gera data/events_api.json
Também preserva prazo, responsável, status do passo e bloqueante.
"""
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
API_FILE = DATA / "api_processes.json"
EVENTS_API = DATA / "events_api.json"
RULES_PATH = ROOT / "scripts" / "rules.json"

def load_json(p: Path):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def match_rule(name: str, rules: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    low = (name or "").lower()
    for r in rules:
        if r.get("contains", "").lower() in low:
            return r
    return None

def to_date_iso(br_date: Optional[str]) -> Optional[str]:
    # aceita "dd/mm/aaaa" e "dd/mm/aaaa HH:MM:SS"
    if not br_date:
        return None
    try:
        if " " in br_date:
            d = datetime.strptime(br_date, "%d/%m/%Y %H:%M:%S")
        else:
            d = datetime.strptime(br_date, "%d/%m/%Y")
        return d.strftime("%Y-%m-%d")
    except Exception:
        return None

def competence_from_date(date_iso: Optional[str]) -> Optional[str]:
    if not date_iso:
        return None
    return date_iso[:7]

def flatten_proc(proc: Dict[str, Any], rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    pid = str(proc.get("ProcID") or proc.get("ProcId") or "")
    emp = proc.get("EmpNome")
    cnpj = proc.get("EmpCNPJ")
    regime = proc.get("ProcDepartamento") or ""  # campo aproximado; ajuste se necessário

    passos = proc.get("ProcPassos") or []
    stack = [(None, passos)]

    def walk(items: List[Dict[str, Any]]):
        for it in items:
            nome = it.get("Nome") or it.get("Descricao") or ""
            status_passo = it.get("Status")  # "OK" / "Pendente" etc.
            autom = it.get("Automacao")
            bloqueante = None
            prazo = None
            responsavel = None

            # Automacao pode ser dict (Entrega) ou lista (desdobramento)
            if isinstance(autom, dict):
                bloqueante = autom.get("Bloqueante")
                entrega = autom.get("Entrega")
                if isinstance(entrega, dict):
                    prazo = entrega.get("Prazo")
                    responsavel = entrega.get("Responsavel")
                    nome_entrega = entrega.get("Nome") or ""
                    nome_chk = f"{nome} | {nome_entrega}"
                else:
                    nome_chk = nome
            else:
                nome_chk = nome

            rule = match_rule(nome_chk, rules)
            if rule:
                evt = {
                    "source": "api",
                    "proc_id": pid,
                    "empresa": emp,
                    "cnpj": cnpj,
                    "regime": regime,
                    "atividade": None,
                    "categoria": rule["categoria"],
                    "subtipo": rule.get("subtipo"),
                    "status": rule.get("status"),
                    "responsavel": responsavel,
                    "prazo": to_date_iso(prazo),
                    "data_evento": to_date_iso(proc.get("ProcConclusao")) or to_date_iso(proc.get("ProcInicio")),
                    "competencia": None,
                    "passo_status": status_passo,
                    "bloqueante": True if str(bloqueante).lower() == "sim" else False
                }
                if evt["prazo"]:
                    evt["competencia"] = competence_from_date(evt["prazo"])
                elif evt["data_evento"]:
                    evt["competencia"] = competence_from_date(evt["data_evento"])
                out.append(evt)

            # Sub-passos?
            sub = it.get("ProcPassos")
            if isinstance(sub, list) and sub:
                walk(sub)

    walk(passos)
    return out

def main():
    api = load_json(API_FILE)
    rules = load_json(RULES_PATH)["matchers"]
    all_events: List[Dict[str, Any]] = []
    for proc in api:
        if isinstance(proc, dict):
            evs = flatten_proc(proc, rules)
            all_events.extend(evs)
    EVENTS_API.write_text(json.dumps(all_events, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[flatten_steps] OK: {EVENTS_API}")

if __name__ == "__main__":
    main()
