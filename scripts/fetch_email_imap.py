# scripts/fetch_email_imap.py
# -*- coding: utf-8 -*-
"""
Lê e-mails via IMAP (KingHost), extrai eventos padronizados e grava:
- data/emails_raw.json (payload bruto resumido para o verificador)
- data/events_email.json (eventos mapeados)

Depende de variáveis de ambiente (.env) e de scripts/config.json (bloco "imap").
"""

from __future__ import annotations

import os
import json
import imaplib
import re
from email import message_from_bytes
from email.header import decode_header, make_header
from email.message import Message
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from hashlib import sha1

from dotenv import load_dotenv

from scripts.utils.logger import log

# --- env/config/paths ---------------------------------------------------------
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT_EVENTS = DATA / "events_email.json"
OUT_RAW = DATA / "emails_raw.json"
CONFIG = ROOT / "scripts" / "config.json"

load_dotenv(dotenv_path=ROOT / ".env", override=True)

# --- regex utilitários --------------------------------------------------------
RE_ID   = re.compile(r"\(ID\s*(\d+)\)")
RE_CNPJ = re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b")
RE_RESP = re.compile(r"Respons[aá]vel\s*:\s*(.+)")
RE_TEMPO= re.compile(r"Tempo do processo\s*:\s*(\d+)")
RE_DATA = re.compile(r"Data (?:de preenchimento|do processo)\s*:\s*(\d{2}/\d{2}/\d{4})")


# --- helpers ------------------------------------------------------------------
def load_cfg() -> Dict[str, Any]:
    if not CONFIG.exists():
        return {}
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def decode_subj(raw: Optional[str]) -> str:
    try:
        return str(make_header(decode_header(raw or "")))
    except Exception:
        return raw or ""


def get_text_message(msg: Message) -> str:
    parts: List[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and part.get_content_disposition() != "attachment":
                payload = part.get_payload(decode=True) or b""
                parts.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
    else:
        if msg.get_content_type() == "text/plain":
            payload = msg.get_payload(decode=True) or b""
            parts.append(payload.decode(msg.get_content_charset() or "utf-8", errors="replace"))
    return "\n".join(p.strip() for p in parts if p)


def parse_subject(subj: str) -> Dict[str, Optional[str]]:
    # Ex.: "<Regime/Atividade> | <Evento> — <Empresa> (ID 12345) — <Data dd/mm/aaaa>"
    d = {"regime": None, "evento_raw": None, "empresa": None, "proc_id": None, "data": None}
    try:
        parts = [p.strip() for p in subj.split("—")]
        left = parts[0] if parts else ""
        if "|" in left:
            regime, evento = [p.strip() for p in left.split("|", 1)]
        else:
            regime, evento = left.strip(), None
        d["regime"] = regime
        d["evento_raw"] = evento
        if len(parts) >= 2:
            emp = parts[1].strip()
            d["empresa"] = re.sub(r"\(ID.*$", "", emp).strip()
            m = RE_ID.search(parts[1])
            if m:
                d["proc_id"] = m.group(1)
        if len(parts) >= 3:
            m = re.search(r"(\d{2}/\d{2}/\d{4})", parts[2])
            if m:
                d["data"] = m.group(1)
    except Exception:
        pass
    return d


def map_event(evento_raw: str, body: str) -> Dict[str, Optional[str]]:
    text = f"{evento_raw}\n{body}".lower()
    if "efd-reinf" in text or "efd reinf" in text:
        if "obrigat" in text:
            return {"categoria": "efd_reinf", "subtipo": None, "status": "Obrigatória"}
        if "dispens" in text:
            return {"categoria": "efd_reinf", "subtipo": None, "status": "Dispensada"}
    if "efd contrib" in text:
        if "obrigat" in text:
            return {"categoria": "efd_contrib", "subtipo": None, "status": "Obrigatória"}
        if "dispens" in text:
            return {"categoria": "efd_contrib", "subtipo": None, "status": "Dispensada"}
    if "mit preenchida" in text:
        return {"categoria": "mit", "subtipo": "preenchida", "status": "OK"}
    if "difal" in text:
        if "consumo" in text or "imobiliz" in text:
            return {"categoria": "difal", "subtipo": "consumo_imobilizado", "status": "Obrigatório"}
        if "comercializ" in text:
            return {"categoria": "difal", "subtipo": "comercializacao", "status": "Incidência confirmada"}
        if "ambos" in text:
            return {"categoria": "difal", "subtipo": "ambos", "status": "Incidência confirmada"}
    if "fora do das" in text:
        if "iss e icms" in text:
            return {"categoria": "fora_das", "subtipo": "ISS_ICMS", "status": "Emitir guias"}
        if "icms" in text:
            return {"categoria": "fora_das", "subtipo": "ICMS", "status": "Emitir guia estadual"}
        if "iss" in text:
            return {"categoria": "fora_das", "subtipo": "ISS", "status": "Emitir guia municipal"}
    if "processo fiscal finalizado" in text or "controle mensal — finalizado" in text or "controle mensal - finalizado" in text:
        return {"categoria": "finalizacao", "subtipo": None, "status": "Finalizado"}
    return {"categoria": None, "subtipo": None, "status": None}


def imap_since(days: int) -> str:
    dt = datetime.now(timezone.utc) - timedelta(days=days)  # timezone-aware
    return dt.strftime("%d-%b-%Y")


# --- main ---------------------------------------------------------------------
def main() -> None:
    cfg = load_cfg()

    host = os.getenv("MAIL_HOST", "imap.kinghost.net")
    port = int(os.getenv("MAIL_PORT", "993"))
    user = os.getenv("MAIL_USER")
    pwd  = os.getenv("MAIL_PASSWORD")
    use_ssl = (os.getenv("MAIL_USE_SSL", "true").lower() == "true")
    folder = os.getenv("MAIL_FOLDER", "INBOX")

    if not (user and pwd):
        raise RuntimeError("Faltam MAIL_USER/MAIL_PASSWORD no .env")

    DATA.mkdir(exist_ok=True)

    search_days  = int(cfg.get("imap", {}).get("search_days", 180))
    max_messages = int(cfg.get("imap", {}).get("max_messages", 2000))
    subject_kw   = cfg.get("imap", {}).get("subject_keywords", [])
    from_filters = cfg.get("imap", {}).get("from_filters", [])

    log("fetch_email_imap", "INFO", "Conectando", host=host, folder=folder)

    M: imaplib.IMAP4 | imaplib.IMAP4_SSL
    if use_ssl:
        M = imaplib.IMAP4_SSL(host, port)
    else:
        M = imaplib.IMAP4(host, port)
        try:
            M.starttls()
        except Exception as exc:
            log("fetch_email_imap", "WARNING", "STARTTLS indisponível", error=str(exc))

    try:
        M.login(user, pwd)
        typ, _ = M.select(folder)
        if typ != "OK":
            raise RuntimeError(f"IMAP select falhou: {typ}")

        since = imap_since(search_days)
        typ, data = M.search(None, f'(SINCE "{since}")')
        if typ != "OK":
            raise RuntimeError(f"IMAP search falhou: {typ}")

        ids = data[0].split()
        ids = ids[-max_messages:]

        events: List[Dict[str, Any]] = []
        raws: List[Dict[str, Any]] = []

        log("fetch_email_imap", "INFO", "Processando mensagens", total=len(ids))

        for num in reversed(ids):
            typ, msg_data = M.fetch(num, "(RFC822)")
            if typ != "OK" or not msg_data or not msg_data[0]:
                continue
            raw = msg_data[0][1]
            email_msg = message_from_bytes(raw)
            assert isinstance(email_msg, Message)

            subj = decode_subj(email_msg.get("Subject", ""))
            from_addr = str(make_header(decode_header(email_msg.get("From", ""))))
            to_addr = str(make_header(decode_header(email_msg.get("To", ""))))
            date_hdr = email_msg.get("Date")

            # Filtros do config
            if from_filters and not any(f.lower() in from_addr.lower() for f in from_filters):
                continue
            if subject_kw and not any(kw.lower() in subj.lower() for kw in subject_kw):
                continue

            body = get_text_message(email_msg)
            body_hash = sha1(body.encode("utf-8", errors="ignore")).hexdigest() if body else None

            # RAW compacto (para passar no verificador e auditoria leve)
            raws.append({
                "uid": num.decode() if isinstance(num, bytes) else str(num),
                "subject": subj,
                "from": from_addr,
                "to": to_addr,
                "date": date_hdr,
                "snippet": (body[:300] + "…") if body and len(body) > 300 else body,
            })

            # Evento mapeado
            meta = parse_subject(subj)
            mapping = map_event(meta.get("evento_raw") or "", body)
            if not mapping["categoria"]:
                continue

            cnpj_match = RE_CNPJ.search(body)
            cnpj = cnpj_match.group(0) if cnpj_match else None
            resp_match = RE_RESP.search(body)
            resp = resp_match.group(1).strip() if resp_match else None

            data_evento = meta.get("data")
            if not data_evento:
                m = RE_DATA.search(body)
                if m:
                    data_evento = m.group(1)

            data_evento_iso = None
            if data_evento:
                try:
                    data_evento_iso = datetime.strptime(data_evento, "%d/%m/%Y").strftime("%Y-%m-%d")
                except ValueError:
                    data_evento_iso = None

            competencia = data_evento_iso[:7] if data_evento_iso else None

            events.append({
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
                "data_evento": data_evento_iso,
                "competencia": competencia,
                "passo_status": None,
                "bloqueante": None,
                "email_id": num.decode() if isinstance(num, bytes) else str(num),
                "body_hash": body_hash,
            })

        # Escritas
        DATA.mkdir(parents=True, exist_ok=True)
        OUT_RAW.write_text(json.dumps(raws, ensure_ascii=False, indent=2), encoding="utf-8")
        OUT_EVENTS.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")

        log("fetch_email_imap", "INFO", "Arquivos gerados",
            emails_raw=len(raws), events=len(events),
            raw_path=str(OUT_RAW), events_path=str(OUT_EVENTS))

    finally:
        try:
            M.close()
        except Exception:
            pass
        try:
            M.logout()
        except Exception:
            pass


if __name__ == "__main__":
    main()
