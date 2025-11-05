# 🚀 Gestor Neto Contabilidade - Melhorias Implementadas

## 📋 Resumo das Melhorias

Este projeto foi atualizado com as seguintes melhorias críticas para garantir que o pipeline funcione corretamente e o site exiba todos os dados:

### ✅ Correções Implementadas

1. **Correção do DetachedInstanceError no Banco de Dados**
   - Adicionado `expire_on_commit=False` no `sessionmaker` em `scripts/db.py`
   - Implementado eager loading com `selectinload` para carregar relacionamentos
   - Isso evita erros ao acessar dados após fechar a sessão

2. **Geração Completa de JSONs para o Frontend**
   - Atualizado `scripts/build_processes_kpis_alerts.py` para gerar TODOS os arquivos JSON necessários:
     - `processes.json` - Lista de processos
     - `kpis.json` - Indicadores de desempenho
     - `alerts.json` - Alertas e obrigações em risco
     - `meta.json` - Metadados de atualização
     - `fechamento_stats.json` - Estatísticas de fechamento (média e mediana)
     - `reinf_competencia.json` - Agregação de REINF por competência
     - `efdcontrib_competencia.json` - Agregação de EFD-Contribuições por competência
     - `difal_tipo.json` - Agregação de DIFAL por tipo
     - `deliveries.json` - Snapshot de deliveries para o frontend

3. **Snapshot de Deliveries**
   - Atualizado `scripts/fetch_deliveries.py` para salvar `deliveries.json` após coleta
   - Garante que o frontend tenha acesso aos dados mesmo com 204 em alguns CNPJs

4. **Script PowerShell Melhorado**
   - `run_all.ps1` agora:
     - Executa todo o pipeline automaticamente
     - Verifica se todos os arquivos JSON foram gerados
     - Exibe relatório visual com status de cada arquivo
     - Inicia o servidor FastAPI automaticamente
     - **Abre o navegador automaticamente** em `http://localhost:8088/web/`
     - Aguarda tecla antes de sair para facilitar visualização dos logs

## 🎯 Como Executar

### Pré-requisitos

1. **Python 3.10+** instalado (preferencialmente com ambiente virtual `.venv`)
2. **PowerShell** (Windows)
3. Arquivo `.env` configurado com `ACESSORIAS_TOKEN`

### Execução Simples

Abra o PowerShell na pasta do projeto e execute:

```powershell
# Permitir execução de scripts (apenas primeira vez)
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# Executar pipeline completo e abrir site
.\run_all.ps1
```

**OU** diretamente:

```powershell
powershell -ExecutionPolicy Bypass -File .\run_all.ps1
```

### O que Acontece

1. ✅ Carrega variáveis do `.env`
2. ✅ Coleta processos da API Acessórias
3. ✅ Coleta deliveries por CNPJ
4. ✅ Coleta dados de empresas
5. ✅ Processa passos dos processos
6. ✅ Coleta emails (se configurado)
7. ✅ Consolida todos os dados
8. ✅ Gera KPIs e alertas
9. ✅ **Verifica se todos os JSONs foram gerados**
10. ✅ **Inicia servidor FastAPI**
11. ✅ **Abre navegador automaticamente**

## 📊 Verificação de Arquivos

O script agora verifica automaticamente se os seguintes arquivos foram gerados em `data/`:

- ✓ `processes.json`
- ✓ `kpis.json`
- ✓ `alerts.json`
- ✓ `meta.json`
- ✓ `fechamento_stats.json`
- ✓ `reinf_competencia.json`
- ✓ `efdcontrib_competencia.json`
- ✓ `difal_tipo.json`
- ✓ `deliveries.json`
- ✓ `events.json`

Se algum arquivo estiver faltando ou vazio, o script exibirá um aviso.

## 🌐 Acessando o Site

Após a execução do script, o site estará disponível em:

- **Interface Web**: http://localhost:8088/web/
- **API REST**: http://localhost:8088/api/

O navegador será aberto automaticamente na interface web.

## 🔧 Detalhes Técnicos

### Arquivos Modificados

1. **`scripts/db.py`**
   - Linha 165: Adicionado `expire_on_commit=False`
   - Evita `DetachedInstanceError` ao acessar objetos após commit

2. **`scripts/build_processes_kpis_alerts.py`**
   - Implementado eager loading com `selectinload`
   - Adicionadas funções para gerar todos os JSONs necessários:
     - `build_reinf_competencia()` - Agrega REINF por competência
     - `build_efdcontrib_competencia()` - Agrega EFD-Contribuições
     - `build_difal_tipo()` - Agrega DIFAL por tipo
     - `load_deliveries_from_db()` - Carrega deliveries com eager loading
   - Materialize dados para dict antes de fechar sessão

3. **`scripts/fetch_deliveries.py`**
   - Linhas 277-280: Adicionado salvamento de `deliveries.json`
   - Garante que frontend tenha acesso aos dados coletados

4. **`run_all.ps1`**
   - Adicionado relatório visual de arquivos gerados
   - Inicialização automática do servidor
   - Abertura automática do navegador
   - Melhor feedback visual durante execução

### Estrutura de Dados Gerada

#### `fechamento_stats.json`
```json
{
  "media": 15.3,
  "mediana": 15,
  "n": 120
}
```

#### `reinf_competencia.json`
```json
{
  "series": [
    {"competencia": "2025-10", "obrigatoria": 45, "dispensa": 12},
    {"competencia": "2025-11", "obrigatoria": 50, "dispensa": 10}
  ]
}
```

#### `efdcontrib_competencia.json`
```json
{
  "series": [
    {"competencia": "2025-10", "obrigatoria": 38, "dispensa": 8},
    {"competencia": "2025-11", "obrigatoria": 42, "dispensa": 6}
  ]
}
```

#### `difal_tipo.json`
```json
{
  "tipos": [
    {"tipo": "Comercialização", "qtd": 25},
    {"tipo": "Consumo/Imobilizado", "qtd": 18}
  ]
}
```

## 🐛 Troubleshooting

### Site Abre Mas Cards Estão Vazios

1. Verifique se todos os JSONs foram gerados (o script mostra isso)
2. Abra DevTools (F12) → Network e recarregue a página
3. Verifique se há erros 404 ou JSON parse errors
4. Confira se os arquivos em `data/` não estão vazios

### Erro de Execução do PowerShell

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Backend Coleta Mas JSONs Não São Gerados

- Verifique se há erros no log durante `build_processes_kpis_alerts`
- Confirme que o banco de dados está acessível
- Execute manualmente: `python -m scripts.build_processes_kpis_alerts`

### Deliveries Aparecem Como 204 (No Content)

- Isso é normal para CNPJs sem deliveries no período
- O script agora trata isso corretamente e gera JSONs vazios quando necessário

## 📝 Notas Importantes

1. **Primeira Execução**: Pode demorar mais devido à coleta histórica de 6 meses
2. **Execuções Subsequentes**: Serão mais rápidas (apenas delta diário)
3. **Porta 8088**: Certifique-se de que está disponível
4. **Token da API**: Deve estar configurado no `.env`

## 🎉 Resultado Esperado

Após executar `run_all.ps1`, você verá:

1. ✅ Pipeline executando cada etapa com feedback visual
2. ✅ Relatório de arquivos gerados com status
3. ✅ Servidor FastAPI iniciando em nova janela
4. ✅ Navegador abrindo automaticamente
5. ✅ Site carregado com todos os dados nos cards e gráficos

## 📞 Suporte

Se encontrar problemas:

1. Verifique os logs em `data/logs.txt`
2. Confirme que o `.env` está configurado corretamente
3. Execute cada script manualmente para isolar o problema:
   ```powershell
   python -m scripts.fetch_api --full
   python -m scripts.fetch_deliveries
   python -m scripts.build_processes_kpis_alerts
   ```

---

**Versão**: 2.0 - Atualizado com todas as melhorias especificadas
**Data**: Novembro 2025
