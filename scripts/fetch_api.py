#!/usr/bin/env python3
"""
fetch_api.py
Busca processos da API Acessórias com paginação e modo incremental
"""

import os
import sys
import json
import requests
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Adiciona o diretório scripts ao path
sys.path.insert(0, str(Path(__file__).parent))
from utils.logger import setup_logger
from utils.date_helpers import now_iso

# Configuração
load_dotenv()
logger = setup_logger('fetch_api')

BASE_DIR = Path(__file__).parent.parent
CONFIG_FILE = BASE_DIR / 'scripts' / 'config.json'
RAW_API_DIR = BASE_DIR / 'data' / 'raw_api'
RAW_API_DIR.mkdir(parents=True, exist_ok=True)

def load_config():
    """Carrega configuração"""
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_config(config):
    """Salva configuração atualizada"""
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

def fetch_processes_page(base_url, token, page=1, dt_last_dh=None, proc_status=None):
    """Busca uma página de processos"""
    url = f"{base_url}/processes"
    
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    
    params = {'Pagina': page}
    
    if dt_last_dh:
        params['DtLastDH'] = dt_last_dh
    
    if proc_status:
        params['ProcStatus'] = proc_status
    
    logger.info(f"Buscando página {page}...")
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logger.error(f"Erro ao buscar página {page}: {e}")
        return None

def fetch_all_processes(config):
    """Busca todos os processos com paginação"""
    token = os.getenv('ACESSORIAS_TOKEN')
    if not token:
        logger.error("ACESSORIAS_TOKEN não definido no .env")
        sys.exit(1)
    
    base_url = config['acessorias']['base_url']
    page_size = config['acessorias']['page_size']
    dt_last_dh = config['acessorias'].get('dt_last_dh')
    proc_status = config['acessorias'].get('proc_status')
    
    all_processes = []
    page = 1
    latest_dh = dt_last_dh
    
    while True:
        data = fetch_processes_page(base_url, token, page, dt_last_dh, proc_status)
        
        if not data or not isinstance(data, list) or len(data) == 0:
            logger.info(f"Fim da paginação na página {page}")
            break
        
        logger.info(f"Página {page}: {len(data)} processos")
        all_processes.extend(data)
        
        # Atualiza DtLastDH mais recente
        for proc in data:
            proc_dh = proc.get('DtLastDH')
            if proc_dh and (not latest_dh or proc_dh > latest_dh):
                latest_dh = proc_dh
        
        if len(data) < page_size:
            logger.info(f"Última página detectada (< {page_size} registros)")
            break
        
        page += 1
    
    logger.info(f"Total de processos coletados: {len(all_processes)}")
    
    # Salva snapshot
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    snapshot_file = RAW_API_DIR / f'processes_{timestamp}.json'
    
    with open(snapshot_file, 'w', encoding='utf-8') as f:
        json.dump(all_processes, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Snapshot salvo: {snapshot_file}")
    
    # Atualiza config com novo DtLastDH
    if latest_dh and latest_dh != dt_last_dh:
        config['acessorias']['dt_last_dh'] = latest_dh
        save_config(config)
        logger.info(f"DtLastDH atualizado: {latest_dh}")
    
    return all_processes

def main():
    logger.info("=" * 60)
    logger.info("FETCH API - Início")
    logger.info("=" * 60)
    
    config = load_config()
    processes = fetch_all_processes(config)
    
    # Salva também como latest
    latest_file = RAW_API_DIR / 'processes_latest.json'
    with open(latest_file, 'w', encoding='utf-8') as f:
        json.dump(processes, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Arquivo latest salvo: {latest_file}")
    logger.info("FETCH API - Concluído com sucesso")
    logger.info("=" * 60)

if __name__ == '__main__':
    main()
