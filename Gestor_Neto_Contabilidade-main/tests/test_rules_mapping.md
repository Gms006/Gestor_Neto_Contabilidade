# Teste de Mapeamento de Regras

## Objetivo
Validar que os nomes de passos das matrizes são corretamente mapeados para categorias.

## Casos de Teste

| Nome do Passo | Categoria Esperada | Subtipo Esperado | Status Esperado |
|---------------|-------------------|------------------|-----------------|
| Gerar Obrigação - REINF | efd_reinf | obrig | Obrigatória |
| Dispensa de Entrega - EFD REINF | efd_reinf | dispensa | Dispensada |
| Validar MIT preenchida — EFD Contribuições obrigatoriedade | efd_contrib | obrig | Obrigatória |
| Obrigação de entrega - EFD Contribuições | efd_contrib | obrig | Obrigatória |
| Dispensa da entrega das declarações | efd_contrib | dispensa | Dispensada |
| Tipo de DIFAL → Comercialização | difal | comercializacao | Incidência confirmada |
| Tipo de DIFAL → Consumo/Imobilizado | difal | consumo_imobilizado | Obrigatório |
| Tipo de DIFAL → Ambos | difal | ambos | Obrigatório |
| Recolhimento de ISS por fora do DAS | fora_das | ISS | Emitir guia municipal |
| Recolhimento de ICMS por fora do DAS | fora_das | ICMS | Emitir guia estadual |
| Recolhimento de ICMS e ISS por fora do DAS | fora_das | ISS_ICMS | Emitir guias |
| Processo fiscal encerrado | finalizacao | null | Finalizado |
| Concluir apuração Mensal | finalizacao | null | Finalizado |

## Como Testar

1. Execute `flatten_steps.py`
2. Verifique o arquivo `data/events_api.json`
3. Confirme que cada evento possui:
   - `categoria` correta
   - `subtipo` correto
   - `status` correto
4. Se houver passos não mapeados, adicione novas regras em `scripts/rules.json`

## Extensibilidade

Para adicionar novos departamentos (Contabilidade, Societário, Pessoal):

1. Crie novas categorias em `rules.json`
2. Adicione matchers com os nomes dos passos específicos
3. Atualize `config.json` para habilitar o departamento
4. Os eventos serão automaticamente processados
