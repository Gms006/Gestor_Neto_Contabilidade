# -*- coding: utf-8 -*-
"""
Lê Gmail (readonly), extrai eventos dos e-mails padronizados e gera data/events_email.json
Regras por regex para mapear Assunto/Corpo em categoria/subtipo/status
"""
import os, json, base64, re
from pathlib import Path
from typing import Any, Dict, List, Optional
from datetime import datetime
from dotenv import load_dotenv

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
EVENTS_EMAIL = DATA / "events_email.json"
CONFIG_PATH = ROOT / "scripts" / "config.json"

def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def auth_gmail(creds_path: str, token_path: str, scopes: List[str]):
    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, scopes)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(creds_path, scopes)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w", encoding="utf-8") as token:
            token.write(creds.to_json())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)

RE_ID = re.compile(r"\(ID\s*(\d+)\)")
RE_CNPJ = re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b")
RE_RESP = re.compile(r"Respons[aá]vel\s*:\s*(.+)")
RE_TEMPO = re.compile(r"Tempo do processo\s*:\s*(\d+)")
RE_DATA = re.compile(r"Data (?:de preenchimento|do processo)\s*:\s*(\d{2}/\d{2}/\d{4})")

def parse_subject(subj: str) -> Dict[str, Optional[str]]:
    # Formato: <Regime/Atividade> | <Evento> — <Empresa> (ID 123) — <Data>
    d = {"regime": None, "evento_raw": None, "empresa": None, "proc_id": None, "data": None}
    try:
        # Split pelo " — " (travessão)
        parts = [p.strip() for p in subj.split("—")]
        left = parts[0] if parts else ""
        if "|" in left:
            regime, evento = [p.strip() for p in left.split("|", 1)]
        else:
            regime, evento = left.strip(), None
        d["regime"] = regime
        d["evento_raw"] = evento
        # empresa + (ID NNN)
        if len(parts) >= 2:
            emp = parts[1].strip()
            d["empresa"] = re.sub(r"\(ID.*$", "", emp).strip()
            m = RE_ID.search(parts[1])
            if m:
                d["proc_id"] = m.group(1)
        # data
        if len(parts) >= 3:
            m = re.search(r"(\d{2}/\d{2}/\d{4})", parts[2])
            if m:
                d["data"] = m.group(1)
    except Exception:
        pass
    return d

def map_event(evento_raw: str, body: str) -> Dict[str, Optional[str]]:
    text = f"{evento_raw}\n{body}".lower()
    def has(x: str): return x.lower() in text

    # EFD-Reinf
    if "efd-reinf" in text or "efd reinf" in text:
        if "obrigat" in text:
            return {"categoria": "efd_reinf", "subtipo": None, "status": "Obrigatória"}
        if "dispens" in text:
            return {"categoria": "efd_reinf", "subtipo": None, "status": "Dispensada"}
    # EFD Contribuições
    if "efd contribui" in text:
        if "obrigat" in text:
            return {"categoria": "efd_contrib", "subtipo": None, "status": "Obrigatória"}
        if "dispens" in text:
            return {"categoria": "efd_contrib", "subtipo": None, "status": "Dispensada"}
    # MIT preenchida
    if "mit preenchida" in text:
        return {"categoria": "mit", "subtipo": "preenchida", "status": "OK"}
    # DIFAL
    if "difal" in text:
        if "consumo" in text or "imobiliz" in text:
            return {"categoria": "difal", "subtipo": "consumo_imobilizado", "status": "Obrigatório"}
        if "comercializ" in text:
            return {"categoria": "difal", "subtipo": "comercializacao", "status": "Incidência confirmada"}
    # Fora do DAS
    if "fora do das" in text:
        if "iss e icms" in text:
            return {"categoria": "fora_das", "subtipo": "ISS_ICMS", "status": "Emitir guias"}
        if "icms" in text:
            return {"categoria": "fora_das", "subtipo": "ICMS", "status": "Emitir guia estadual"}
        if "iss" in text:
            return {"categoria": "fora_das", "subtipo": "ISS", "status": "Emitir guia municipal"}
    # Finalização
    if "processo fiscal finalizado" in text or "controle mensal — finalizado" in text or "controle mensal - finalizado" in text:
        return {"categoria": "finalizacao", "subtipo": None, "status": "Finalizado"}

    return {"categoria": None, "subtipo": None, "status": None}

def b64_to_text(b64: str) -> str:
    return base64.urlsafe_b64decode(b64.encode("utf-8")).decode("utf-8", errors="ignore")

def main():
    load_dotenv()
    cfg = load_config()
    creds_path = os.getenv("GMAIL_CREDENTIALS_PATH", "credentials.json")
    token_path = os.getenv("GMAIL_TOKEN_PATH", "token.json")
    scopes = cfg["gmail"]["scopes"]
    query = cfg["gmail"]["query"]
    max_results = cfg["gmail"]["max_results"]

    service = auth_gmail(creds_path, token_path, scopes)
    msgs_list = service.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    ids = [m["id"] for m in msgs_list.get("messages", [])]

    events: List[Dict[str, Any]] = []
    for mid in ids:
        msg = service.users().messages().get(userId="me", id=mid, format="full").execute()
        headers = {h["name"]: h["value"] for h in msg["payload"]["headers"]}
        subj = headers.get("Subject", "")
        internal_date = int(msg.get("internalDate", 0)) // 1000
        email_date = datetime.utcfromtimestamp(internal_date).strftime("%Y-%m-%d")

        # corpo (text/plain preferencial)
        body_text = ""
        parts = msg["payload"].get("parts")
        if parts:
            for p in parts:
                if p.get("mimeType") == "text/plain" and "data" in p.get("body", {}):
                    body_text = b64_to_text(p["body"]["data"])
                    break
        else:
            if "data" in msg["payload"].get("body", {}):
                body_text = b64_to_text(msg["payload"]["body"]["data"])

        meta = parse_subject(subj)
        mapping = map_event(meta.get("evento_raw") or "", body_text)

        if mapping["categoria"]:
            cnpj = None
            m = RE_CNPJ.search(body_text)
            if m: cnpj = m.group(0)
            resp = None
            m = RE_RESP.search(body_text)
            if m: resp = m.group(1).strip()
            tempo = None
            m = RE_TEMPO.search(body_text)
            if m: tempo = int(m.group(1))
            data_evento = meta.get("data")
            if not data_evento:
                m = RE_DATA.search(body_text)
                if m: data_evento = m.group(1)

            # Inferir competência pela data do evento
            competencia = None
            if data_evento:
                d = datetime.strptime(data_evento, "%d/%m/%Y")
                competencia = d.strftime("%Y-%m")

            evt = {
                "source": "email",
                "proc_id": meta.get("proc_id"),
                "empresa": meta.get("empresa"),
                "cnpj": cnpj,
                "regime": meta.get("regime"),
                "atividade": None,
                "categoria": mapping["categoria"],
                "subtipo": mapping.get("subtipo"),
                "status": mapping.get("status"),
                "responsavel": resp,
                "prazo": None,
                "data_evento": datetime.strptime(data_evento, "%d/%m/%Y").strftime("%Y-%m-%d") if data_evento else email_date,
                "competencia": competencia,
                "passo_status": None,
                "bloqueante": None,
                "email_id": mid,
                "body_hash": None
            }
            events.append(evt)

    EVENTS_EMAIL.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[fetch_email] OK: {EVENTS_EMAIL}, {len(events)} eventos")

if __name__ == "__main__":
    main()
