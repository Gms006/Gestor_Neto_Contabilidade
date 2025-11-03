#!/usr/bin/env python3
"""
fetch_email.py
Busca e-mails do Gmail e gera events_email.json
"""

import os
import sys
import json
import re
import base64
import hashlib
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent))
from utils.logger import setup_logger
from utils.gmail_auth import get_gmail_service
from utils.date_helpers import parse_date_br, infer_competencia

logger = setup_logger('fetch_email')

BASE_DIR = Path(__file__).parent.parent
CONFIG_FILE = BASE_DIR / 'scripts' / 'config.json'
RAW_EMAIL_DIR = BASE_DIR / 'data' / 'raw_email'
DATA_DIR = BASE_DIR / 'data'
RAW_EMAIL_DIR.mkdir(parents=True, exist_ok=True)

def load_config():
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def extract_proc_id(text):
    """Extrai ProcID do texto"""
    match = re.search(r'ID\s+(\d+)', text, re.IGNORECASE)
    return match.group(1) if match else None

def extract_cnpj(text):
    """Extrai CNPJ do texto"""
    match = re.search(r'\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}', text)
    return match.group(0) if match else None

def extract_responsavel(body):
    """Extrai responsável do corpo do e-mail"""
    match = re.search(r'Responsável:\s*([A-Z]{2,4}\s*[-—]\s*[\w\s]+)', body, re.IGNORECASE)
    return match.group(1).strip() if match else None

def extract_tempo_processo(body):
    """Extrai tempo do processo em dias"""
    match = re.search(r'Tempo do processo:\s*(\d+)\s*dia', body, re.IGNORECASE)
    return int(match.group(1)) if match else None

def parse_subject(subject):
    """Parse do assunto do e-mail"""
    # Padrão: <Regime/Atividade> | <Evento> — <Empresa> (ID <ProcID>) — <Data>
    
    parts = subject.split('|')
    if len(parts) < 2:
        return None
    
    regime_atividade = parts[0].strip()
    resto = parts[1].strip()
    
    # Extrai evento
    evento_match = re.search(r'^([^—]+)', resto)
    evento = evento_match.group(1).strip() if evento_match else None
    
    # Extrai empresa
    empresa_match = re.search(r'—\s*([^(]+)\s*\(', resto)
    empresa = empresa_match.group(1).strip() if empresa_match else None
    
    # Extrai data
    data_match = re.search(r'—\s*(\d{2}/\d{2}/\d{4})', resto)
    data = data_match.group(1) if data_match else None
    
    # Extrai ProcID
    proc_id = extract_proc_id(subject)
    
    return {
        'regime_atividade': regime_atividade,
        'evento': evento,
        'empresa': empresa,
        'proc_id': proc_id,
        'data': data
    }

def categorize_event(evento):
    """Mapeia evento para categoria/subtipo/status"""
    evento_lower = evento.lower()
    
    # REINF
    if 'reinf' in evento_lower:
        if 'obrigatória' in evento_lower or 'obrigatoria' in evento_lower:
            return 'efd_reinf', 'obrig', 'Obrigatória'
        elif 'dispensada' in evento_lower:
            return 'efd_reinf', 'dispensa', 'Dispensada'
    
    # EFD Contribuições
    if 'efd contrib' in evento_lower or 'mit preenchida' in evento_lower:
        if 'obrigatória' in evento_lower or 'obrigatoria' in evento_lower:
            return 'efd_contrib', 'obrig', 'Obrigatória'
        elif 'dispensada' in evento_lower or 'dispensa' in evento_lower:
            return 'efd_contrib', 'dispensa', 'Dispensada'
    
    # DIFAL
    if 'difal' in evento_lower:
        if 'comercialização' in evento_lower or 'comercializacao' in evento_lower:
            return 'difal', 'comercializacao', 'Incidência confirmada'
        elif 'consumo' in evento_lower or 'imobilizado' in evento_lower:
            return 'difal', 'consumo_imobilizado', 'Obrigatório'
        elif 'ambos' in evento_lower:
            return 'difal', 'ambos', 'Obrigatório'
    
    # Fora do DAS
    if 'fora do das' in evento_lower:
        if 'iss e icms' in evento_lower or 'icms e iss' in evento_lower:
            return 'fora_das', 'ISS_ICMS', 'Emitir guias'
        elif 'iss' in evento_lower:
            return 'fora_das', 'ISS', 'Emitir guia municipal'
        elif 'icms' in evento_lower:
            return 'fora_das', 'ICMS', 'Emitir guia estadual'
    
    # Finalização
    if 'finalizado' in evento_lower or 'encerrado' in evento_lower or 'concluir' in evento_lower:
        return 'finalizacao', None, 'Finalizado'
    
    return None, None, None

def parse_email_message(msg):
    """Parse de uma mensagem de e-mail"""
    headers = msg['payload']['headers']
    
    subject = None
    date_str = None
    
    for header in headers:
        if header['name'] == 'Subject':
            subject = header['value']
        elif header['name'] == 'Date':
            date_str = header['value']
    
    if not subject:
        return None
    
    # Parse subject
    parsed = parse_subject(subject)
    if not parsed or not parsed['proc_id']:
        return None
    
    # Get body
    body = ''
    if 'parts' in msg['payload']:
        for part in msg['payload']['parts']:
            if part['mimeType'] == 'text/plain':
                data = part['body'].get('data', '')
                body = base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
                break
    elif 'body' in msg['payload']:
        data = msg['payload']['body'].get('data', '')
        body = base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
    
    # Extrai dados do corpo
    cnpj = extract_cnpj(body)
    responsavel = extract_responsavel(body)
    tempo_processo = extract_tempo_processo(body)
    
    # Categoriza evento
    categoria, subtipo, status = categorize_event(parsed['evento'])
    
    if not categoria:
        logger.warning(f"Evento não categorizado: {parsed['evento']}")
        return None
    
    # Parse data
    data_evento = parse_date_br(parsed['data'])
    competencia = infer_competencia(data_evento) if data_evento else None
    
    # Hash do corpo para deduplicação
    body_hash = hashlib.md5(body.encode()).hexdigest()
    
    return {
        'source': 'email',
        'proc_id': parsed['proc_id'],
        'empresa': parsed['empresa'],
        'cnpj': cnpj,
        'regime': parsed['regime_atividade'].split('—')[0].strip() if '—' in parsed['regime_atividade'] else parsed['regime_atividade'],
        'atividade': parsed['regime_atividade'].split('—')[1].strip() if '—' in parsed['regime_atividade'] else None,
        'categoria': categoria,
        'subtipo': subtipo,
        'status': status,
        'responsavel': responsavel,
        'prazo': None,
        'data_evento': data_evento.strftime('%Y-%m-%d') if data_evento else None,
        'competencia': competencia,
        'passo_status': None,
        'bloqueante': None,
        'email_id': msg['id'],
        'body_hash': body_hash
    }

def fetch_gmail_messages(config):
    """Busca mensagens do Gmail"""
    try:
        service = get_gmail_service()
    except Exception as e:
        logger.error(f"Erro ao autenticar Gmail: {e}")
        logger.info("Pulando coleta de e-mails...")
        return []
    
    query = config['gmail']['query']
    max_results = config['gmail']['max_results']
    
    logger.info(f"Buscando e-mails: {query}")
    
    messages = []
    page_token = None
    
    try:
        while len(messages) < max_results:
            results = service.users().messages().list(
                userId='me',
                q=query,
                maxResults=min(100, max_results - len(messages)),
                pageToken=page_token
            ).execute()
            
            msgs = results.get('messages', [])
            if not msgs:
                break
            
            logger.info(f"Página: {len(msgs)} mensagens")
            
            for msg_ref in msgs:
                msg = service.users().messages().get(
                    userId='me',
                    id=msg_ref['id'],
                    format='full'
                ).execute()
                messages.append(msg)
            
            page_token = results.get('nextPageToken')
            if not page_token:
                break
        
        logger.info(f"Total de e-mails coletados: {len(messages)}")
        return messages
        
    except Exception as e:
        logger.error(f"Erro ao buscar e-mails: {e}")
        return []

def main():
    logger.info("=" * 60)
    logger.info("FETCH EMAIL - Início")
    logger.info("=" * 60)
    
    config = load_config()
    messages = fetch_gmail_messages(config)
    
    if not messages:
        logger.warning("Nenhum e-mail coletado")
        # Cria arquivo vazio
        output_file = DATA_DIR / 'events_email.json'
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump([], f)
        logger.info("Arquivo vazio criado: events_email.json")
        return
    
    # Salva snapshot
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    snapshot_file = RAW_EMAIL_DIR / f'emails_{timestamp}.json'
    
    with open(snapshot_file, 'w', encoding='utf-8') as f:
        json.dump(messages, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Snapshot salvo: {snapshot_file}")
    
    # Parse emails
    events = []
    for msg in messages:
        event = parse_email_message(msg)
        if event:
            events.append(event)
    
    logger.info(f"Eventos extraídos: {len(events)}")
    
    # Salva events_email.json
    output_file = DATA_DIR / 'events_email.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(events, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Eventos salvos: {output_file}")
    logger.info("FETCH EMAIL - Concluído")
    logger.info("=" * 60)

if __name__ == '__main__':
    main()
