#!/usr/bin/env python3
"""
fuse_sources.py
Mescla eventos da API e e-mail, gerando events.json e alertas de divergência
"""

import sys
import json
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from utils.logger import setup_logger

logger = setup_logger('fuse_sources')

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / 'data'

def load_events(source):
    """Carrega eventos de um arquivo"""
    file_path = DATA_DIR / f'events_{source}.json'
    
    if not file_path.exists():
        logger.warning(f"Arquivo não encontrado: {file_path}")
        return []
    
    with open(file_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def create_event_key(event):
    """Cria chave única para um evento"""
    return (
        event['proc_id'],
        event['categoria'],
        event.get('subtipo'),
        event.get('competencia')
    )

def merge_events(api_events, email_events):
    """Mescla eventos priorizando API"""
    merged = {}
    divergences = []
    not_mapped = []
    
    # Indexa eventos da API
    api_index = {}
    for event in api_events:
        key = create_event_key(event)
        api_index[key] = event
        merged[key] = event
    
    logger.info(f"Eventos API indexados: {len(api_index)}")
    
    # Processa eventos de e-mail
    for email_event in email_events:
        key = create_event_key(email_event)
        
        if key in api_index:
            # Verifica divergência
            api_event = api_index[key]
            
            if api_event['status'] != email_event['status']:
                divergences.append({
                    'proc_id': email_event['proc_id'],
                    'categoria': email_event['categoria'],
                    'subtipo': email_event.get('subtipo'),
                    'competencia': email_event.get('competencia'),
                    'api_status': api_event['status'],
                    'email_status': email_event['status']
                })
                logger.warning(f"Divergência detectada: {key}")
            
            # Enriquece com dados do e-mail se ausentes na API
            if not api_event.get('responsavel') and email_event.get('responsavel'):
                merged[key]['responsavel'] = email_event['responsavel']
                merged[key]['responsavel_fonte'] = 'email'
        
        else:
            # Evento só existe no e-mail
            merged[key] = email_event
            not_mapped.append({
                'proc_id': email_event['proc_id'],
                'categoria': email_event['categoria'],
                'subtipo': email_event.get('subtipo'),
                'detalhe': f"Evento encontrado apenas em e-mail",
                'fonte': 'email'
            })
            logger.warning(f"Evento não mapeado na API: {key}")
    
    logger.info(f"Eventos mesclados: {len(merged)}")
    logger.info(f"Divergências: {len(divergences)}")
    logger.info(f"Não mapeados: {len(not_mapped)}")
    
    return list(merged.values()), divergences, not_mapped

def main():
    logger.info("=" * 60)
    logger.info("FUSE SOURCES - Início")
    logger.info("=" * 60)
    
    # Carrega eventos
    api_events = load_events('api')
    email_events = load_events('email')
    
    logger.info(f"Eventos API: {len(api_events)}")
    logger.info(f"Eventos Email: {len(email_events)}")
    
    # Mescla
    merged_events, divergences, not_mapped = merge_events(api_events, email_events)
    
    # Salva events.json
    output_file = DATA_DIR / 'events.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(merged_events, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Eventos finais salvos: {output_file}")
    
    # Salva divergências e não mapeados temporariamente
    temp_alerts = {
        'divergencias': divergences,
        'nao_mapeados_api': not_mapped
    }
    
    temp_file = DATA_DIR / 'temp_alerts.json'
    with open(temp_file, 'w', encoding='utf-8') as f:
        json.dump(temp_alerts, f, indent=2, ensure_ascii=False)
    
    logger.info("FUSE SOURCES - Concluído")
    logger.info("=" * 60)

if __name__ == '__main__':
    main()
