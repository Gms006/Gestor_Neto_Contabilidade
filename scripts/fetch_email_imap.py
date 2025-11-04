# -*- coding: utf-8 -*-
"""
Lê e-mails via IMAP (KingHost), extrai eventos padronizados e grava data/events_email.json
Depende de variáveis de ambiente (.env) e de scripts/config.json (bloco imap).
"""

import os, json, imaplib, re
from email import message_from_bytes
from email.header import decode_header, make_header
from email.message import Message
from pathlib import Path
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv

from scripts.utils.logger import log

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = DATA / "events_email.json"
CONFIG = ROOT / "scripts" / "config.json"

RE_ID   = re.compile(r"\(ID\s*(\d+)\)")
RE_CNPJ = re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b")
RE_RESP = re.compile(r"Respons[aá]vel\s*:\s*(.+)")
RE_TEMPO= re.compile(r"Tempo do processo\s*:\s*(\d+)")
RE_DATA = re.compile(r"Data (?:de preenchimento|do processo)\s*:\s*(\d{2}/\d{2}/\d{4})")


def load_cfg() -> Dict[str, Any]:
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def decode_subj(raw) -> str:
    try:
        return str(make_header(decode_header(raw or "")))
    except Exception:
        return raw or ""


def get_text_message(msg: Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = part.get("Content-Disposition", "")
            if ctype == "text/plain" and "attachment" not in (disp or "").lower():
                charset = part.get_content_charset() or "utf-8"
                try:
                    return part.get_payload(decode=True).decode(charset, errors="ignore")
                except Exception:
                    return part.get_payload(decode=True).decode("utf-8", errors="ignore")
    else:
        if msg.get_content_type() == "text/plain":
            charset = msg.get_content_charset() or "utf-8"
            return msg.get_payload(decode=True).decode(charset, errors="ignore")
    return ""


def parse_subject(subj: str) -> Dict[str, Optional[str]]:
    # "<Regime/Atividade> | <Evento> — <Empresa> (ID 12345) — <Data dd/mm/aaaa>"
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
            if m: d["proc_id"] = m.group(1)
        if len(parts) >= 3:
            m = re.search(r"(\d{2}/\d{2}/\d{4})", parts[2])
            if m: d["data"] = m.group(1)
    except Exception:
        pass
    return d


def map_event(evento_raw: str, body: str) -> Dict[str, Optional[str]]:
    text = f"{evento_raw}\n{body}".lower()
    if "efd-reinf" in text or "efd reinf" in text:
        if "obrigat" in text: return {"categoria": "efd_reinf", "subtipo": None, "status": "Obrigatória"}
        if "dispens" in text:  return {"categoria": "efd_reinf", "subtipo": None, "status": "Dispensada"}
    if "efd contrib" in text:
        if "obrigat" in text: return {"categoria": "efd_contrib", "subtipo": None, "status": "Obrigatória"}
        if "dispens" in text:  return {"categoria": "efd_contrib", "subtipo": None, "status": "Dispensada"}
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
        if "iss e icms" in text: return {"categoria": "fora_das", "subtipo": "ISS_ICMS", "status": "Emitir guias"}
        if "icms" in text:       return {"categoria": "fora_das", "subtipo": "ICMS", "status": "Emitir guia estadual"}
        if "iss" in text:        return {"categoria": "fora_das", "subtipo": "ISS", "status": "Emitir guia municipal"}
    if "processo fiscal finalizado" in text or "controle mensal — finalizado" in text or "controle mensal - finalizado" in text:
        return {"categoria": "finalizacao", "subtipo": None, "status": "Finalizado"}
    return {"categoria": None, "subtipo": None, "status": None}


def imap_since(days: int) -> str:
    dt = datetime.utcnow() - timedelta(days=days)
    return dt.strftime("%d-%b-%Y")


def main():
    load_dotenv()
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

    search_days    = int(cfg.get("imap", {}).get("search_days", 180))
    max_messages   = int(cfg.get("imap", {}).get("max_messages", 2000))
    subject_kw     = cfg.get("imap", {}).get("subject_keywords", [])
    from_filters   = cfg.get("imap", {}).get("from_filters", [])

    log("fetch_email_imap", "INFO", "Conectando", host=host, folder=folder)

    M = imaplib.IMAP4_SSL(host, port) if use_ssl else imaplib.IMAP4(host, port)
    if not use_ssl:
        try:
            M.starttls()
        except Exception as exc:
            log("fetch_email_imap", "WARNING", "STARTTLS indisponível", error=str(exc))

    M.login(user, pwd)
    M.select(folder)

    since = imap_since(search_days)
    typ, data = M.search(None, '(SINCE "{}")'.format(since))
    if typ != "OK":
        raise RuntimeError(f"IMAP search falhou: {typ}")

    ids = data[0].split()
    ids = ids[-max_messages:]

    events: List[Dict[str, Any]] = []
    log("fetch_email_imap", "INFO", "Processando mensagens", total=len(ids))

    for num in reversed(ids):
        typ, msg_data = M.fetch(num, "(RFC822)")
        if typ != "OK" or not msg_data or not msg_data[0]:
            continue
        raw = msg_data[0][1]
        msg = message_from_bytes(raw)

        subj = decode_subj(msg.get("Subject", ""))
        from_addr = str(make_header(decode_header(msg.get("From", ""))))

        if from_filters and not any(f.lower() in from_addr.lower() for f in from_filters):
            continue
        if subject_kw and not any(kw.lower() in subj.lower() for kw in subject_kw):
            continue

        body = get_text_message(msg)
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
            if m: data_evento = m.group(1)
        data_evento_iso = None
        if data_evento:
            data_evento_iso = datetime.strptime(data_evento, "%d/%m/%Y").strftime("%Y-%m-%d")

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
            "body_hash": None
        })

    M.close()
    M.logout()

    OUT.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    log("fetch_email_imap", "INFO", "Eventos gerados", total=len(events))


if __name__ == "__main__":
    main()

