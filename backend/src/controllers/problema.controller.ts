import { Router, Request, Response } from 'express';
import prisma from '../config/database';

const router = Router();

// Listar problemas
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, tipo, impacto, empresaId } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (tipo) where.tipo = tipo;
    if (impacto) where.impacto = impacto;
    if (empresaId) where.empresaId = empresaId;

    const problemas = await prisma.problema.findMany({
      where,
      include: {
        etapa: {
          include: {
            competencia: {
              include: {
                empresa: {
                  select: { id: true, razaoSocial: true, nomeFantasia: true },
                },
              },
            },
          },
        },
      },
      orderBy: { criadoEm: 'desc' },
    });

    res.json(problemas);
  } catch (error) {
    console.error('Erro ao listar problemas:', error);
    res.status(500).json({ error: 'Erro ao listar problemas' });
  }
});

// Buscar problema por ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const problema = await prisma.problema.findUnique({
      where: { id },
      include: {
        etapa: {
          include: {
            competencia: {
              include: { empresa: true },
            },
          },
        },
      },
    });

    if (!problema) {
      return res.status(404).json({ error: 'Problema não encontrado' });
    }

    res.json(problema);
  } catch (error) {
    console.error('Erro ao buscar problema:', error);
    res.status(500).json({ error: 'Erro ao buscar problema' });
  }
});

// Criar problema
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      etapaId,
      empresaId,
      competenciaId,
      tipo,
      categoria,
      descricao,
      impacto,
    } = req.body;

    if (!descricao) {
      return res.status(400).json({ error: 'Descrição é obrigatória' });
    }

    const problema = await prisma.problema.create({
      data: {
        etapaId,
        empresaId,
        competenciaId,
        tipo: tipo || 'Outro',
        categoria,
        descricao,
        impacto: impacto || 'Medio',
        status: 'Aberto',
      },
    });

    res.status(201).json(problema);
  } catch (error) {
    console.error('Erro ao criar problema:', error);
    res.status(500).json({ error: 'Erro ao criar problema' });
  }
});

// Atualizar problema
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tipo, categoria, descricao, impacto, status, resolucao } = req.body;

    const data: any = {};
    if (tipo) data.tipo = tipo;
    if (categoria) data.categoria = categoria;
    if (descricao) data.descricao = descricao;
    if (impacto) data.impacto = impacto;
    if (status) {
      data.status = status;
      if (status === 'Resolvido' && !data.resolvidoEm) {
        data.resolvidoEm = new Date();
      }
    }
    if (resolucao) data.resolucao = resolucao;

    const problema = await prisma.problema.update({
      where: { id },
      data,
    });

    res.json(problema);
  } catch (error) {
    console.error('Erro ao atualizar problema:', error);
    res.status(500).json({ error: 'Erro ao atualizar problema' });
  }
});

// Resolver problema
router.post('/:id/resolver', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { resolucao } = req.body;

    const problema = await prisma.problema.update({
      where: { id },
      data: {
        status: 'Resolvido',
        resolucao,
        resolvidoEm: new Date(),
      },
    });

    res.json(problema);
  } catch (error) {
    console.error('Erro ao resolver problema:', error);
    res.status(500).json({ error: 'Erro ao resolver problema' });
  }
});

// Deletar problema
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.problema.delete({
      where: { id },
    });

    res.json({ message: 'Problema deletado com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar problema:', error);
    res.status(500).json({ error: 'Erro ao deletar problema' });
  }
});

// Estatísticas de problemas
router.get('/stats/geral', async (req: Request, res: Response) => {
  try {
    const [
      totalProblemas,
      problemasAbertos,
      problemasResolvidos,
      porTipo,
      porImpacto,
    ] = await Promise.all([
      prisma.problema.count(),
      prisma.problema.count({ where: { status: 'Aberto' } }),
      prisma.problema.count({ where: { status: 'Resolvido' } }),
      prisma.problema.groupBy({
        by: ['tipo'],
        _count: true,
      }),
      prisma.problema.groupBy({
        by: ['impacto'],
        _count: true,
      }),
    ]);

    res.json({
      totalProblemas,
      problemasAbertos,
      problemasResolvidos,
      porTipo,
      porImpacto,
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

export default router;
