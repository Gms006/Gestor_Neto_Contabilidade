import { Router, Request, Response } from 'express';
import prisma from '../config/database';

const router = Router();

// Relatório de produtividade por colaborador
router.get('/produtividade-colaborador', async (req: Request, res: Response) => {
  try {
    const { usuarioId, dataInicio, dataFim } = req.query;

    const where: any = {};
    if (usuarioId) where.id = usuarioId;
    where.ativo = true;

    const usuarios = await prisma.usuario.findMany({
      where,
      select: {
        id: true,
        nome: true,
        papel: true,
      },
    });

    const relatorio = await Promise.all(
      usuarios.map(async (usuario) => {
        // Buscar competências trabalhadas
        const competencias = await prisma.competencia.findMany({
          where: {
            status: 'Concluido',
            ...(dataInicio && dataFim
              ? {
                  dataConclusao: {
                    gte: new Date(dataInicio as string),
                    lte: new Date(dataFim as string),
                  },
                }
              : {}),
            etapas: {
              some: {
                status: 'Concluido',
              },
            },
          },
          include: {
            empresa: {
              select: { razaoSocial: true, regime: true },
            },
            etapas: {
              where: { status: 'Concluido' },
            },
          },
        });

        const totalCompetencias = competencias.length;
        const tempoTotal = competencias.reduce((acc, c) => acc + c.tempoTotalMin, 0);
        const tempoMedio = totalCompetencias > 0 ? tempoTotal / totalCompetencias : 0;

        // Obrigações
        const [obrigacoesPreparadas, obrigacoesEntregues] = await Promise.all([
          prisma.obrigacao.count({
            where: {
              preparadorId: usuario.id,
              status: { in: ['Preparada', 'Entregue', 'Comprovada'] },
            },
          }),
          prisma.obrigacao.count({
            where: {
              entregadorId: usuario.id,
              status: { in: ['Entregue', 'Comprovada'] },
            },
          }),
        ]);

        // Problemas reportados
        const problemasReportados = await prisma.problema.count({
          where: {
            etapa: {
              competencia: {
                etapas: {
                  some: {
                    status: 'Concluido',
                  },
                },
              },
            },
          },
        });

        return {
          usuario: usuario.nome,
          papel: usuario.papel,
          totalCompetencias,
          tempoTotalMin: tempoTotal,
          tempoMedioMin: Math.round(tempoMedio),
          obrigacoesPreparadas,
          obrigacoesEntregues,
          problemasReportados,
        };
      })
    );

    res.json(relatorio);
  } catch (error) {
    console.error('Erro ao gerar relatório de produtividade:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório de produtividade' });
  }
});

// Relatório de tempo por processo
router.get('/tempo-processo', async (req: Request, res: Response) => {
  try {
    const { regime, dataInicio, dataFim } = req.query;

    const where: any = {
      status: 'Concluido',
    };

    if (dataInicio && dataFim) {
      where.dataConclusao = {
        gte: new Date(dataInicio as string),
        lte: new Date(dataFim as string),
      };
    }

    if (regime) {
      where.empresa = { regime };
    }

    const competencias = await prisma.competencia.findMany({
      where,
      include: {
        empresa: {
          select: { razaoSocial: true, regime: true, segmento: true },
        },
        etapas: {
          where: { status: 'Concluido' },
          orderBy: { ordem: 'asc' },
        },
      },
    });

    // Agrupar por etapa
    const etapasAgrupadas: any = {};

    competencias.forEach((competencia) => {
      competencia.etapas.forEach((etapa) => {
        const chave = `${etapa.nome} - ${etapa.sistema || 'Manual'}`;

        if (!etapasAgrupadas[chave]) {
          etapasAgrupadas[chave] = {
            nome: etapa.nome,
            sistema: etapa.sistema,
            tipo: etapa.tipo,
            ocorrencias: 0,
            tempoTotalMin: 0,
            tempoMedioMin: 0,
            tempoMinimoMin: Infinity,
            tempoMaximoMin: 0,
          };
        }

        etapasAgrupadas[chave].ocorrencias += 1;
        etapasAgrupadas[chave].tempoTotalMin += etapa.duracaoMin;
        etapasAgrupadas[chave].tempoMinimoMin = Math.min(
          etapasAgrupadas[chave].tempoMinimoMin,
          etapa.duracaoMin
        );
        etapasAgrupadas[chave].tempoMaximoMin = Math.max(
          etapasAgrupadas[chave].tempoMaximoMin,
          etapa.duracaoMin
        );
      });
    });

    // Calcular médias
    const relatorio = Object.values(etapasAgrupadas).map((etapa: any) => ({
      ...etapa,
      tempoMedioMin: Math.round(etapa.tempoTotalMin / etapa.ocorrencias),
    }));

    res.json(relatorio);
  } catch (error) {
    console.error('Erro ao gerar relatório de tempo:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório de tempo' });
  }
});

// Relatório de problemas mais frequentes
router.get('/problemas-frequentes', async (req: Request, res: Response) => {
  try {
    const { dataInicio, dataFim, tipo } = req.query;

    const where: any = {};

    if (dataInicio && dataFim) {
      where.criadoEm = {
        gte: new Date(dataInicio as string),
        lte: new Date(dataFim as string),
      };
    }

    if (tipo) {
      where.tipo = tipo;
    }

    const problemas = await prisma.problema.findMany({
      where,
      include: {
        etapa: {
          select: { nome: true, sistema: true },
        },
      },
    });

    // Agrupar por tipo e categoria
    const agrupados: any = {};

    problemas.forEach((problema) => {
      const chave = `${problema.tipo} - ${problema.categoria || 'Sem categoria'}`;

      if (!agrupados[chave]) {
        agrupados[chave] = {
          tipo: problema.tipo,
          categoria: problema.categoria,
          ocorrencias: 0,
          impactos: {
            Baixo: 0,
            Medio: 0,
            Alto: 0,
            Critico: 0,
          },
          exemplos: [],
        };
      }

      agrupados[chave].ocorrencias += 1;
      agrupados[chave].impactos[problema.impacto] += 1;

      if (agrupados[chave].exemplos.length < 3) {
        agrupados[chave].exemplos.push({
          descricao: problema.descricao.substring(0, 100),
          impacto: problema.impacto,
          etapa: problema.etapa?.nome,
        });
      }
    });

    const relatorio = Object.values(agrupados).sort(
      (a: any, b: any) => b.ocorrencias - a.ocorrencias
    );

    res.json(relatorio);
  } catch (error) {
    console.error('Erro ao gerar relatório de problemas:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório de problemas' });
  }
});

// Relatório de obrigações por empresa
router.get('/obrigacoes-empresa', async (req: Request, res: Response) => {
  try {
    const { empresaId, mesAno } = req.query;

    const where: any = {};
    if (empresaId) where.empresaId = empresaId;
    if (mesAno) where.mesAno = mesAno;

    const competencias = await prisma.competencia.findMany({
      where,
      include: {
        empresa: {
          select: { razaoSocial: true, nomeFantasia: true, cnpj: true, regime: true },
        },
        obrigacoes: {
          include: {
            preparador: { select: { nome: true } },
            entregador: { select: { nome: true } },
          },
          orderBy: { vencimentoFinal: 'asc' },
        },
      },
      orderBy: { mesAno: 'desc' },
    });

    const relatorio = competencias.map((competencia) => ({
      empresa: competencia.empresa.razaoSocial,
      nomeFantasia: competencia.empresa.nomeFantasia,
      cnpj: competencia.empresa.cnpj,
      regime: competencia.empresa.regime,
      mesAno: competencia.mesAno,
      status: competencia.status,
      totalObrigacoes: competencia.obrigacoes.length,
      obrigacoesEntregues: competencia.obrigacoes.filter(
        (o) => o.status === 'Entregue' || o.status === 'Comprovada'
      ).length,
      obrigacoesEmRisco: competencia.obrigacoes.filter((o) => o.emRisco).length,
      obrigacoes: competencia.obrigacoes,
    }));

    res.json(relatorio);
  } catch (error) {
    console.error('Erro ao gerar relatório de obrigações:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório de obrigações' });
  }
});

// Relatório consolidado por período
router.get('/consolidado', async (req: Request, res: Response) => {
  try {
    const { dataInicio, dataFim } = req.query;

    if (!dataInicio || !dataFim) {
      return res.status(400).json({ error: 'Data de início e fim são obrigatórias' });
    }

    const inicio = new Date(dataInicio as string);
    const fim = new Date(dataFim as string);

    const [
      competenciasConcluidas,
      tempoTotal,
      obrigacoesEntregues,
      problemasReportados,
      problemasResolvidos,
    ] = await Promise.all([
      prisma.competencia.count({
        where: {
          status: 'Concluido',
          dataConclusao: { gte: inicio, lte: fim },
        },
      }),
      prisma.competencia.aggregate({
        where: {
          status: 'Concluido',
          dataConclusao: { gte: inicio, lte: fim },
        },
        _sum: { tempoTotalMin: true },
      }),
      prisma.obrigacao.count({
        where: {
          status: { in: ['Entregue', 'Comprovada'] },
          entregueEm: { gte: inicio, lte: fim },
        },
      }),
      prisma.problema.count({
        where: {
          criadoEm: { gte: inicio, lte: fim },
        },
      }),
      prisma.problema.count({
        where: {
          status: 'Resolvido',
          resolvidoEm: { gte: inicio, lte: fim },
        },
      }),
    ]);

    res.json({
      periodo: {
        inicio: inicio.toISOString().split('T')[0],
        fim: fim.toISOString().split('T')[0],
      },
      competenciasConcluidas,
      tempoTotalMin: tempoTotal._sum.tempoTotalMin || 0,
      tempoMedioMin:
        competenciasConcluidas > 0
          ? Math.round((tempoTotal._sum.tempoTotalMin || 0) / competenciasConcluidas)
          : 0,
      obrigacoesEntregues,
      problemasReportados,
      problemasResolvidos,
      taxaResolucaoProblemas:
        problemasReportados > 0
          ? Math.round((problemasResolvidos / problemasReportados) * 100)
          : 0,
    });
  } catch (error) {
    console.error('Erro ao gerar relatório consolidado:', error);
    res.status(500).json({ error: 'Erro ao gerar relatório consolidado' });
  }
});

router.get('/export', async (req: Request, res: Response) => {
  try {
    const { empresaId, mesAno, format = 'json' } = req.query;

    const competencias = await prisma.competencia.findMany({
      where: {
        ...(empresaId ? { empresaId: String(empresaId) } : {}),
        ...(mesAno ? { mesAno: String(mesAno) } : {}),
      },
      include: {
        empresa: { select: { razaoSocial: true, cnpj: true, regime: true } },
        obrigacoes: true,
      },
      orderBy: { mesAno: 'desc' },
    });

    const dataset = competencias.map((competencia) => ({
      empresa: competencia.empresa.razaoSocial,
      cnpj: competencia.empresa.cnpj,
      regime: competencia.empresa.regime,
      mesAno: competencia.mesAno,
      status: competencia.status,
      obrigacoes: competencia.obrigacoes.map((obrigacao) => ({
        tipo: obrigacao.tipo,
        esfera: obrigacao.esfera,
        vencimento: obrigacao.vencimentoFinal,
        status: obrigacao.status,
        emRisco: obrigacao.emRisco,
        emCimaPrazo: obrigacao.emCimaPrazo,
      })),
    }));

    if (String(format).toLowerCase() === 'csv') {
      const rows: string[] = ['empresa,cnpj,regime,mesAno,status,tipo,esfera,vencimento,statusObrigacao,emRisco,emCimaPrazo'];
      dataset.forEach((item) => {
        item.obrigacoes.forEach((obrigacao) => {
          rows.push(
            [
              item.empresa,
              item.cnpj,
              item.regime,
              item.mesAno,
              item.status,
              obrigacao.tipo,
              obrigacao.esfera,
              new Date(obrigacao.vencimento).toISOString(),
              obrigacao.status,
              obrigacao.emRisco,
              obrigacao.emCimaPrazo,
            ].join(',')
          );
        });
      });
      res.header('Content-Type', 'text/csv');
      res.send(rows.join('\n'));
      return;
    }

    res.json(dataset);
  } catch (error) {
    console.error('Erro ao exportar dados:', error);
    res.status(500).json({ error: 'Erro ao exportar dados' });
  }
});

export default router;
