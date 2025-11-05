import prisma from '../config/database';
import { gerarObrigacoesPresumido } from '../services/obrigacoes.service';
import { FlowContext, FlowResult, moveToStage } from './types';

const STAGES = {
  CAPTURAR_COMPETENCIA: 'LP_CAPTURAR_COMPETENCIA',
  COLETA: 'LP_COLETA',
  PIS_DEBITO: 'LP_PIS_DEBITO',
  PIS_MOTIVO: 'LP_PIS_MOTIVO',
  ICMS_DEVIDO: 'LP_ICMS_DEVIDO',
  ICMS_GUIA: 'LP_ICMS_GUIA',
  ICMS_JUSTIFICATIVA: 'LP_ICMS_JUSTIFICATIVA',
  DIFAL_INTERESTADUAL: 'LP_DIFAL_INTERESTADUAL',
  DIFAL_TIPO: 'LP_DIFAL_TIPO',
  REINF: 'LP_REINF',
  LUCROS: 'LP_LUCROS',
  LUCROS_VALOR: 'LP_LUCROS_VALOR',
  FOLHA: 'LP_FOLHA',
  FATURAMENTO_ANTERIOR: 'LP_FATURAMENTO_ANTERIOR',
  CONCLUSAO: 'LP_CONCLUSAO',
} as const;

type LPState = {
  empresaId?: string;
  competenciaId?: string;
  mesAno?: string;
  coletaOk?: boolean;
  pisDebito?: boolean;
  pisMotivo?: string;
  icmsDevido?: boolean;
  icmsGuia?: boolean;
  icmsJustificativa?: string;
  difalUso?: 'consumo' | 'imobilizado' | 'ambos' | 'nenhum';
  reinf?: boolean;
  lucros?: { houve: boolean; valor?: number };
  temFolha?: boolean;
  faturouMesAnterior?: boolean;
  periodicidade?: 'Trimestral' | 'Estimativa';
};

function ensureLpState(state: FlowContext['state']): LPState {
  if (!state.data.lp) {
    state.data.lp = {};
  }
  return state.data.lp as LPState;
}

export async function handleLP(context: FlowContext): Promise<FlowResult> {
  const { conversa, text } = context;
  const state = context.state;
  const lpState = ensureLpState(state);
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
        lpState.mesAno = mesAno;

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

        lpState.competenciaId = competencia.id;
        const nextState = moveToStage(state, STAGES.COLETA);
        messages.push('Coleta/Importação finalizada? (sim/não)');
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
    case STAGES.COLETA: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Responda com "sim" ou "não" se a coleta foi concluída.');
        return { messages, state };
      }
      lpState.coletaOk = normalized === 'sim';
      const nextState = moveToStage(state, STAGES.PIS_DEBITO);
      messages.push('PIS/COFINS teve débito no período? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.PIS_DEBITO: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Responda com "sim" ou "não".');
        return { messages, state };
      }
      lpState.pisDebito = normalized === 'sim';
      if (!lpState.pisDebito) {
        const nextState = moveToStage(state, STAGES.PIS_MOTIVO);
        messages.push('Qual o motivo válido? (Isenção ou Imunidade)');
        return {
          messages,
          state: nextState,
          conversa: await prisma.conversa.update({
            where: { id: conversa.id },
            data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
          }),
        };
      }
      const nextState = moveToStage(state, STAGES.ICMS_DEVIDO);
      messages.push('ICMS devido no mês? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.PIS_MOTIVO: {
      lpState.pisMotivo = resposta;
      const nextState = moveToStage(state, STAGES.ICMS_DEVIDO);
      messages.push('ICMS devido no mês? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.ICMS_DEVIDO: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Responda com "sim" ou "não".');
        return { messages, state };
      }
      lpState.icmsDevido = normalized === 'sim';
      if (lpState.icmsDevido) {
        const nextState = moveToStage(state, STAGES.ICMS_GUIA);
        messages.push('Guia gerada? (sim/não)');
        return {
          messages,
          state: nextState,
          conversa: await prisma.conversa.update({
            where: { id: conversa.id },
            data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
          }),
        };
      }
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
    case STAGES.ICMS_GUIA: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Responda com "sim" ou "não".');
        return { messages, state };
      }
      lpState.icmsGuia = normalized === 'sim';
      if (!lpState.icmsGuia) {
        const nextState = moveToStage(state, STAGES.ICMS_JUSTIFICATIVA);
        messages.push('Informe a justificativa pela ausência da guia.');
        return {
          messages,
          state: nextState,
          conversa: await prisma.conversa.update({
            where: { id: conversa.id },
            data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
          }),
        };
      }
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
    case STAGES.ICMS_JUSTIFICATIVA: {
      lpState.icmsJustificativa = resposta;
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
        messages.push('Responda com "sim" ou "não".');
        return { messages, state };
      }
      if (normalized === 'sim') {
        const nextState = moveToStage(state, STAGES.DIFAL_TIPO);
        messages.push('Qual o destino? (consumo/imobilizado/ambos)');
        return {
          messages,
          state: nextState,
          conversa: await prisma.conversa.update({
            where: { id: conversa.id },
            data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
          }),
        };
      }
      lpState.difalUso = 'nenhum';
      const nextState = moveToStage(state, STAGES.REINF);
      messages.push('Houve REINF no período? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.DIFAL_TIPO: {
      const normalized = resposta.toLowerCase();
      if (!['consumo', 'imobilizado', 'ambos'].includes(normalized)) {
        messages.push('Escolha consumo, imobilizado ou ambos.');
        return { messages, state };
      }
      lpState.difalUso = normalized as LPState['difalUso'];
      const nextState = moveToStage(state, STAGES.REINF);
      messages.push('Houve REINF no período? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.REINF: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Responda com "sim" ou "não".');
        return { messages, state };
      }
      lpState.reinf = normalized === 'sim';
      if (lpState.reinf) {
        const nextState = moveToStage(state, STAGES.LUCROS);
        messages.push('Houve distribuição de lucros? (sim/não)');
        return {
          messages,
          state: nextState,
          conversa: await prisma.conversa.update({
            where: { id: conversa.id },
            data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
          }),
        };
      }
      lpState.lucros = { houve: false };
      const nextState = moveToStage(state, STAGES.FOLHA);
      messages.push('Houve folha de pagamento no mês? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.LUCROS: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Responda com "sim" ou "não".');
        return { messages, state };
      }
      lpState.lucros = { houve: normalized === 'sim' };
      if (lpState.lucros.houve) {
        const nextState = moveToStage(state, STAGES.LUCROS_VALOR);
        messages.push('Qual o valor distribuído?');
        return {
          messages,
          state: nextState,
          conversa: await prisma.conversa.update({
            where: { id: conversa.id },
            data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
          }),
        };
      }
      const nextState = moveToStage(state, STAGES.FOLHA);
      messages.push('Houve folha de pagamento no mês? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.LUCROS_VALOR: {
      const valor = Number(resposta.replace(/,/g, '.'));
      if (Number.isNaN(valor) || valor <= 0) {
        messages.push('Informe o valor numérico distribuído.');
        return { messages, state };
      }
      lpState.lucros = { houve: true, valor };
      const nextState = moveToStage(state, STAGES.FOLHA);
      messages.push('Houve folha de pagamento no mês? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.FOLHA: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Responda com "sim" ou "não".');
        return { messages, state };
      }
      lpState.temFolha = normalized === 'sim';
      const nextState = moveToStage(state, STAGES.FATURAMENTO_ANTERIOR);
      messages.push('Houve faturamento no mês anterior? (sim/não)');
      return {
        messages,
        state: nextState,
        conversa: await prisma.conversa.update({
          where: { id: conversa.id },
          data: { etapaAtual: nextState.stage, estadoJson: JSON.stringify(nextState) },
        }),
      };
    }
    case STAGES.FATURAMENTO_ANTERIOR: {
      const normalized = resposta.toLowerCase();
      if (!['sim', 'não', 'nao'].includes(normalized)) {
        messages.push('Responda com "sim" ou "não".');
        return { messages, state };
      }
      lpState.faturouMesAnterior = normalized === 'sim';
      const empresa = await prisma.empresa.findUnique({ where: { id: conversa.empresaId! } });
      lpState.periodicidade = (empresa?.periodicidadeIrpjCsll as LPState['periodicidade']) || 'Trimestral';
      const nextState = moveToStage(state, STAGES.CONCLUSAO);
      return concluirLP(conversa, lpState, nextState, messages);
    }
    case STAGES.CONCLUSAO:
    default: {
      const nextState = moveToStage(state, STAGES.CONCLUSAO);
      return concluirLP(conversa, lpState, nextState, messages);
    }
  }
}

async function concluirLP(
  conversa: FlowContext['conversa'],
  lpState: LPState,
  nextState: FlowContext['state'],
  messages: string[]
): Promise<FlowResult> {
  if (!lpState.competenciaId || !lpState.mesAno) {
    messages.push('Competência não identificada. Reinicie o fluxo com "novo".');
    return { messages, state: nextState };
  }

  const obrigacoes = await gerarObrigacoesPresumido({
    competenciaId: lpState.competenciaId,
    mesAno: lpState.mesAno,
    empresaId: conversa.empresaId!,
    pisCofinsDebito: lpState.pisDebito ?? true,
    pisCofinsMotivo: lpState.pisMotivo,
    icmsDevido: lpState.icmsDevido ?? false,
    icmsGuiaGerada: lpState.icmsGuia ?? false,
    icmsJustificativa: lpState.icmsJustificativa,
    difalUso: lpState.difalUso,
    reinf: lpState.reinf ?? false,
    distribuicaoLucros: lpState.lucros,
    temFolha: lpState.temFolha ?? false,
    faturouMesAnterior: lpState.faturouMesAnterior ?? false,
    periodicidadeIrpjCsll: lpState.periodicidade,
  });

  messages.push('Fluxo Lucro Presumido concluído. Obrigações geradas:');
  obrigacoes.forEach((ob) => {
    messages.push(`- ${ob.tipo} (${ob.esfera}) vence em ${ob.diasParaVenc ?? ''} dias.`);
  });
  messages.push('Use "resumo" para revisar ou "nova empresa" para iniciar outro atendimento.');

  const updated = await prisma.conversa.update({
    where: { id: conversa.id },
    data: {
      etapaAtual: 'LP_CONCLUIDO',
      estadoJson: JSON.stringify(nextState),
    },
  });

  return { messages, state: nextState, conversa: updated };
}
