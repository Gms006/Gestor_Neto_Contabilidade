"""
logger.py
Sistema de logging centralizado
"""

import logging
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).parent.parent.parent
LOG_DIR = BASE_DIR / 'data'
LOG_DIR.mkdir(parents=True, exist_ok=True)

def setup_logger(name):
    """Configura logger com output para console e arquivo"""
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    
    # Remove handlers existentes
    logger.handlers = []
    
    # Formato
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    # File handler
    log_file = LOG_DIR / 'logs.txt'
    file_handler = logging.FileHandler(log_file, encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    
    return logger
