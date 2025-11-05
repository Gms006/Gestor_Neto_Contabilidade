import prisma from '../config/database';
import { gerarObrigacoesSN } from '../services/obrigacoes.service';
import { FlowContext, FlowResult, moveToStage } from './types';

const STAGES = {
  CAPTURAR_COMPETENCIA: 'SN_CAPTURAR_COMPETENCIA',
  MOVIMENTO: 'SN_MOVIMENTO',
  JETTAX: 'SN_JETTAX',
  DOMINIO: 'SN_DOMINIO',
  SITTAX: 'SN_SITTAX',
  CONFRONTO: 'SN_CONFRONTO',
  DIFAL_INTERESTADUAL: 'SN_DIFAL_INTERESTADUAL',
  DIFAL_TIPO: 'SN_DIFAL_TIPO',
  CONCLUSAO: 'SN_CONCLUSAO',
} as const;

type SNState = {
  empresaId?: string;
  competenciaId?: string;
  mesAno?: string;
  houveMovimento?: boolean;
  jettax?: string;
  dominio?: string;
  sittax?: string;
  confronto?: string;
  houveDifal?: boolean;
  difalTipo?: 'consumo' | 'comercializacao' | 'ambos';
  observacoes?: string[];
};

function ensureSnState(state: FlowContext['state']): SNState {
  if (!state.data.sn) {
    state.data.sn = {};
  }
  return state.data.sn as SNState;
}

export async function handleSN(context: FlowContext): Promise<FlowResult> {
  const { conversa, text } = context;
  const state = context.state;
  const snState = ensureSnState(state);
  const messages: string[] = [];
  const resposta = text.trim();

  switch (state.stage) {
    case STAGES.CAPTURAR_COMPETENCIA: {
      try {
        const match = resposta.match(/(\d{2})\/(\d{4})|(\d{4})-(\d{2})/);
        if (!match) {
          messages.push('Informe a competência no formato MM/AAAA.');
          return { messages, state };
        }
        const [mes, ano] = resposta.includes('/')
          ? resposta.split('/')
          : resposta.split('-').reverse();
        const mesAno = `${ano}-${mes.padStart(2, '0')}`;
        snState.mesAno = mesAno;

        const competencia = await prisma.competencia.upsert({
          where: {
            empresaId_mesAno: {
              empresaId: conversa.empresaId!,
              mesAno,
            },
          },
          update: { status: 'Em Andamento' },
          create: {
            empresaId: conversa.empresaId!,
            mesAno,
            status: 'Em Andamento',
            dataInicio: new Date(),
          },
        });

        snState.competenciaId = competencia.id;
        state.competenciaId = competencia.id;

        const nextState = moveToStage(state, STAGES.MOVIMENTO);
        messages.push('Competência registrada. Houve movimento no mês? (sim/não)');
        return {
          messages,
          state: nextState,
          conversa: await prisma.conversa.update({
            where: { id: conversa.id },
            data: {
              competenciaId: competencia.id,
              etapaAtual: nextState.stage,
              estadoJson: JSON.stringify(nextState),
            },
          }),
        };
      } catch (error) {
        messages.push('Não foi possível registrar a competência. Verifique o formato informado.');
        return { messages, state };
      }
    }
    case STAGES.MOVIMENTO: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Responda com "sim" ou "não" se houve movimento.');
        return { messages, state };
      }
      snState.houveMovimento = normalized === 'sim';
      const nextState = moveToStage(state, STAGES.JETTAX);
      messages.push('No Jettax, houve sugestão automática aceita? (auto/manual/conflito)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.JETTAX: {
      const normalized = resposta.toLowerCase();
      if (!['auto', 'manual', 'conflito'].includes(normalized)) {
        messages.push('Responda com "auto", "manual" ou "conflito" para a etapa Jettax.');
        return { messages, state };
      }
      snState.jettax = normalized;
      const nextState = moveToStage(state, STAGES.DOMINIO);
      messages.push('No Domínio, a importação foi concluída? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.DOMINIO: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Informe "sim" ou "não" para o Domínio.');
        return { messages, state };
      }
      snState.dominio = normalized;
      const nextState = moveToStage(state, STAGES.SITTAX);
      messages.push('Na Sittax, houve divergências? (ok/manual/conflito)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.SITTAX: {
      const normalized = resposta.toLowerCase();
      if (!['ok', 'manual', 'conflito'].includes(normalized)) {
        messages.push('Responda com "ok", "manual" ou "conflito" para a Sittax.');
        return { messages, state };
      }
      snState.sittax = normalized;
      const nextState = moveToStage(state, STAGES.CONFRONTO);
      messages.push('Confronto Sittax x Domínio finalizado? (sim/ajustes)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.CONFRONTO: {
      snState.confronto = resposta.toLowerCase();
      const nextState = moveToStage(state, STAGES.DIFAL_INTERESTADUAL);
      messages.push('Houve compra interestadual? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.DIFAL_INTERESTADUAL: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Informe se houve compra interestadual (sim/não).');
        return { messages, state };
      }
      snState.houveDifal = normalized === 'sim';
      if (snState.houveDifal) {
        const nextState = moveToStage(state, STAGES.DIFAL_TIPO);
        messages.push('Qual o tipo de DIFAL? (comercializacao/consumo/ambos)');
        return {
          messages,
          state: nextState,
          conversa: await prisma.conversa.update({
            where: { id: conversa.id },
            data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
          }),
        };
      }
      const nextState = moveToStage(state, STAGES.CONCLUSAO);
      return concluirSN(conversa, snState, nextState, messages);
    }
    case STAGES.DIFAL_TIPO: {
      const normalized = resposta.toLowerCase();
      if (!['comercializacao', 'comercialização', 'consumo', 'ambos'].includes(normalized)) {
        messages.push('Escolha entre comercializacao, consumo ou ambos.');
        return { messages, state };
      }
      snState.difalTipo = normalized.startsWith('comercial')
        ? 'comercializacao'
        : normalized as 'consumo' | 'ambos';
      const nextState = moveToStage(state, STAGES.CONCLUSAO);
      return concluirSN(conversa, snState, nextState, messages);
    }
    case STAGES.CONCLUSAO:
    default: {
      const nextState = moveToStage(state, STAGES.CONCLUSAO);
      return concluirSN(conversa, snState, nextState, messages);
    }
  }
}

async function concluirSN(
  conversa: FlowContext['conversa'],
  snState: SNState,
  nextState: FlowContext['state'],
  messages: string[]
): Promise<FlowResult> {
  if (!snState.competenciaId || !snState.mesAno) {
    messages.push('Competência não identificada. Reinicie o fluxo com "novo".');
    return { messages, state: nextState };
  }

  const obrigacoes = await gerarObrigacoesSN({
    competenciaId: snState.competenciaId,
    mesAno: snState.mesAno,
    empresaId: conversa.empresaId!,
    houveMovimento: snState.houveMovimento ?? true,
    houveCompraInterestadual: snState.houveDifal ?? false,
    difalTipo: snState.difalTipo,
    justificativas: snState.observacoes,
  });

  messages.push('Fluxo SN concluído. Obrigações geradas:');
  obrigacoes.forEach((ob) => {
    messages.push(`- ${ob.tipo} (${ob.esfera}) vence em ${ob.diasParaVenc ?? ''} dias.`);
  });
  messages.push('Use "resumo" para ver o status geral ou "nova empresa" para iniciar outro atendimento.');

  const updated = await prisma.conversa.update({
    where: { id: conversa.id },
    data: {
      etapaAtual: 'SN_CONCLUIDO',
      estadoJson: JSON.stringify(nextState),
    },
  });

  return { messages, state: nextState, conversa: updated };
}
