import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { STATUS_COMPETENCIA, FLUXOS } from '../config/constants';

const router = Router();

// Listar competências
router.get('/', async (req: Request, res: Response) => {
  try {
    const { empresaId, status, mesAno } = req.query;

    const where: any = {};
    if (empresaId) where.empresaId = empresaId;
    if (status) where.status = status;
    if (mesAno) where.mesAno = mesAno;

    const competencias = await prisma.competencia.findMany({
      where,
      include: {
        empresa: {
          select: {
            id: true,
            cnpj: true,
            razaoSocial: true,
            nomeFantasia: true,
            regime: true,
          },
        },
        etapas: {
          orderBy: { ordem: 'asc' },
        },
        obrigacoes: true,
      },
      orderBy: [{ mesAno: 'desc' }, { empresa: { razaoSocial: 'asc' } }],
    });

    res.json(competencias);
  } catch (error) {
    console.error('Erro ao listar competências:', error);
    res.status(500).json({ error: 'Erro ao listar competências' });
  }
});

// Buscar competência por ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const competencia = await prisma.competencia.findUnique({
      where: { id },
      include: {
        empresa: true,
        etapas: {
          orderBy: { ordem: 'asc' },
          include: {
            timers: true,
            problemas: true,
          },
        },
        obrigacoes: {
          include: {
            preparador: { select: { id: true, nome: true } },
            entregador: { select: { id: true, nome: true } },
          },
        },
      },
    });

    if (!competencia) {
      return res.status(404).json({ error: 'Competência não encontrada' });
    }

    res.json(competencia);
  } catch (error) {
    console.error('Erro ao buscar competência:', error);
    res.status(500).json({ error: 'Erro ao buscar competência' });
  }
});

// Criar nova competência
router.post('/', async (req: Request, res: Response) => {
  try {
    const { empresaId, mesAno, houveMovimento, observacoes } = req.body;

    if (!empresaId || !mesAno) {
      return res.status(400).json({ error: 'Campos obrigatórios não preenchidos' });
    }

    // Verificar se competência já existe
    const competenciaExistente = await prisma.competencia.findUnique({
      where: {
        empresaId_mesAno: {
          empresaId,
          mesAno,
        },
      },
    });

    if (competenciaExistente) {
      return res.status(409).json({ error: 'Competência já existe para esta empresa' });
    }

    // Buscar empresa para definir fluxo
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    // Criar competência
    const competencia = await prisma.competencia.create({
      data: {
        empresaId,
        mesAno,
        houveMovimento: houveMovimento !== false,
        observacoes,
        status: STATUS_COMPETENCIA.NAO_INICIADO,
      },
    });

    // Criar etapas baseadas no regime da empresa
    const fluxo = FLUXOS[empresa.regime as keyof typeof FLUXOS] || FLUXOS.SN;

    const etapas = await Promise.all(
      fluxo.map((etapaFluxo) =>
        prisma.etapa.create({
          data: {
            competenciaId: competencia.id,
            nome: etapaFluxo.nome,
            sistema: etapaFluxo.sistema,
            tipo: etapaFluxo.tipo,
            ordem: etapaFluxo.ordem,
            status: 'Nao Iniciado',
          },
        })
      )
    );

    res.status(201).json({
      ...competencia,
      etapas,
    });
  } catch (error) {
    console.error('Erro ao criar competência:', error);
    res.status(500).json({ error: 'Erro ao criar competência' });
  }
});

// Atualizar competência
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, houveMovimento, observacoes, dataConclusao } = req.body;

    const data: any = {};
    if (status) data.status = status;
    if (houveMovimento !== undefined) data.houveMovimento = houveMovimento;
    if (observacoes !== undefined) data.observacoes = observacoes;
    if (dataConclusao) data.dataConclusao = new Date(dataConclusao);

    // Se mudou para "Em Andamento" e não tem dataInicio, definir
    if (status === STATUS_COMPETENCIA.EM_ANDAMENTO) {
      const competenciaAtual = await prisma.competencia.findUnique({
        where: { id },
        select: { dataInicio: true },
      });

      if (!competenciaAtual?.dataInicio) {
        data.dataInicio = new Date();
      }
    }

    // Se mudou para "Concluido", calcular tempo total
    if (status === STATUS_COMPETENCIA.CONCLUIDO) {
      const etapas = await prisma.etapa.findMany({
        where: { competenciaId: id },
        select: { duracaoMin: true },
      });

      const tempoTotal = etapas.reduce((acc, etapa) => acc + etapa.duracaoMin, 0);
      data.tempoTotalMin = tempoTotal;
      data.dataConclusao = new Date();
    }

    const competencia = await prisma.competencia.update({
      where: { id },
      data,
      include: {
        empresa: true,
        etapas: { orderBy: { ordem: 'asc' } },
        obrigacoes: true,
      },
    });

    res.json(competencia);
  } catch (error) {
    console.error('Erro ao atualizar competência:', error);
    res.status(500).json({ error: 'Erro ao atualizar competência' });
  }
});

// Deletar competência
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Deletar em cascata (etapas, timers, problemas, obrigações)
    await prisma.competencia.delete({
      where: { id },
    });

    res.json({ message: 'Competência deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar competência:', error);
    res.status(500).json({ error: 'Erro ao deletar competência' });
  }
});

// Buscar competências pendentes (não concluídas)
router.get('/pendentes/lista', async (req: Request, res: Response) => {
  try {
    const { usuarioId } = req.query;

    let where: any = {
      status: { not: STATUS_COMPETENCIA.CONCLUIDO },
    };

    // Se fornecido usuarioId, filtrar por empresas do usuário
    if (usuarioId) {
      const usuarioEmpresas = await prisma.usuarioEmpresa.findMany({
        where: { usuarioId: usuarioId as string },
        select: { empresaId: true },
      });

      const empresaIds = usuarioEmpresas.map((ue) => ue.empresaId);
      where.empresaId = { in: empresaIds };
    }

    const competencias = await prisma.competencia.findMany({
      where,
      include: {
        empresa: {
          select: {
            id: true,
            cnpj: true,
            razaoSocial: true,
            nomeFantasia: true,
            regime: true,
          },
        },
        etapas: {
          where: { status: { not: 'Concluido' } },
          orderBy: { ordem: 'asc' },
          take: 1, // Próxima etapa pendente
        },
      },
      orderBy: { mesAno: 'desc' },
    });

    res.json(competencias);
  } catch (error) {
    console.error('Erro ao buscar competências pendentes:', error);
    res.status(500).json({ error: 'Erro ao buscar competências pendentes' });
  }
});

// Retomar competência (retornar à etapa pendente)
router.post('/:id/retomar', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const competencia = await prisma.competencia.findUnique({
      where: { id },
      include: {
        etapas: {
          where: {
            OR: [{ status: 'Nao Iniciado' }, { status: 'Pulado' }],
          },
          orderBy: { ordem: 'asc' },
          take: 1,
        },
      },
    });

    if (!competencia) {
      return res.status(404).json({ error: 'Competência não encontrada' });
    }

    if (competencia.etapas.length === 0) {
      return res.status(400).json({ error: 'Não há etapas pendentes' });
    }

    // Atualizar status da competência para "Em Andamento"
    await prisma.competencia.update({
      where: { id },
      data: { status: STATUS_COMPETENCIA.EM_ANDAMENTO },
    });

    res.json({
      competencia,
      proximaEtapa: competencia.etapas[0],
    });
  } catch (error) {
    console.error('Erro ao retomar competência:', error);
    res.status(500).json({ error: 'Erro ao retomar competência' });
  }
});

export default router;
