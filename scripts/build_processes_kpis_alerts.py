# -*- coding: utf-8 -*-
"""
A partir de data/api_processes.json e data/events.json calcula:
- processes.json (por proc_id)
- kpis.json (contagens)
- alerts.json (SN dia 20, REINF dia 15, bloqueantes)
"""
import json, os
from pathlib import Path
from typing import Any, Dict, List, Optional
from collections import defaultdict, Counter
from datetime import datetime, date

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
API_FILE = DATA / "api_processes.json"
EVENTS_FILE = DATA / "events.json"
KPI_FILE = DATA / "kpis.json"
ALERTS_FILE = DATA / "alerts.json"
PROC_OUT = DATA / "processes.json"
CONFIG = ROOT / "scripts" / "config.json"

def loadj(p: Path):
    if not p.exists(): return []
    return json.loads(p.read_text(encoding="utf-8"))

def loadcfg() -> Dict[str, Any]:
    return json.loads(CONFIG.read_text(encoding="utf-8"))

def to_iso(br_date: Optional[str]) -> Optional[str]:
    if not br_date:
        return None
    try:
        if " " in br_date:
            return datetime.strptime(br_date, "%d/%m/%Y %H:%M:%S").strftime("%Y-%m-%d")
        return datetime.strptime(br_date, "%d/%m/%Y").strftime("%Y-%m-%d")
    except Exception:
        return None

def main():
    cfg = loadcfg()
    api = loadj(API_FILE)
    events = loadj(EVENTS_FILE)
    deadlines = cfg.get("deadlines", {"sn_day":20,"reinf_day":15})
    warn = cfg.get("warning_days", {"sn":3,"reinf":3})
    today = date.today()

    # Processes: usar api_processes.json para datas e gestor
    processes: List[Dict[str, Any]] = []
    by_proc: Dict[str, Dict[str, Any]] = {}

    for proc in api:
        pid = str(proc.get("ProcID"))
        by_proc[pid] = {
            "proc_id": pid,
            "empresa": proc.get("EmpNome"),
            "cnpj": proc.get("EmpCNPJ"),
            "inicio": to_iso(proc.get("ProcInicio")),
            "conclusao": to_iso(proc.get("ProcConclusao")),
            "dias_corridos": int(str(proc.get("ProcDiasCorridos") or "0").strip() or 0),
            "status": proc.get("ProcStatus"),
            "gestor": proc.get("ProcGestor"),
            "ultimo_update": proc.get("DtLastDH")
        }

    # KPIs básicos
    entregas_por_comp = defaultdict(lambda: {"efd_reinf":{"Obrigatória":0,"Dispensada":0},
                                             "efd_contrib":{"Obrigatória":0,"Dispensada":0}})
    difal_por_tipo = Counter()
    fora_das_por_tipo = Counter()

    # Aux para alertas
    sn_em_risco = []
    reinf_em_risco = []
    bloqueantes = []

    # Percorrer eventos para KPIs e alertas
    for e in events:
        cat = e.get("categoria")
        st = e.get("status")
        comp = e.get("competencia")
        pid = str(e.get("proc_id") or "")

        if cat == "efd_reinf" and st in ("Obrigatória","Dispensada") and comp:
            entregas_por_comp[comp]["efd_reinf"][st] += 1

        if cat == "efd_contrib" and st in ("Obrigatória","Dispensada") and comp:
            entregas_por_comp[comp]["efd_contrib"][st] += 1

        if cat == "difal":
            difal_por_tipo[e.get("subtipo") or "nao_informado"] += 1

        if cat == "fora_das":
            subt = e.get("subtipo") or "NA"
            fora_das_por_tipo[subt] += 1

        # bloqueantes (da API)
        if e.get("source") == "api" and e.get("bloqueante") and (e.get("passo_status") or "").lower() != "ok":
            bloqueantes.append({
                "proc_id": pid,
                "empresa": e.get("empresa"),
                "passo_categoria": cat,
                "responsavel": e.get("responsavel"),
                "prazo": e.get("prazo")
            })

    # Alertas por prazo (SN 20, REINF 15) – heurística via competência corrente
    # Se houver eventos da competência atual que indiquem obrigatoriedade e não houver finalização/conclusão, alertar.
    today_month = today.strftime("%Y-%m")
    # REINF
    reinf_obrig = [e for e in events if e.get("categoria")=="efd_reinf" and e.get("status")=="Obrigatória" and (e.get("competencia")==today_month)]
    for e in reinf_obrig:
        # se não houver evento de finalização para o mesmo proc_id nesta competência
        has_final = any((x.get("categoria")=="finalizacao" and x.get("proc_id")==e.get("proc_id") and x.get("competencia")==today_month) for x in events)
        # janela
        if today.day >= (deadlines["reinf_day"] - warn["reinf"]) and not has_final:
            reinf_em_risco.append({
                "proc_id": e.get("proc_id"),
                "empresa": e.get("empresa"),
                "competencia": today_month,
                "prazo": f"{today.year}-{today.month:02d}-{deadlines['reinf_day']:02d}"
            })

    # SN
    sn_processos = [p for p in by_proc.values() if (p.get("status") or "").lower().startswith("em")]
    for p in sn_processos:
        if p.get("conclusao") is None and today.day >= (deadlines["sn_day"] - warn["sn"]):
            sn_em_risco.append({
                "proc_id": p["proc_id"],
                "empresa": p["empresa"],
                "prazo": f"{today.year}-{today.month:02d}-{deadlines['sn_day']:02d}"
            })

    # Montar KPIs JSON
    kpis = {
        "entregas_por_competencia": entregas_por_comp,
        "difal_por_tipo": dict(difal_por_tipo),
        "fora_das_por_tipo": dict(fora_das_por_tipo),
        "produtividade": {
            "finalizados_no_mes": sum(1 for p in by_proc.values() if (p.get("conclusao") or "").startswith(today_month)),
            "tempo_medio_finalizacao_dias": None,  # pode ser refinado com histórico
            "ranking_por_responsavel": []          # depende de responsável_final por processo
        }
    }

    # Persistir
    PROC_OUT.write_text(json.dumps(list(by_proc.values()), ensure_ascii=False, indent=2), encoding="utf-8")
    KPI_FILE.write_text(json.dumps(kpis, ensure_ascii=False, indent=2), encoding="utf-8")
    ALERTS_FILE.write_text(json.dumps({
        "sn_em_risco": sn_em_risco,
        "reinf_em_risco": reinf_em_risco,
        "bloqueantes": bloqueantes
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[build_processes_kpis_alerts] OK: {PROC_OUT}, {KPI_FILE}, {ALERTS_FILE}")

if __name__ == "__main__":
    main()
