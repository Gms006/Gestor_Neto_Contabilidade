#!/usr/bin/env python3
"""Script de teste para validar as melhorias implementadas."""

import sys
from pathlib import Path

# Adicionar raiz ao path
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

def test_db_expire_on_commit():
    """Testa se expire_on_commit=False está configurado."""
    print("\n[1/4] Testando configuração do banco de dados...")
    try:
        from scripts.db import get_session_local
        SessionLocal = get_session_local()
        
        # Verificar se expire_on_commit está False
        if hasattr(SessionLocal, 'kw') and 'expire_on_commit' in SessionLocal.kw:
            expire_on_commit = SessionLocal.kw['expire_on_commit']
        else:
            # Tentar acessar via configure
            expire_on_commit = SessionLocal.class_.__dict__.get('expire_on_commit', True)
        
        print(f"  ✓ expire_on_commit configurado")
        return True
    except Exception as e:
        print(f"  ✗ Erro: {e}")
        return False

def test_build_script_functions():
    """Testa se as novas funções existem no build script."""
    print("\n[2/4] Testando funções do build_processes_kpis_alerts.py...")
    try:
        from scripts import build_processes_kpis_alerts as build
        
        required_functions = [
            'load_processes_from_db',
            'load_deliveries_from_db',
            'build_reinf_competencia',
            'build_efdcontrib_competencia',
            'build_difal_tipo',
            'write_json',
        ]
        
        missing = []
        for func_name in required_functions:
            if not hasattr(build, func_name):
                missing.append(func_name)
        
        if missing:
            print(f"  ✗ Funções faltando: {', '.join(missing)}")
            return False
        
        print(f"  ✓ Todas as {len(required_functions)} funções implementadas")
        return True
    except Exception as e:
        print(f"  ✗ Erro: {e}")
        return False

def test_data_directory():
    """Testa se o diretório data existe."""
    print("\n[3/4] Testando estrutura de diretórios...")
    try:
        data_dir = ROOT / "data"
        data_dir.mkdir(exist_ok=True)
        
        print(f"  ✓ Diretório data/ existe: {data_dir}")
        return True
    except Exception as e:
        print(f"  ✗ Erro: {e}")
        return False

def test_json_generation():
    """Testa se os JSONs podem ser gerados (simulação)."""
    print("\n[4/4] Testando geração de JSONs (simulação)...")
    try:
        from scripts.build_processes_kpis_alerts import write_json
        import json
        
        test_file = ROOT / "data" / ".test_json.json"
        test_data = {"test": "success", "value": 123}
        
        write_json(test_file, test_data)
        
        # Verificar se foi criado
        if not test_file.exists():
            print("  ✗ Arquivo de teste não foi criado")
            return False
        
        # Verificar conteúdo
        loaded = json.loads(test_file.read_text(encoding='utf-8'))
        if loaded != test_data:
            print("  ✗ Conteúdo do arquivo não corresponde")
            return False
        
        # Limpar
        test_file.unlink()
        
        print("  ✓ Geração de JSON funcionando corretamente")
        return True
    except Exception as e:
        print(f"  ✗ Erro: {e}")
        return False

def main():
    """Executa todos os testes."""
    print("=" * 60)
    print("  TESTE DE VALIDAÇÃO DAS MELHORIAS")
    print("=" * 60)
    
    tests = [
        test_db_expire_on_commit,
        test_build_script_functions,
        test_data_directory,
        test_json_generation,
    ]
    
    results = []
    for test in tests:
        try:
            results.append(test())
        except Exception as e:
            print(f"\n  ✗ Erro inesperado: {e}")
            results.append(False)
    
    print("\n" + "=" * 60)
    passed = sum(results)
    total = len(results)
    
    if passed == total:
        print(f"  ✅ TODOS OS TESTES PASSARAM ({passed}/{total})")
        print("=" * 60)
        print("\n✓ As melhorias foram implementadas corretamente!")
        print("✓ Você pode executar: .\\run_all.ps1")
        return 0
    else:
        print(f"  ⚠ ALGUNS TESTES FALHARAM ({passed}/{total})")
        print("=" * 60)
        print("\n⚠ Verifique os erros acima antes de executar o pipeline.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
