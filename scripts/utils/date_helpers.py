"""
date_helpers.py
Funções auxiliares para manipulação de datas
"""

from datetime import datetime
from dateutil import parser

def parse_date(date_str):
    """Parse genérico de data"""
    if not date_str:
        return None
    
    if isinstance(date_str, datetime):
        return date_str
    
    try:
        return parser.parse(date_str)
    except:
        return None

def parse_date_br(date_str):
    """Parse de data no formato brasileiro dd/mm/aaaa"""
    if not date_str:
        return None
    
    try:
        return datetime.strptime(date_str, '%d/%m/%Y')
    except:
        return None

def infer_competencia(dt):
    """Infere competência (YYYY-MM) a partir de uma data"""
    if not dt:
        return None
    
    if isinstance(dt, str):
        dt = parse_date(dt)
    
    if not dt:
        return None
    
    return dt.strftime('%Y-%m')

def now_iso():
    """Retorna datetime atual em formato ISO"""
    return datetime.now().isoformat()
