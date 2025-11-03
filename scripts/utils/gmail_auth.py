"""
gmail_auth.py
Autenticação OAuth2 para Gmail API
"""

import os
import pickle
from pathlib import Path
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

BASE_DIR = Path(__file__).parent.parent.parent
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

CREDENTIALS_FILE = BASE_DIR / 'credentials.json'
TOKEN_FILE = BASE_DIR / 'token.json'

def get_gmail_service():
    """Autentica e retorna serviço Gmail"""
    creds = None
    
    # Token existente
    if TOKEN_FILE.exists():
        with open(TOKEN_FILE, 'rb') as token:
            creds = pickle.load(token)
    
    # Refresh se expirado
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    
    # Nova autenticação
    if not creds or not creds.valid:
        if not CREDENTIALS_FILE.exists():
            raise FileNotFoundError(
                f"Arquivo credentials.json não encontrado em {CREDENTIALS_FILE}\n"
                "Baixe as credenciais do Google Cloud Console"
            )
        
        flow = InstalledAppFlow.from_client_secrets_file(
            str(CREDENTIALS_FILE), SCOPES)
        creds = flow.run_local_server(port=0)
        
        # Salva token
        with open(TOKEN_FILE, 'wb') as token:
            pickle.dump(creds, token)
    
    return build('gmail', 'v1', credentials=creds)
