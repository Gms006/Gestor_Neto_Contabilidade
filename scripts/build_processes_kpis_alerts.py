#!/usr/bin/env python3
"""
build_processes_kpis_alerts.py
Gera processes.json, kpis.json e alerts.json
"""

import sys
import json
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from utils.logger import setup_logger
from utils.date_helpers import parse_date

logger = setup_logger('build_kpis_alerts')

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / 'data'
CONFIG_FILE = BASE_DIR / 'scripts' / 'config.json'

def load_config():
    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)

def load_events():
    with open(DATA_DIR / 'events.json', 'r', encoding='utf-8') as f:
        return json.load(f)

def load_raw_processes():
    """Carrega processos brutos da API"""
    raw_file = BASE_DIR / 'data' / 'raw_api' / 'processes_latest.json'
    if raw_file.exists():
        with open(raw_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return []

def build_processes(events, raw_processes):
    """Constrói processes.json"""
    processes_dict = defaultdict(lambda: {
        'eventos': [],
        'inicio': None,
        'conclusao': None,
        'kpis': defaultdict(set)
    })
    
    # Indexa processos brutos
    raw_index = {p.get('ProcID'): p for p in raw_processes}
    
    # Agrupa eventos por processo
    for event in events:
        proc_id = event['proc_id']
        competencia = event.get('competencia')
        key = f"{proc_id}_{competencia}" if competencia else proc_id
        
        processes_dict[key]['eventos'].append(event)
        processes_dict[key]['proc_id'] = proc_id
        processes_dict[key]['competencia'] = competencia
        
        # Atualiza KPIs
        categoria = event['categoria']
        if categoria in ['efd_reinf', 'efd_contrib']:
            if event['subtipo'] == 'obrig':
                processes_dict[key]['kpis'][categoria] = 'Obrigatória'
            elif event['subtipo'] == 'dispensa':
                processes_dict[key]['kpis'][categoria] = 'Dispensada'
        
        elif categoria == 'difal' and event['subtipo']:
            processes_dict[key]['kpis']['difal'] = event['subtipo']
        
        elif categoria == 'fora_das' and event['subtipo']:
            processes_dict[key]['kpis']['fora_das'].add(event['subtipo'])
    
    # Constrói lista final
    processes = []
    for key, data in processes_dict.items():
        proc_id = data['proc_id']
        raw_proc = raw_index.get(proc_id, {})
        
        # Determina datas
        eventos_datas = [e['data_evento'] for e in data['eventos'] if e.get('data_evento')]
        inicio = min(eventos_datas) if eventos_datas else raw_proc.get('ProcInicio')
        
        # Verifica se tem finalização
        finalizacoes = [e for e in data['eventos'] if e['categoria'] == 'finalizacao']
        conclusao = max([e['data_evento'] for e in finalizacoes if e.get('data_evento')], default=None)
        
        if not conclusao:
            conclusao = raw_proc.get('ProcConclusao') if raw_proc.get('ProcStatus') == 'C' else None
        
        # Calcula dias corridos
        dias_corridos = None
        if inicio and conclusao:
            try:
                dt_inicio = parse_date(inicio)
                dt_conclusao = parse_date(conclusao)
                if dt_inicio and dt_conclusao:
                    dias_corridos = (dt_conclusao - dt_inicio).days
            except:
                pass
        
        if not dias_corridos:
            dias_corridos = raw_proc.get('ProcDiasCorridos')
        
        # Responsável final
        responsavel_final = None
        if finalizacoes:
            responsavel_final = finalizacoes[-1].get('responsavel')
        
        process = {
            'proc_id': proc_id,
            'empresa': data['eventos'][0].get('empresa') if data['eventos'] else raw_proc.get('EmpNome'),
            'cnpj': data['eventos'][0].get('cnpj') if data['eventos'] else raw_proc.get('EmpCNPJ'),
            'competencia': data.get('competencia'),
            'inicio': inicio,
            'conclusao': conclusao,
            'dias_corridos': dias_corridos,
            'status': raw_proc.get('ProcStatus'),
            'gestor': raw_proc.get('ProcGestor'),
            'responsavel_final': responsavel_final,
            'ultimo_update': raw_proc.get('DtLastDH'),
            'kpis': {
                'efd_reinf': data['kpis'].get('efd_reinf'),
                'efd_contrib': data['kpis'].get('efd_contrib'),
                'difal': data['kpis'].get('difal'),
                'fora_das': list(data['kpis'].get('fora_das', []))
            }
        }
        
        processes.append(process)
    
    return processes

def build_kpis(events, processes):
    """Constrói kpis.json"""
    kpis = {
        'entregas_por_competencia': defaultdict(lambda: {'reinf_obrig': 0, 'reinf_disp': 0, 'efd_obrig': 0, 'efd_disp': 0}),
        'difal_por_tipo': defaultdict(int),
        'fora_das_por_tipo': defaultdict(int),
        'produtividade': {},
        'evolucao_fechamento': defaultdict(list)
    }
    
    # Entregas por competência
    for event in events:
        comp = event.get('competencia')
        if not comp:
            continue
        
        if event['categoria'] == 'efd_reinf':
            if event['subtipo'] == 'obrig':
                kpis['entregas_por_competencia'][comp]['reinf_obrig'] += 1
            elif event['subtipo'] == 'dispensa':
                kpis['entregas_por_competencia'][comp]['reinf_disp'] += 1
        
        elif event['categoria'] == 'efd_contrib':
            if event['subtipo'] == 'obrig':
                kpis['entregas_por_competencia'][comp]['efd_obrig'] += 1
            elif event['subtipo'] == 'dispensa':
                kpis['entregas_por_competencia'][comp]['efd_disp'] += 1
        
        elif event['categoria'] == 'difal' and event['subtipo']:
            kpis['difal_por_tipo'][event['subtipo']] += 1
        
        elif event['categoria'] == 'fora_das' and event['subtipo']:
            kpis['fora_das_por_tipo'][event['subtipo']] += 1
    
    # Produtividade
    finalizados = [p for p in processes if p.get('conclusao')]
    tempos = [p['dias_corridos'] for p in finalizados if p.get('dias_corridos')]
    
    kpis['produtividade'] = {
        'finalizados_total': len(finalizados),
        'tempo_medio': sum(tempos) / len(tempos) if tempos else 0,
        'tempo_mediano': sorted(tempos)[len(tempos)//2] if tempos else 0,
        'ranking_por_responsavel': {}
    }
    
    # Ranking por responsável
    resp_stats = defaultdict(lambda: {'count': 0, 'tempo_total': 0})
    for proc in finalizados:
        resp = proc.get('responsavel_final')
        if resp and proc.get('dias_corridos'):
            resp_stats[resp]['count'] += 1
            resp_stats[resp]['tempo_total'] += proc['dias_corridos']
    
    for resp, stats in resp_stats.items():
        kpis['produtividade']['ranking_por_responsavel'][resp] = {
            'finalizados': stats['count'],
            'tempo_medio': stats['tempo_total'] / stats['count']
        }
    
    # Evolução fechamento (dia do mês)
    for proc in finalizados:
        if proc.get('conclusao') and proc.get('competencia'):
            try:
                dt_conclusao = parse_date(proc['conclusao'])
                if dt_conclusao:
                    comp = proc['competencia']
                    dia_mes = dt_conclusao.day
                    kpis['evolucao_fechamento'][comp].append(dia_mes)
            except:
                pass
    
    # Calcula médias por competência
    for comp, dias in kpis['evolucao_fechamento'].items():
        kpis['evolucao_fechamento'][comp] = {
            'media': sum(dias) / len(dias) if dias else 0,
            'mediana': sorted(dias)[len(dias)//2] if dias else 0,
            'contagem': len(dias)
        }
    
    # Converte defaultdict para dict normal
    kpis['entregas_por_competencia'] = dict(kpis['entregas_por_competencia'])
    kpis['difal_por_tipo'] = dict(kpis['difal_por_tipo'])
    kpis['fora_das_por_tipo'] = dict(kpis['fora_das_por_tipo'])
    kpis['evolucao_fechamento'] = dict(kpis['evolucao_fechamento'])
    
    return kpis

def build_alerts(events, processes, config):
    """Constrói alerts.json"""
    alerts = {
        'sn_em_risco': [],
        'reinf_em_risco': [],
        'bloqueantes': [],
        'nao_mapeados_api': [],
        'divergencias': []
    }
    
    hoje = datetime.now().date()
    deadlines = config['deadlines']
    warning_days_cfg = config['warning_days']
    
    # Carrega alertas temporários
    temp_file = DATA_DIR / 'temp_alerts.json'
    if temp_file.exists():
        with open(temp_file, 'r', encoding='utf-8') as f:
            temp_alerts = json.load(f)
            alerts['divergencias'] = temp_alerts.get('divergencias', [])
            alerts['nao_mapeados_api'] = temp_alerts.get('nao_mapeados_api', [])
    
    # Alertas de prazo SN e REINF
    for proc in processes:
        comp = proc.get('competencia')
        if not comp or proc.get('conclusao'):
            continue
        
        try:
            ano, mes = map(int, comp.split('-'))
            
            # SN - dia 20
            prazo_sn = datetime(ano, mes, deadlines['sn_day']).date()
            dias_para_sn = (prazo_sn - hoje).days
            
            if 0 <= dias_para_sn <= warning_days_cfg['sn']:
                alerts['sn_em_risco'].append({
                    'proc_id': proc['proc_id'],
                    'empresa': proc['empresa'],
                    'competencia': comp,
                    'prazo': prazo_sn.isoformat(),
                    'dias_para_prazo': dias_para_sn
                })
            
            # REINF - dia 15
            prazo_reinf = datetime(ano, mes, deadlines['reinf_day']).date()
            dias_para_reinf = (prazo_reinf - hoje).days
            
            # Verifica se tem REINF obrigatória
            has_reinf_obrig = proc['kpis'].get('efd_reinf') == 'Obrigatória'
            
            if has_reinf_obrig and 0 <= dias_para_reinf <= warning_days_cfg['reinf']:
                alerts['reinf_em_risco'].append({
                    'proc_id': proc['proc_id'],
                    'empresa': proc['empresa'],
                    'competencia': comp,
                    'prazo': prazo_reinf.isoformat(),
                    'dias_para_prazo': dias_para_reinf
                })
        
        except:
            pass
    
    # Bloqueantes
    for event in events:
        if event.get('bloqueante') and event.get('passo_status') != 'OK':
            alerts['bloqueantes'].append({
                'proc_id': event['proc_id'],
                'passo': event.get('categoria'),
                'responsavel': event.get('responsavel'),
                'prazo': event.get('prazo')
            })
    
    return alerts

def main():
    logger.info("=" * 60)
    logger.info("BUILD PROCESSES/KPIs/ALERTS - Início")
    logger.info("=" * 60)
    
    config = load_config()
    events = load_events()
    raw_processes = load_raw_processes()
    
    logger.info(f"Eventos carregados: {len(events)}")
    logger.info(f"Processos brutos: {len(raw_processes)}")
    
    # Build processes
    processes = build_processes(events, raw_processes)
    logger.info(f"Processos gerados: {len(processes)}")
    
    with open(DATA_DIR / 'processes.json', 'w', encoding='utf-8') as f:
        json.dump(processes, f, indent=2, ensure_ascii=False)
    
    # Build KPIs
    kpis = build_kpis(events, processes)
    logger.info("KPIs gerados")
    
    with open(DATA_DIR / 'kpis.json', 'w', encoding='utf-8') as f:
        json.dump(kpis, f, indent=2, ensure_ascii=False)
    
    # Build alerts
    alerts = build_alerts(events, processes, config)
    logger.info(f"Alertas: SN={len(alerts['sn_em_risco'])}, REINF={len(alerts['reinf_em_risco'])}, Bloq={len(alerts['bloqueantes'])}")
    
    with open(DATA_DIR / 'alerts.json', 'w', encoding='utf-8') as f:
        json.dump(alerts, f, indent=2, ensure_ascii=False)
    
    logger.info("BUILD PROCESSES/KPIs/ALERTS - Concluído")
    logger.info("=" * 60)

if __name__ == '__main__':
    main()
