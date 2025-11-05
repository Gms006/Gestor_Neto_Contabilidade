import { Router, Request, Response } from 'express';
import prisma from '../config/database';

const router = Router();

// Dashboard principal - visão geral
router.get('/', async (req: Request, res: Response) => {
  try {
    const [
      totalEmpresas,
      empresasAtivas,
      totalUsuarios,
      competenciasEmAndamento,
      competenciasConcluidas,
      obrigacoesEmRisco,
      problemasAbertos,
    ] = await Promise.all([
      prisma.empresa.count(),
      prisma.empresa.count({ where: { ativo: true } }),
      prisma.usuario.count({ where: { ativo: true } }),
      prisma.competencia.count({ where: { status: 'Em Andamento' } }),
      prisma.competencia.count({ where: { status: 'Concluido' } }),
      prisma.obrigacao.count({ where: { emRisco: true, status: { notIn: ['Entregue', 'Comprovada'] } } }),
      prisma.problema.count({ where: { status: 'Aberto' } }),
    ]);

    res.json({
      empresas: {
        total: totalEmpresas,
        ativas: empresasAtivas,
      },
      usuarios: {
        total: totalUsuarios,
      },
      competencias: {
        emAndamento: competenciasEmAndamento,
        concluidas: competenciasConcluidas,
      },
      obrigacoes: {
        emRisco: obrigacoesEmRisco,
      },
      problemas: {
        abertos: problemasAbertos,
      },
    });
  } catch (error) {
    console.error('Erro ao buscar dashboard:', error);
    res.status(500).json({ error: 'Erro ao buscar dashboard' });
  }
});

// Competências por status
router.get('/competencias-status', async (req: Request, res: Response) => {
  try {
    const competenciasPorStatus = await prisma.competencia.groupBy({
      by: ['status'],
      _count: true,
    });

    res.json(competenciasPorStatus);
  } catch (error) {
    console.error('Erro ao buscar competências por status:', error);
    res.status(500).json({ error: 'Erro ao buscar competências por status' });
  }
});

// Obrigações por esfera
router.get('/obrigacoes-esfera', async (req: Request, res: Response) => {
  try {
    const obrigacoesPorEsfera = await prisma.obrigacao.groupBy({
      by: ['esfera'],
      _count: true,
    });

    res.json(obrigacoesPorEsfera);
  } catch (error) {
    console.error('Erro ao buscar obrigações por esfera:', error);
    res.status(500).json({ error: 'Erro ao buscar obrigações por esfera' });
  }
});

// Obrigações por status
router.get('/obrigacoes-status', async (req: Request, res: Response) => {
  try {
    const obrigacoesPorStatus = await prisma.obrigacao.groupBy({
      by: ['status'],
      _count: true,
    });

    res.json(obrigacoesPorStatus);
  } catch (error) {
    console.error('Erro ao buscar obrigações por status:', error);
    res.status(500).json({ error: 'Erro ao buscar obrigações por status' });
  }
});

// Problemas por tipo
router.get('/problemas-tipo', async (req: Request, res: Response) => {
  try {
    const problemasPorTipo = await prisma.problema.groupBy({
      by: ['tipo'],
      _count: true,
    });

    res.json(problemasPorTipo);
  } catch (error) {
    console.error('Erro ao buscar problemas por tipo:', error);
    res.status(500).json({ error: 'Erro ao buscar problemas por tipo' });
  }
});

router.get('/obrigacoes/em-risco', async (req: Request, res: Response) => {
  try {
    const obrigacoes = await prisma.obrigacao.findMany({
      where: {
        emRisco: true,
        status: { notIn: ['Entregue', 'Comprovada'] },
      },
      include: {
        competencia: {
          include: { empresa: { select: { razaoSocial: true, regime: true } } },
        },
      },
      orderBy: { vencimentoFinal: 'asc' },
    });

    res.json(obrigacoes);
  } catch (error) {
    console.error('Erro ao buscar obrigações em risco:', error);
    res.status(500).json({ error: 'Erro ao buscar obrigações em risco' });
  }
});

router.get('/obrigacoes/em-cima-prazo', async (req: Request, res: Response) => {
  try {
    const obrigacoes = await prisma.obrigacao.findMany({
      where: {
        emCimaPrazo: true,
        status: { notIn: ['Entregue', 'Comprovada'] },
      },
      include: {
        competencia: {
          include: { empresa: { select: { razaoSocial: true, regime: true } } },
        },
      },
      orderBy: { vencimentoFinal: 'asc' },
    });

    res.json(obrigacoes);
  } catch (error) {
    console.error('Erro ao buscar obrigações em cima do prazo:', error);
    res.status(500).json({ error: 'Erro ao buscar obrigações em cima do prazo' });
  }
});

router.get('/problemas/pareto', async (req: Request, res: Response) => {
  try {
    const agregados = await prisma.problema.groupBy({
      by: ['tipo'],
      _count: { tipo: true },
      orderBy: { _count: { tipo: 'desc' } },
    });

    res.json(agregados);
  } catch (error) {
    console.error('Erro ao gerar pareto de problemas:', error);
    res.status(500).json({ error: 'Erro ao gerar pareto de problemas' });
  }
});

router.get('/conversas/ultimas', async (req: Request, res: Response) => {
  try {
    const logs = await prisma.mensagemLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const agrupados: Record<string, any> = {};
    for (const log of logs) {
      if (!agrupados[log.phone]) {
        agrupados[log.phone] = { phone: log.phone, ultimaMensagem: log };
      }
    }

    res.json(Object.values(agrupados));
  } catch (error) {
    console.error('Erro ao buscar conversas:', error);
    res.status(500).json({ error: 'Erro ao buscar conversas' });
  }
});

// Tempo médio por regime
router.get('/tempo-medio-regime', async (req: Request, res: Response) => {
  try {
    const empresas = await prisma.empresa.findMany({
      where: { ativo: true },
      select: { id: true, regime: true },
    });

    const temposPorRegime: any = {};

    for (const empresa of empresas) {
      const competencias = await prisma.competencia.findMany({
        where: {
          empresaId: empresa.id,
          status: 'Concluido',
        },
        select: { tempoTotalMin: true },
      });

      if (competencias.length > 0) {
        const tempoMedio =
          competencias.reduce((acc, c) => acc + c.tempoTotalMin, 0) / competencias.length;

        if (!temposPorRegime[empresa.regime]) {
          temposPorRegime[empresa.regime] = {
            regime: empresa.regime,
            tempoMedio: 0,
            count: 0,
          };
        }

        temposPorRegime[empresa.regime].tempoMedio += tempoMedio;
        temposPorRegime[empresa.regime].count += 1;
      }
    }

    // Calcular média final
    const resultado = Object.values(temposPorRegime).map((item: any) => ({
      regime: item.regime,
      tempoMedioMin: Math.round(item.tempoMedio / item.count),
    }));

    res.json(resultado);
  } catch (error) {
    console.error('Erro ao buscar tempo médio por regime:', error);
    res.status(500).json({ error: 'Erro ao buscar tempo médio por regime' });
  }
});

// Produtividade por usuário
router.get('/produtividade-usuario', async (req: Request, res: Response) => {
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { ativo: true, papel: { in: ['Preparador', 'Entregador'] } },
      select: {
        id: true,
        nome: true,
        papel: true,
      },
    });

    const produtividade = await Promise.all(
      usuarios.map(async (usuario) => {
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

        return {
          usuario: usuario.nome,
          papel: usuario.papel,
          obrigacoesPreparadas,
          obrigacoesEntregues,
        };
      })
    );

    res.json(produtividade);
  } catch (error) {
    console.error('Erro ao buscar produtividade:', error);
    res.status(500).json({ error: 'Erro ao buscar produtividade' });
  }
});

// Próximos vencimentos (7 dias)
router.get('/proximos-vencimentos', async (req: Request, res: Response) => {
  try {
    const hoje = new Date();
    const seteDias = new Date();
    seteDias.setDate(hoje.getDate() + 7);

    const obrigacoes = await prisma.obrigacao.findMany({
      where: {
        vencimentoFinal: {
          gte: hoje,
          lte: seteDias,
        },
        status: { notIn: ['Entregue', 'Comprovada'] },
      },
      include: {
        competencia: {
          include: {
            empresa: {
              select: { id: true, razaoSocial: true, nomeFantasia: true },
            },
          },
        },
        preparador: { select: { id: true, nome: true } },
        entregador: { select: { id: true, nome: true } },
      },
      orderBy: { vencimentoFinal: 'asc' },
    });

    res.json(obrigacoes);
  } catch (error) {
    console.error('Erro ao buscar próximos vencimentos:', error);
    res.status(500).json({ error: 'Erro ao buscar próximos vencimentos' });
  }
});

// Empresas com competências pendentes
router.get('/empresas-pendentes', async (req: Request, res: Response) => {
  try {
    const empresas = await prisma.empresa.findMany({
      where: {
        ativo: true,
        competencias: {
          some: {
            status: { in: ['Nao Iniciado', 'Em Andamento', 'Pausado'] },
          },
        },
      },
      include: {
        competencias: {
          where: {
            status: { in: ['Nao Iniciado', 'Em Andamento', 'Pausado'] },
          },
          orderBy: { mesAno: 'desc' },
        },
      },
      orderBy: { razaoSocial: 'asc' },
    });

    res.json(empresas);
  } catch (error) {
    console.error('Erro ao buscar empresas pendentes:', error);
    res.status(500).json({ error: 'Erro ao buscar empresas pendentes' });
  }
});

// Resumo do dia
router.get('/resumo-dia', async (req: Request, res: Response) => {
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const amanha = new Date(hoje);
    amanha.setDate(amanha.getDate() + 1);

    const [
      etapasIniciadas,
      etapasConcluidas,
      problemasReportados,
      obrigacoesVencemHoje,
    ] = await Promise.all([
      prisma.etapa.count({
        where: {
          inicioAt: {
            gte: hoje,
            lt: amanha,
          },
        },
      }),
      prisma.etapa.count({
        where: {
          fimAt: {
            gte: hoje,
            lt: amanha,
          },
          status: 'Concluido',
        },
      }),
      prisma.problema.count({
        where: {
          criadoEm: {
            gte: hoje,
            lt: amanha,
          },
        },
      }),
      prisma.obrigacao.count({
        where: {
          vencimentoFinal: {
            gte: hoje,
            lt: amanha,
          },
          status: { notIn: ['Entregue', 'Comprovada'] },
        },
      }),
    ]);

    res.json({
      data: hoje.toISOString().split('T')[0],
      etapasIniciadas,
      etapasConcluidas,
      problemasReportados,
      obrigacoesVencemHoje,
    });
  } catch (error) {
    console.error('Erro ao buscar resumo do dia:', error);
    res.status(500).json({ error: 'Erro ao buscar resumo do dia' });
  }
});

export default router;
