import prisma from '../config/database';
import { ajustarVencimento, calcularDiasParaVencimento, criarDataCompetencia } from '../utils/dates';
import { ESFERAS, STATUS_OBRIGACAO, TIPOS_OBRIGACAO } from '../config/constants';

type DifalTipo = 'consumo' | 'comercializacao' | 'ambos';

type ObrigacaoBaseInput = {
  competenciaId: string;
  tipo: string;
  esfera: 'Federal' | 'Estadual' | 'Municipal';
  vencimentoBase: Date;
  observacoes?: string;
};

async function upsertObrigacao({ competenciaId, tipo, esfera, vencimentoBase, observacoes }: ObrigacaoBaseInput) {
  const vencimentoFinal = ajustarVencimento(vencimentoBase, esfera);
  const diasParaVenc = calcularDiasParaVencimento(vencimentoFinal);
  const emRisco = diasParaVenc <= 3;
  const emCimaPrazo = diasParaVenc < 0;

  const existente = await prisma.obrigacao.findFirst({
    where: { competenciaId, tipo },
  });

  if (existente) {
    return prisma.obrigacao.update({
      where: { id: existente.id },
      data: {
        esfera,
        vencimentoBase,
        vencimentoFinal,
        diasParaVenc,
        emRisco,
        emCimaPrazo,
        observacoes,
      },
    });
  }

  return prisma.obrigacao.create({
    data: {
      competenciaId,
      tipo,
      esfera,
      vencimentoBase,
      vencimentoFinal,
      status: STATUS_OBRIGACAO.NAO_INICIADA,
      diasParaVenc,
      emRisco,
      emCimaPrazo,
      observacoes,
    },
  });
}

export interface GerarObrigacoesSNParams {
  competenciaId: string;
  mesAno: string;
  empresaId: string;
  houveMovimento: boolean;
  houveCompraInterestadual: boolean;
  difalTipo?: DifalTipo;
  justificativas?: string[];
}

export async function gerarObrigacoesSN(params: GerarObrigacoesSNParams) {
  const { competenciaId, mesAno, houveMovimento, houveCompraInterestadual, difalTipo, justificativas } = params;

  if (!houveMovimento && houveCompraInterestadual) {
    throw new Error('Inconsistência: sem movimento, mas informado DIFAL.');
  }

  const results = [];

  results.push(
    await upsertObrigacao({
      competenciaId,
      tipo: TIPOS_OBRIGACAO.DAS,
      esfera: ESFERAS.FEDERAL,
      vencimentoBase: criarDataCompetencia(mesAno, 20, 1),
    })
  );

  results.push(
    await upsertObrigacao({
      competenciaId,
      tipo: TIPOS_OBRIGACAO.PIS_COFINS,
      esfera: ESFERAS.FEDERAL,
      vencimentoBase: criarDataCompetencia(mesAno, 25, 1),
      observacoes: houveMovimento ? undefined : 'Sem movimento declarado',
    })
  );

  results.push(
    await upsertObrigacao({
      competenciaId,
      tipo: TIPOS_OBRIGACAO.ICMS,
      esfera: ESFERAS.ESTADUAL,
      vencimentoBase: criarDataCompetencia(mesAno, 25, 1),
    })
  );

  if (houveCompraInterestadual) {
    if (!difalTipo) {
      throw new Error('Informe o tipo de DIFAL quando houver compra interestadual.');
    }
    const tipos: Array<{ tipo: string; observacoes?: string }> = [];
    if (difalTipo === 'consumo' || difalTipo === 'ambos') {
      tipos.push({ tipo: TIPOS_OBRIGACAO.DIFAL_CONSUMO });
    }
    if (difalTipo === 'comercializacao' || difalTipo === 'ambos') {
      tipos.push({ tipo: TIPOS_OBRIGACAO.DIFAL_COMERCIALIZACAO });
    }

    for (const difal of tipos) {
      results.push(
        await upsertObrigacao({
          competenciaId,
          tipo: difal.tipo,
          esfera: ESFERAS.ESTADUAL,
          vencimentoBase: criarDataCompetencia(mesAno, 10, 1),
          observacoes: justificativas?.join('\n'),
        })
      );
    }
  }

  return results;
}

export interface GerarObrigacoesPresumidoParams {
  competenciaId: string;
  mesAno: string;
  empresaId: string;
  pisCofinsDebito: boolean;
  pisCofinsMotivo?: string;
  icmsDevido: boolean;
  icmsGuiaGerada: boolean;
  icmsJustificativa?: string;
  difalUso?: 'consumo' | 'imobilizado' | 'ambos' | 'nenhum';
  reinf: boolean;
  distribuicaoLucros?: { houve: boolean; valor?: number };
  temFolha: boolean;
  faturouMesAnterior: boolean;
  periodicidadeIrpjCsll?: 'Trimestral' | 'Estimativa';
}

export async function gerarObrigacoesPresumido(params: GerarObrigacoesPresumidoParams) {
  const {
    competenciaId,
    mesAno,
    pisCofinsDebito,
    pisCofinsMotivo,
    icmsDevido,
    icmsGuiaGerada,
    icmsJustificativa,
    difalUso,
    reinf,
    distribuicaoLucros,
    temFolha,
    faturouMesAnterior,
    periodicidadeIrpjCsll,
  } = params;

  if (!pisCofinsDebito) {
    const motivoLower = (pisCofinsMotivo || '').toLowerCase();
    if (!['isencao', 'isenção', 'imunidade'].some((term) => motivoLower.includes(term))) {
      throw new Error('Para Lucro Presumido, informe motivo válido (Isenção ou Imunidade) quando não houver débito de PIS/COFINS.');
    }
  }

  if (icmsDevido && !icmsGuiaGerada && !icmsJustificativa) {
    throw new Error('Informe uma justificativa para ICMS devido sem guia gerada.');
  }

  if (difalUso && difalUso !== 'nenhum' && difalUso !== 'consumo' && difalUso !== 'imobilizado' && difalUso !== 'ambos') {
    throw new Error('Tipo de DIFAL inválido.');
  }

  if (distribuicaoLucros?.houve && (!distribuicaoLucros.valor || distribuicaoLucros.valor <= 0)) {
    throw new Error('Informe o valor distribuído em lucros.');
  }

  const results = [];

  results.push(
    await upsertObrigacao({
      competenciaId,
      tipo: TIPOS_OBRIGACAO.PIS_COFINS,
      esfera: ESFERAS.FEDERAL,
      vencimentoBase: criarDataCompetencia(mesAno, 25, 1),
      observacoes: pisCofinsDebito ? undefined : `Sem débito - motivo: ${pisCofinsMotivo}`,
    })
  );

  results.push(
    await upsertObrigacao({
      competenciaId,
      tipo: TIPOS_OBRIGACAO.ICMS,
      esfera: ESFERAS.ESTADUAL,
      vencimentoBase: criarDataCompetencia(mesAno, 25, 1),
      observacoes: icmsGuiaGerada ? undefined : `Guia não gerada: ${icmsJustificativa || 'informar justificativa'}`,
    })
  );

  if (difalUso && difalUso !== 'nenhum') {
    const tipos: Array<{ tipo: string; esfera: 'Estadual' | 'Municipal' }> = [];
    if (difalUso === 'consumo' || difalUso === 'ambos') {
      tipos.push({ tipo: TIPOS_OBRIGACAO.DIFAL_CONSUMO, esfera: ESFERAS.ESTADUAL });
    }
    if (difalUso === 'imobilizado' || difalUso === 'ambos') {
      tipos.push({ tipo: TIPOS_OBRIGACAO.DIFAL_COMERCIALIZACAO, esfera: ESFERAS.ESTADUAL });
    }
    for (const difal of tipos) {
      results.push(
        await upsertObrigacao({
          competenciaId,
          tipo: difal.tipo,
          esfera: difal.esfera,
          vencimentoBase: criarDataCompetencia(mesAno, 10, 0),
        })
      );
    }
  }

  results.push(
    await upsertObrigacao({
      competenciaId,
      tipo: TIPOS_OBRIGACAO.EFD_CONTRIBUICOES,
      esfera: ESFERAS.FEDERAL,
      vencimentoBase: criarDataCompetencia(mesAno, 10, 2),
    })
  );

  results.push(
    await upsertObrigacao({
      competenciaId,
      tipo: TIPOS_OBRIGACAO.EFD_ICMS_IPI,
      esfera: ESFERAS.ESTADUAL,
      vencimentoBase: criarDataCompetencia(mesAno, 20, 1),
    })
  );

  if (reinf) {
    results.push(
      await upsertObrigacao({
        competenciaId,
        tipo: TIPOS_OBRIGACAO.REINF,
        esfera: ESFERAS.FEDERAL,
        vencimentoBase: criarDataCompetencia(mesAno, 15, 1),
        observacoes: distribuicaoLucros?.houve
          ? `Distribuição de lucros declarada: R$ ${distribuicaoLucros.valor?.toFixed(2)}`
          : undefined,
      })
    );
  }

  if (periodicidadeIrpjCsll === 'Trimestral') {
    const mesCompetencia = criarDataCompetencia(mesAno, 1, 0).getUTCMonth() + 1;
    if (mesCompetencia % 3 === 0) {
      const vencimento = criarDataCompetencia(mesAno, 31, 1);
      results.push(
        await upsertObrigacao({
          competenciaId,
          tipo: TIPOS_OBRIGACAO.IRPJ,
          esfera: ESFERAS.FEDERAL,
          vencimentoBase: vencimento,
        })
      );
      results.push(
        await upsertObrigacao({
          competenciaId,
          tipo: TIPOS_OBRIGACAO.CSLL,
          esfera: ESFERAS.FEDERAL,
          vencimentoBase: vencimento,
        })
      );
    }
  } else {
    const vencimento = criarDataCompetencia(mesAno, 31, 1);
    results.push(
      await upsertObrigacao({
        competenciaId,
        tipo: TIPOS_OBRIGACAO.IRPJ_ESTIMATIVA,
        esfera: ESFERAS.FEDERAL,
        vencimentoBase: vencimento,
      })
    );
    results.push(
      await upsertObrigacao({
        competenciaId,
        tipo: TIPOS_OBRIGACAO.CSLL_ESTIMATIVA,
        esfera: ESFERAS.FEDERAL,
        vencimentoBase: vencimento,
      })
    );
  }

  if (!temFolha && faturouMesAnterior) {
    results.push(
      await upsertObrigacao({
        competenciaId,
        tipo: TIPOS_OBRIGACAO.MIT_DCTFWEB,
        esfera: ESFERAS.FEDERAL,
        vencimentoBase: criarDataCompetencia(mesAno, 15, 1),
        observacoes: 'Sem movimento - faturamento mês anterior',
      })
    );
  }

  return results;
}
