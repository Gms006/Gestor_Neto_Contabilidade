import { Conversa } from '@prisma/client';
import prisma from '../config/database';
import { handleLP } from './LP_comercio';
import { handleSN } from './SN_comercio';
import { EngineState, FlowResult, moveToStage, PendingCommand } from './types';

export interface Reply {
  messages: string[];
  conversa: Conversa;
}

const INITIAL_STAGE = 'CAPTURAR_EMPRESA';

const SN_SEQUENCE = [
  'SN_CAPTURAR_COMPETENCIA',
  'SN_MOVIMENTO',
  'SN_JETTAX',
  'SN_DOMINIO',
  'SN_SITTAX',
  'SN_CONFRONTO',
  'SN_DIFAL_INTERESTADUAL',
  'SN_DIFAL_TIPO',
  'SN_CONCLUSAO',
];

const LP_SEQUENCE = [
  'LP_CAPTURAR_COMPETENCIA',
  'LP_COLETA',
  'LP_PIS_DEBITO',
  'LP_PIS_MOTIVO',
  'LP_ICMS_DEVIDO',
  'LP_ICMS_GUIA',
  'LP_ICMS_JUSTIFICATIVA',
  'LP_DIFAL_INTERESTADUAL',
  'LP_DIFAL_TIPO',
  'LP_REINF',
  'LP_LUCROS',
  'LP_LUCROS_VALOR',
  'LP_FOLHA',
  'LP_FATURAMENTO_ANTERIOR',
  'LP_CONCLUSAO',
];

const STAGE_PROMPTS: Record<string, string> = {
  [INITIAL_STAGE]: 'Informe o CNPJ ou nome da empresa para iniciar.',
  SN_CAPTURAR_COMPETENCIA: 'Informe a competência (MM/AAAA).',
  SN_MOVIMENTO: 'Houve movimento no mês? (sim/não)',
  SN_JETTAX: 'No Jettax, houve sugestão automática aceita? (auto/manual/conflito)',
  SN_DOMINIO: 'No Domínio, a importação foi concluída? (sim/não)',
  SN_SITTAX: 'Na Sittax, houve divergências? (ok/manual/conflito)',
  SN_CONFRONTO: 'Confronto Sittax x Domínio finalizado? (sim/ajustes)',
  SN_DIFAL_INTERESTADUAL: 'Houve compra interestadual? (sim/não)',
  SN_DIFAL_TIPO: 'Qual o tipo de DIFAL? (comercializacao/consumo/ambos)',
  LP_CAPTURAR_COMPETENCIA: 'Informe a competência (MM/AAAA).',
  LP_COLETA: 'Coleta/Importação finalizada? (sim/não)',
  LP_PIS_DEBITO: 'PIS/COFINS teve débito no período? (sim/não)',
  LP_PIS_MOTIVO: 'Qual o motivo válido? (Isenção ou Imunidade)',
  LP_ICMS_DEVIDO: 'ICMS devido no mês? (sim/não)',
  LP_ICMS_GUIA: 'Guia gerada? (sim/não)',
  LP_ICMS_JUSTIFICATIVA: 'Informe a justificativa pela ausência da guia.',
  LP_DIFAL_INTERESTADUAL: 'Houve compra interestadual? (sim/não)',
  LP_DIFAL_TIPO: 'Qual o destino? (consumo/imobilizado/ambos)',
  LP_REINF: 'Houve REINF no período? (sim/não)',
  LP_LUCROS: 'Houve distribuição de lucros? (sim/não)',
  LP_LUCROS_VALOR: 'Qual o valor distribuído?',
  LP_FOLHA: 'Houve folha de pagamento no mês? (sim/não)',
  LP_FATURAMENTO_ANTERIOR: 'Houve faturamento no mês anterior? (sim/não)',
};

function sanitizePhone(phone: string) {
  return phone.replace(/\D/g, '');
}

function ensureState(conversa: Conversa): EngineState {
  let stored: EngineState | null = null;
  if (typeof conversa.estadoJson === 'string') {
    try {
      stored = JSON.parse(conversa.estadoJson) as EngineState;
    } catch (error) {
      console.warn('Não foi possível ler estado da conversa:', error);
    }
  }

  return {
    stage: stored?.stage || INITIAL_STAGE,
    fluxo: stored?.fluxo,
    data: stored?.data || {},
    history: stored?.history || [],
    pending: stored?.pending ?? null,
  };
}

async function persistState(conversa: Conversa, state: EngineState, extra: Partial<Conversa> = {}) {
  const updated = await prisma.conversa.update({
    where: { id: conversa.id },
    data: {
      ...extra,
      etapaAtual: state.stage,
      estadoJson: JSON.stringify(state),
    },
  });
  return updated;
}

function isCommand(target: string, text: string) {
  return text === target || text.startsWith(`${target} `);
}

function getNextStage(currentStage: string, fluxo?: 'SN' | 'LP') {
  const sequence = fluxo === 'LP' ? LP_SEQUENCE : SN_SEQUENCE;
  const index = sequence.indexOf(currentStage);
  if (index === -1) {
    return sequence[0] ?? null;
  }
  return sequence[index + 1] ?? null;
}

export async function getOrStartConversa(phone: string): Promise<Conversa> {
  const normalizedPhone = sanitizePhone(phone);
  let conversa = await prisma.conversa.findFirst({
    where: { phone: normalizedPhone, ativa: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!conversa) {
    const initial: EngineState = { stage: INITIAL_STAGE, fluxo: undefined, data: {}, history: [], pending: null };
    conversa = await prisma.conversa.create({
      data: {
        phone: normalizedPhone,
        etapaAtual: initial.stage,
        estadoJson: JSON.stringify(initial),
        ativa: true,
      },
    });
  }

  return conversa;
}

async function handleCapturaEmpresa(conversa: Conversa, text: string, state: EngineState): Promise<Reply> {
  const term = text.trim();
  if (!term) {
    return { messages: ['Digite o CNPJ ou nome da empresa para continuar.'], conversa };
  }

  const cnpj = term.replace(/\D/g, '');
  const empresa = await prisma.empresa.findFirst({
    where: cnpj.length === 14 ? { cnpj } : { razaoSocial: { contains: term, mode: 'insensitive' } },
  });

  if (!empresa) {
    return {
      messages: ['Empresa não encontrada. Verifique o CNPJ ou nome e tente novamente.'],
      conversa,
    };
  }

  if (!['SN', 'LP'].includes(empresa.regime)) {
    return {
      messages: [`Regime ${empresa.regime} ainda não suportado pelo bot.`],
      conversa,
    };
  }

  const fluxo = empresa.regime === 'SN' ? 'SN' : 'LP';
  const nextStage = fluxo === 'SN' ? 'SN_CAPTURAR_COMPETENCIA' : 'LP_CAPTURAR_COMPETENCIA';
  const newState: EngineState = {
    ...state,
    fluxo,
    stage: nextStage,
    history: [...(state.history || []), state.stage],
    data: {
      ...state.data,
      sn: fluxo === 'SN' ? { empresaId: empresa.id } : state.data.sn,
      lp: fluxo === 'LP' ? { empresaId: empresa.id } : state.data.lp,
    },
    pending: null,
  };

  const updated = await persistState(conversa, newState, {
    empresaId: empresa.id,
    competenciaId: null,
  });

  return {
    messages: [
      `Empresa ${empresa.razaoSocial} (${empresa.regime}) vinculada à conversa.`,
      STAGE_PROMPTS[nextStage],
    ],
    conversa: updated,
  };
}

async function registrarProblema(conversa: Conversa, descricao: string) {
  if (!conversa.empresaId) {
    throw new Error('Associe uma empresa antes de registrar problemas.');
  }
  await prisma.problema.create({
    data: {
      empresaId: conversa.empresaId,
      competenciaId: conversa.competenciaId,
      tipo: 'Processo',
      impacto: 'Medio',
      descricao,
      status: 'Aberto',
    },
  });
}

async function registrarObservacao(conversa: Conversa, texto: string) {
  if (!conversa.competenciaId) {
    throw new Error('Associe uma competência antes de registrar observações.');
  }
  await prisma.competencia.update({
    where: { id: conversa.competenciaId },
    data: {
      observacoes: {
        set: texto,
      },
    },
  });
}

async function registrarDesabafo(conversa: Conversa, texto: string) {
  if (!conversa.empresaId) {
    throw new Error('Associe uma empresa antes do desabafo.');
  }
  await prisma.problema.create({
    data: {
      empresaId: conversa.empresaId,
      competenciaId: conversa.competenciaId,
      tipo: 'Outro',
      impacto: 'Baixo',
      descricao: texto,
      status: 'Aberto',
    },
  });
}

async function handlePending(
  conversa: Conversa,
  state: EngineState,
  text: string
): Promise<{ reply: Reply; state: EngineState }> {
  const pending = state.pending;
  if (!pending) {
    return { reply: { messages: [], conversa }, state };
  }

  const cleaned = text.trim();
  if (!cleaned) {
    return {
      reply: { messages: ['Informe o conteúdo para concluir o comando pendente.'], conversa },
      state,
    };
  }

  try {
    if (pending.type === 'problema') {
      await registrarProblema(conversa, cleaned);
      const newState = { ...state, pending: null };
      const updated = await persistState(conversa, newState);
      return {
        reply: { messages: ['Problema registrado com sucesso.'], conversa: updated },
        state: newState,
      };
    }
    if (pending.type === 'observacao') {
      await registrarObservacao(conversa, cleaned);
      const newState = { ...state, pending: null };
      const updated = await persistState(conversa, newState);
      return {
        reply: { messages: ['Observação salva.'], conversa: updated },
        state: newState,
      };
    }
    if (pending.type === 'desabafo') {
      await registrarDesabafo(conversa, cleaned);
      const newState = { ...state, pending: null };
      const updated = await persistState(conversa, newState);
      return {
        reply: { messages: ['Desabafo registrado e encaminhado ao time.'], conversa: updated },
        state: newState,
      };
    }
  } catch (error) {
    return {
      reply: { messages: [(error as Error).message], conversa },
      state,
    };
  }

  return {
    reply: { messages: ['Não foi possível concluir o comando pendente.'], conversa },
    state,
  };
}

async function buildResumo(conversa: Conversa, state: EngineState) {
  const mensagens: string[] = [];
  mensagens.push(`Etapa atual: ${state.stage}`);
  if (conversa.competenciaId) {
    const obrigacoes = await prisma.obrigacao.findMany({
      where: { competenciaId: conversa.competenciaId },
      orderBy: { vencimentoFinal: 'asc' },
    });
    if (obrigacoes.length) {
      mensagens.push('Obrigações vinculadas:');
      obrigacoes.forEach((ob) => {
        mensagens.push(
          `- ${ob.tipo} (${ob.esfera}) • status ${ob.status} • vence em ${ob.diasParaVenc ?? 'n/d'} dias`
        );
      });
    }
  }
  return mensagens;
}

async function listarPendencias(conversa: Conversa) {
  if (!conversa.competenciaId) {
    return ['Nenhuma competência vinculada. Use "resumo" após iniciar um fluxo.'];
  }
  const pendentes = await prisma.obrigacao.findMany({
    where: {
      competenciaId: conversa.competenciaId,
      status: { notIn: ['Entregue', 'Comprovada'] },
    },
    orderBy: { vencimentoFinal: 'asc' },
  });
  if (!pendentes.length) {
    return ['Nenhuma pendência no momento.'];
  }
  return pendentes.map((ob) => `• ${ob.tipo} (${ob.status}) vence em ${ob.diasParaVenc ?? 'n/d'} dias.`);
}

function getPromptForStage(stage: string) {
  return STAGE_PROMPTS[stage] || 'Avance para a próxima etapa informando os dados solicitados.';
}

export async function advance(conversa: Conversa, text: string): Promise<Reply> {
  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();
  let state = ensureState(conversa);

  if (state.pending && lower !== 'cancelar' && !lower.startsWith('cancelar ')) {
    const pendingResult = await handlePending(conversa, state, cleaned);
    if (pendingResult.reply.messages.length) {
      return pendingResult.reply;
    }
    state = pendingResult.state;
  } else if (state.pending && lower.startsWith('cancelar')) {
    state = { ...state, pending: null };
    conversa = await persistState(conversa, state);
    return { messages: ['Comando pendente cancelado.'], conversa };
  }

  if (!cleaned) {
    return { messages: [getPromptForStage(state.stage)], conversa };
  }

  if (isCommand('novo', lower)) {
    const newState: EngineState = { stage: INITIAL_STAGE, fluxo: undefined, data: {}, history: [], pending: null };
    const updated = await persistState(conversa, newState, {
      empresaId: null,
      competenciaId: null,
    });
    return {
      messages: ['Fluxo reiniciado. ' + getPromptForStage(INITIAL_STAGE)],
      conversa: updated,
    };
  }

  if (isCommand('nova empresa', lower)) {
    const newState: EngineState = { stage: INITIAL_STAGE, fluxo: undefined, data: {}, history: [], pending: null };
    const updated = await persistState(conversa, newState, {
      empresaId: null,
      competenciaId: null,
    });
    return {
      messages: ['Empresa desvinculada. ' + getPromptForStage(INITIAL_STAGE)],
      conversa: updated,
    };
  }

  if (isCommand('encerrar', lower)) {
    const updated = await prisma.conversa.update({
      where: { id: conversa.id },
      data: { ativa: false },
    });
    return { messages: ['Conversa encerrada. Use "novo" para reabrir quando precisar.'], conversa: updated };
  }

  if (isCommand('status', lower) || isCommand('resumo', lower)) {
    const mensagens = await buildResumo(conversa, state);
    return { messages: mensagens, conversa };
  }

  if (isCommand('pendencias', lower)) {
    const mensagens = await listarPendencias(conversa);
    return { messages: mensagens, conversa };
  }

  if (isCommand('problema', lower)) {
    const descricao = cleaned.substring('problema'.length).trim().replace(/^[:\-]/, '').trim();
    if (descricao) {
      await registrarProblema(conversa, descricao);
      return { messages: ['Problema registrado com sucesso.'], conversa };
    }
    const newState = { ...state, pending: { type: 'problema' } as PendingCommand };
    conversa = await persistState(conversa, newState);
    return { messages: ['Descreva o problema para registrarmos.'], conversa };
  }

  if (isCommand('observacao', lower)) {
    const texto = cleaned.substring('observacao'.length).trim().replace(/^[:\-]/, '').trim();
    if (texto) {
      await registrarObservacao(conversa, texto);
      return { messages: ['Observação registrada.'], conversa };
    }
    const newState = { ...state, pending: { type: 'observacao' } as PendingCommand };
    conversa = await persistState(conversa, newState);
    return { messages: ['Envie a observação para registrarmos.'], conversa };
  }

  if (isCommand('desabafo', lower)) {
    const texto = cleaned.substring('desabafo'.length).trim().replace(/^[:\-]/, '').trim();
    if (texto) {
      await registrarDesabafo(conversa, texto);
      return { messages: ['Obrigado por compartilhar. Encaminhamos ao time.'], conversa };
    }
    const newState = { ...state, pending: { type: 'desabafo' } as PendingCommand };
    conversa = await persistState(conversa, newState);
    return { messages: ['Pode mandar o desabafo. Estou ouvindo!'], conversa };
  }

  if (isCommand('pular', lower)) {
    const proximo = getNextStage(state.stage, state.fluxo);
    if (!proximo) {
      return { messages: ['Não há próxima etapa para pular.'], conversa };
    }
    const newState = moveToStage(state, proximo);
    const updated = await persistState(conversa, newState);
    return {
      messages: [`Etapa pulada. Próxima etapa: ${proximo}. ${getPromptForStage(proximo)}`],
      conversa: updated,
    };
  }

  if (isCommand('retomar', lower)) {
    const history = [...(state.history || [])];
    const previous = history.pop();
    if (!previous) {
      return { messages: ['Não há etapa anterior para retomar.'], conversa };
    }
    const newState: EngineState = { ...state, stage: previous, history, pending: null };
    const updated = await persistState(conversa, newState);
    return {
      messages: [`Retomando etapa ${previous}. ${getPromptForStage(previous)}`],
      conversa: updated,
    };
  }

  if (state.stage === INITIAL_STAGE) {
    return handleCapturaEmpresa(conversa, cleaned, state);
  }

  if (!state.fluxo) {
    return { messages: ['Informe primeiro a empresa para definir o fluxo.'], conversa };
  }

  let flowResult: FlowResult | null = null;
  if (state.fluxo === 'SN') {
    flowResult = await handleSN({ conversa, text: cleaned, state });
  } else if (state.fluxo === 'LP') {
    flowResult = await handleLP({ conversa, text: cleaned, state });
  }

  if (!flowResult) {
    return { messages: ['Não consegui processar a mensagem.'], conversa };
  }

  return { messages: flowResult.messages, conversa: flowResult.conversa || conversa };
}
