#!/usr/bin/env python3
"""
flatten_steps.py
Achata árvore de passos dos processos e gera events_api.json
"""

import sys
import json
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent))
from utils.logger import setup_logger
from utils.date_helpers import parse_date, infer_competencia

logger = setup_logger('flatten_steps')

BASE_DIR = Path(__file__).parent.parent
RULES_FILE = BASE_DIR / 'scripts' / 'rules.json'
RAW_API_DIR = BASE_DIR / 'data' / 'raw_api'
DATA_DIR = BASE_DIR / 'data'

def load_rules():
    """Carrega regras de mapeamento"""
    with open(RULES_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def match_step(step_name, rules):
    """Aplica regras para identificar categoria/subtipo/status"""
    for rule in rules['matchers']:
        if rule['contains'].lower() in step_name.lower():
            return {
                'categoria': rule['categoria'],
                'subtipo': rule['subtipo'],
                'status': rule['status']
            }
        
        # Verifica tags
        for tag in rule.get('tags', []):
            if tag.lower() in step_name.lower():
                return {
                    'categoria': rule['categoria'],
                    'subtipo': rule['subtipo'],
                    'status': rule['status']
                }
    
    return None

def flatten_steps_recursive(steps, parent_path=""):
    """Achata recursivamente árvore de passos"""
    flat_steps = []
    
    if not isinstance(steps, list):
        return flat_steps
    
    for idx, step in enumerate(steps):
        step_name = step.get('Nome', '')
        step_path = f"{parent_path}/{step_name}" if parent_path else step_name
        
        flat_step = {
            'path': step_path,
            'nome': step_name,
            'status': step.get('Status'),
            'bloqueante': step.get('Bloqueante'),
            'conclusao': step.get('Conclusao'),
            'automacao': step.get('Automacao', {})
        }
        
        flat_steps.append(flat_step)
        
        # Recursão para sub-passos
        if 'ProcPassos' in step and step['ProcPassos']:
            sub_steps = flatten_steps_recursive(step['ProcPassos'], step_path)
            flat_steps.extend(sub_steps)
    
    return flat_steps

def process_step_to_event(step, process, rules):
    """Converte um passo em evento"""
    match = match_step(step['nome'], rules)
    
    if not match:
        return None
    
    # Extrai dados da automação/entrega
    automacao = step.get('automacao', {})
    entrega = automacao.get('Entrega', {})
    
    # Inferir competência
    data_conclusao = parse_date(step.get('conclusao')) or parse_date(process.get('ProcConclusao'))
    prazo = parse_date(entrega.get('Prazo'))
    
    data_evento = data_conclusao or prazo or datetime.now()
    competencia = infer_competencia(data_evento)
    
    event = {
        'source': 'api',
        'proc_id': process.get('ProcID'),
        'empresa': process.get('EmpNome'),
        'cnpj': process.get('EmpCNPJ'),
        'regime': None,  # Inferir de outros campos se disponível
        'atividade': None,
        'categoria': match['categoria'],
        'subtipo': match['subtipo'],
        'status': match['status'],
        'responsavel': entrega.get('Responsavel'),
        'prazo': entrega.get('Prazo'),
        'data_evento': data_evento.strftime('%Y-%m-%d') if data_evento else None,
        'competencia': competencia,
        'passo_status': step.get('status'),
        'bloqueante': step.get('bloqueante'),
        'email_id': None,
        'body_hash': None
    }
    
    return event

def flatten_all_processes(processes, rules):
    """Processa todos os processos e gera eventos"""
    all_events = []
    
    for process in processes:
        proc_id = process.get('ProcID')
        logger.info(f"Processando processo {proc_id}...")
        
        steps_raw = process.get('ProcPassos', [])
        flat_steps = flatten_steps_recursive(steps_raw)
        
        for step in flat_steps:
            event = process_step_to_event(step, process, rules)
            if event:
                all_events.append(event)
    
    return all_events

def main():
    logger.info("=" * 60)
    logger.info("FLATTEN STEPS - Início")
    logger.info("=" * 60)
    
    # Carrega processos
    latest_file = RAW_API_DIR / 'processes_latest.json'
    if not latest_file.exists():
        logger.error(f"Arquivo não encontrado: {latest_file}")
        logger.error("Execute fetch_api.py primeiro")
        sys.exit(1)
    
    with open(latest_file, 'r', encoding='utf-8') as f:
        processes = json.load(f)
    
    logger.info(f"Processos carregados: {len(processes)}")
    
    # Carrega regras
    rules = load_rules()
    logger.info(f"Regras carregadas: {len(rules['matchers'])}")
    
    # Processa
    events = flatten_all_processes(processes, rules)
    logger.info(f"Eventos gerados: {len(events)}")
    
    # Salva events_api.json
    output_file = DATA_DIR / 'events_api.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(events, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Eventos salvos: {output_file}")
    logger.info("FLATTEN STEPS - Concluído")
    logger.info("=" * 60)

if __name__ == '__main__':
    main()
