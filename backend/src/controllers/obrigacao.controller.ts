import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { STATUS_OBRIGACAO } from '../config/constants';

const router = Router();

// Listar obrigações
router.get('/', async (req: Request, res: Response) => {
  try {
    const { competenciaId, status, emRisco, emCimaPrazo, esfera } = req.query;

    const where: any = {};
    if (competenciaId) where.competenciaId = competenciaId;
    if (status) where.status = status;
    if (emRisco !== undefined) where.emRisco = emRisco === 'true';
    if (emCimaPrazo !== undefined) where.emCimaPrazo = emCimaPrazo === 'true';
    if (esfera) where.esfera = esfera;

    const obrigacoes = await prisma.obrigacao.findMany({
      where,
      include: {
        competencia: {
          include: {
            empresa: {
              select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true },
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
    console.error('Erro ao listar obrigações:', error);
    res.status(500).json({ error: 'Erro ao listar obrigações' });
  }
});

// Buscar obrigação por ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const obrigacao = await prisma.obrigacao.findUnique({
      where: { id },
      include: {
        competencia: {
          include: { empresa: true },
        },
        preparador: true,
        entregador: true,
      },
    });

    if (!obrigacao) {
      return res.status(404).json({ error: 'Obrigação não encontrada' });
    }

    res.json(obrigacao);
  } catch (error) {
    console.error('Erro ao buscar obrigação:', error);
    res.status(500).json({ error: 'Erro ao buscar obrigação' });
  }
});

// Criar obrigação
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      competenciaId,
      tipo,
      esfera,
      vencimentoBase,
      vencimentoFinal,
      preparadorId,
      entregadorId,
      observacoes,
    } = req.body;

    if (!competenciaId || !tipo || !esfera || !vencimentoBase || !vencimentoFinal) {
      return res.status(400).json({ error: 'Campos obrigatórios não preenchidos' });
    }

    // Calcular dias para vencimento
    const hoje = new Date();
    const vencimento = new Date(vencimentoFinal);
    const diasParaVenc = Math.ceil((vencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));

    const obrigacao = await prisma.obrigacao.create({
      data: {
        competenciaId,
        tipo,
        esfera,
        vencimentoBase: new Date(vencimentoBase),
        vencimentoFinal: new Date(vencimentoFinal),
        preparadorId,
        entregadorId,
        observacoes,
        diasParaVenc,
        emRisco: diasParaVenc <= 3,
      },
      include: {
        preparador: { select: { id: true, nome: true } },
        entregador: { select: { id: true, nome: true } },
      },
    });

    res.status(201).json(obrigacao);
  } catch (error) {
    console.error('Erro ao criar obrigação:', error);
    res.status(500).json({ error: 'Erro ao criar obrigação' });
  }
});

// Atualizar status da obrigação
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const data: any = { status };

    // Definir timestamps conforme status
    if (status === STATUS_OBRIGACAO.PREPARADA) {
      data.preparadaEm = new Date();
    } else if (status === STATUS_OBRIGACAO.ENTREGUE) {
      data.entregueEm = new Date();
    } else if (status === STATUS_OBRIGACAO.COMPROVADA) {
      data.comprovadaEm = new Date();
    }

    const obrigacao = await prisma.obrigacao.update({
      where: { id },
      data,
      include: {
        preparador: { select: { id: true, nome: true } },
        entregador: { select: { id: true, nome: true } },
      },
    });

    res.json(obrigacao);
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

// Atualizar responsáveis
router.put('/:id/responsaveis', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { preparadorId, entregadorId } = req.body;

    const obrigacao = await prisma.obrigacao.update({
      where: { id },
      data: {
        preparadorId,
        entregadorId,
      },
      include: {
        preparador: { select: { id: true, nome: true } },
        entregador: { select: { id: true, nome: true } },
      },
    });

    res.json(obrigacao);
  } catch (error) {
    console.error('Erro ao atualizar responsáveis:', error);
    res.status(500).json({ error: 'Erro ao atualizar responsáveis' });
  }
});

// Atualizar obrigação
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { vencimentoFinal, observacoes, emRisco } = req.body;

    const data: any = {};
    if (vencimentoFinal) {
      data.vencimentoFinal = new Date(vencimentoFinal);
      
      // Recalcular dias para vencimento
      const hoje = new Date();
      const vencimento = new Date(vencimentoFinal);
      data.diasParaVenc = Math.ceil((vencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
    }
    if (observacoes !== undefined) data.observacoes = observacoes;
    if (emRisco !== undefined) data.emRisco = emRisco;

    const obrigacao = await prisma.obrigacao.update({
      where: { id },
      data,
    });

    res.json(obrigacao);
  } catch (error) {
    console.error('Erro ao atualizar obrigação:', error);
    res.status(500).json({ error: 'Erro ao atualizar obrigação' });
  }
});

// Deletar obrigação
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.obrigacao.delete({
      where: { id },
    });

    res.json({ message: 'Obrigação deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar obrigação:', error);
    res.status(500).json({ error: 'Erro ao deletar obrigação' });
  }
});

// Listar obrigações em risco
router.get('/em-risco/lista', async (req: Request, res: Response) => {
  try {
    const obrigacoes = await prisma.obrigacao.findMany({
      where: {
        emRisco: true,
        status: {
          notIn: [STATUS_OBRIGACAO.ENTREGUE, STATUS_OBRIGACAO.COMPROVADA],
        },
      },
      include: {
        competencia: {
          include: {
            empresa: {
              select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true },
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
    console.error('Erro ao listar obrigações em risco:', error);
    res.status(500).json({ error: 'Erro ao listar obrigações em risco' });
  }
});

// Atualizar dias para vencimento (job diário)
router.post('/atualizar-dias-vencimento', async (req: Request, res: Response) => {
  try {
    const obrigacoes = await prisma.obrigacao.findMany({
      where: {
        status: {
          notIn: [STATUS_OBRIGACAO.ENTREGUE, STATUS_OBRIGACAO.COMPROVADA],
        },
      },
    });

    const hoje = new Date();

    for (const obrigacao of obrigacoes) {
      const diasParaVenc = Math.ceil(
        (obrigacao.vencimentoFinal.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
      );

      await prisma.obrigacao.update({
        where: { id: obrigacao.id },
        data: {
          diasParaVenc,
          emRisco: diasParaVenc <= 3,
        },
      });
    }

    res.json({ message: 'Dias para vencimento atualizados', total: obrigacoes.length });
  } catch (error) {
    console.error('Erro ao atualizar dias para vencimento:', error);
    res.status(500).json({ error: 'Erro ao atualizar dias para vencimento' });
  }
});

export default router;
