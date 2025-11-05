import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { STATUS_ETAPA, STATUS_COMPETENCIA } from '../config/constants';

const router = Router();

// Listar etapas
router.get('/', async (req: Request, res: Response) => {
  try {
    const { competenciaId, status } = req.query;

    const where: any = {};
    if (competenciaId) where.competenciaId = competenciaId;
    if (status) where.status = status;

    const etapas = await prisma.etapa.findMany({
      where,
      include: {
        competencia: {
          include: {
            empresa: {
              select: { id: true, razaoSocial: true, nomeFantasia: true },
            },
          },
        },
        timers: true,
        problemas: true,
      },
      orderBy: { ordem: 'asc' },
    });

    res.json(etapas);
  } catch (error) {
    console.error('Erro ao listar etapas:', error);
    res.status(500).json({ error: 'Erro ao listar etapas' });
  }
});

// Buscar etapa por ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const etapa = await prisma.etapa.findUnique({
      where: { id },
      include: {
        competencia: {
          include: { empresa: true },
        },
        timers: { orderBy: { inicioAt: 'desc' } },
        problemas: { orderBy: { criadoEm: 'desc' } },
      },
    });

    if (!etapa) {
      return res.status(404).json({ error: 'Etapa não encontrada' });
    }

    res.json(etapa);
  } catch (error) {
    console.error('Erro ao buscar etapa:', error);
    res.status(500).json({ error: 'Erro ao buscar etapa' });
  }
});

// Iniciar etapa (criar timer)
router.post('/:id/iniciar', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const etapa = await prisma.etapa.findUnique({
      where: { id },
      include: { competencia: true },
    });

    if (!etapa) {
      return res.status(404).json({ error: 'Etapa não encontrada' });
    }

    if (etapa.status === STATUS_ETAPA.CONCLUIDO) {
      return res.status(400).json({ error: 'Etapa já está concluída' });
    }

    // Criar timer
    const timer = await prisma.timer.create({
      data: {
        etapaId: id,
        inicioAt: new Date(),
        ativo: true,
      },
    });

    // Atualizar etapa
    const etapaAtualizada = await prisma.etapa.update({
      where: { id },
      data: {
        status: STATUS_ETAPA.EM_ANDAMENTO,
        inicioAt: etapa.inicioAt || new Date(),
      },
      include: {
        timers: true,
        problemas: true,
      },
    });

    // Atualizar competência para "Em Andamento" se necessário
    if (etapa.competencia.status === STATUS_COMPETENCIA.NAO_INICIADO) {
      await prisma.competencia.update({
        where: { id: etapa.competenciaId },
        data: {
          status: STATUS_COMPETENCIA.EM_ANDAMENTO,
          dataInicio: new Date(),
        },
      });
    }

    res.json({ etapa: etapaAtualizada, timer });
  } catch (error) {
    console.error('Erro ao iniciar etapa:', error);
    res.status(500).json({ error: 'Erro ao iniciar etapa' });
  }
});

// Pausar etapa (pausar timer)
router.post('/:id/pausar', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Buscar timer ativo
    const timer = await prisma.timer.findFirst({
      where: {
        etapaId: id,
        ativo: true,
        fimAt: null,
      },
      orderBy: { inicioAt: 'desc' },
    });

    if (!timer) {
      return res.status(400).json({ error: 'Nenhum timer ativo encontrado' });
    }

    // Calcular duração
    const agora = new Date();
    const duracaoSeg = Math.floor((agora.getTime() - timer.inicioAt.getTime()) / 1000);

    // Atualizar timer
    const timerAtualizado = await prisma.timer.update({
      where: { id: timer.id },
      data: {
        pausadoAt: agora,
        duracaoSeg,
        ativo: false,
      },
    });

    res.json({ timer: timerAtualizado, duracaoSeg });
  } catch (error) {
    console.error('Erro ao pausar etapa:', error);
    res.status(500).json({ error: 'Erro ao pausar etapa' });
  }
});

// Concluir etapa
router.post('/:id/concluir', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { efetividade, observacao, dadosEspecificos } = req.body;

    const etapa = await prisma.etapa.findUnique({
      where: { id },
      include: { timers: true },
    });

    if (!etapa) {
      return res.status(404).json({ error: 'Etapa não encontrada' });
    }

    // Finalizar timer ativo se houver
    const timerAtivo = await prisma.timer.findFirst({
      where: {
        etapaId: id,
        ativo: true,
        fimAt: null,
      },
    });

    if (timerAtivo) {
      const agora = new Date();
      const duracaoSeg = Math.floor((agora.getTime() - timerAtivo.inicioAt.getTime()) / 1000);

      await prisma.timer.update({
        where: { id: timerAtivo.id },
        data: {
          fimAt: agora,
          duracaoSeg,
          ativo: false,
        },
      });
    }

    // Calcular duração total da etapa
    const timers = await prisma.timer.findMany({
      where: { etapaId: id },
    });

    const duracaoTotalSeg = timers.reduce((acc, t) => acc + t.duracaoSeg, 0);
    const duracaoMin = Math.ceil(duracaoTotalSeg / 60);

    // Atualizar etapa
    const etapaAtualizada = await prisma.etapa.update({
      where: { id },
      data: {
        status: STATUS_ETAPA.CONCLUIDO,
        fimAt: new Date(),
        duracaoMin,
        efetividade: efetividade || etapa.efetividade,
        observacao: observacao || etapa.observacao,
        dadosEspecificos: dadosEspecificos || etapa.dadosEspecificos,
      },
      include: {
        timers: true,
        problemas: true,
      },
    });

    // Verificar se todas as etapas da competência estão concluídas
    const etapasCompetencia = await prisma.etapa.findMany({
      where: { competenciaId: etapa.competenciaId },
    });

    const todasConcluidas = etapasCompetencia.every(
      (e) => e.status === STATUS_ETAPA.CONCLUIDO || e.status === STATUS_ETAPA.PULADO
    );

    if (todasConcluidas) {
      const tempoTotal = etapasCompetencia.reduce((acc, e) => acc + e.duracaoMin, 0);

      await prisma.competencia.update({
        where: { id: etapa.competenciaId },
        data: {
          status: STATUS_COMPETENCIA.CONCLUIDO,
          dataConclusao: new Date(),
          tempoTotalMin: tempoTotal,
        },
      });
    }

    res.json(etapaAtualizada);
  } catch (error) {
    console.error('Erro ao concluir etapa:', error);
    res.status(500).json({ error: 'Erro ao concluir etapa' });
  }
});

// Pular etapa
router.post('/:id/pular', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;

    // Finalizar timer ativo se houver
    const timerAtivo = await prisma.timer.findFirst({
      where: {
        etapaId: id,
        ativo: true,
        fimAt: null,
      },
    });

    if (timerAtivo) {
      const agora = new Date();
      const duracaoSeg = Math.floor((agora.getTime() - timerAtivo.inicioAt.getTime()) / 1000);

      await prisma.timer.update({
        where: { id: timerAtivo.id },
        data: {
          fimAt: agora,
          duracaoSeg,
          ativo: false,
        },
      });
    }

    const etapa = await prisma.etapa.update({
      where: { id },
      data: {
        status: STATUS_ETAPA.PULADO,
        observacao: motivo || 'Etapa pulada',
      },
      include: {
        timers: true,
        problemas: true,
      },
    });

    res.json(etapa);
  } catch (error) {
    console.error('Erro ao pular etapa:', error);
    res.status(500).json({ error: 'Erro ao pular etapa' });
  }
});

// Adicionar problema/desabafo à etapa
router.post('/:id/problema', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tipo, categoria, descricao, impacto } = req.body;

    if (!descricao) {
      return res.status(400).json({ error: 'Descrição do problema é obrigatória' });
    }

    const etapa = await prisma.etapa.findUnique({
      where: { id },
      include: { competencia: true },
    });

    if (!etapa) {
      return res.status(404).json({ error: 'Etapa não encontrada' });
    }

    const problema = await prisma.problema.create({
      data: {
        etapaId: id,
        empresaId: etapa.competencia.empresaId,
        competenciaId: etapa.competenciaId,
        tipo: tipo || 'Outro',
        categoria,
        descricao,
        impacto: impacto || 'Medio',
        status: 'Aberto',
      },
    });

    res.status(201).json(problema);
  } catch (error) {
    console.error('Erro ao adicionar problema:', error);
    res.status(500).json({ error: 'Erro ao adicionar problema' });
  }
});

// Atualizar dados específicos da etapa
router.put('/:id/dados', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { dadosEspecificos } = req.body;

    const etapa = await prisma.etapa.update({
      where: { id },
      data: {
        dadosEspecificos: JSON.stringify(dadosEspecificos),
      },
    });

    res.json(etapa);
  } catch (error) {
    console.error('Erro ao atualizar dados da etapa:', error);
    res.status(500).json({ error: 'Erro ao atualizar dados da etapa' });
  }
});

export default router;
