import { Router, Request, Response } from 'express';
import prisma from '../config/database';
import { REGIMES, SEGMENTOS } from '../config/constants';

const router = Router();

// Listar todas as empresas
router.get('/', async (req: Request, res: Response) => {
  try {
    const { ativo, regime, segmento } = req.query;

    const where: any = {};
    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (regime) where.regime = regime;
    if (segmento) where.segmento = segmento;

    const empresas = await prisma.empresa.findMany({
      where,
      include: {
        competencias: {
          orderBy: { mesAno: 'desc' },
          take: 3,
        },
        usuarios: {
          include: {
            usuario: {
              select: { id: true, nome: true, email: true, papel: true },
            },
          },
        },
      },
      orderBy: { razaoSocial: 'asc' },
    });

    res.json(empresas);
  } catch (error) {
    console.error('Erro ao listar empresas:', error);
    res.status(500).json({ error: 'Erro ao listar empresas' });
  }
});

// Buscar empresa por ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const empresa = await prisma.empresa.findUnique({
      where: { id },
      include: {
        competencias: {
          orderBy: { mesAno: 'desc' },
        },
        usuarios: {
          include: {
            usuario: {
              select: { id: true, nome: true, email: true, papel: true },
            },
          },
        },
      },
    });

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }

    res.json(empresa);
  } catch (error) {
    console.error('Erro ao buscar empresa:', error);
    res.status(500).json({ error: 'Erro ao buscar empresa' });
  }
});

// Criar nova empresa
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      cnpj,
      razaoSocial,
      nomeFantasia,
      regime,
      segmento,
      uf,
      municipio,
      observacoes,
    } = req.body;

    // Validações básicas
    if (!cnpj || !razaoSocial || !regime || !segmento || !uf || !municipio) {
      return res.status(400).json({ error: 'Campos obrigatórios não preenchidos' });
    }

    // Verificar se CNPJ já existe
    const empresaExistente = await prisma.empresa.findUnique({
      where: { cnpj },
    });

    if (empresaExistente) {
      return res.status(409).json({ error: 'CNPJ já cadastrado' });
    }

    const empresa = await prisma.empresa.create({
      data: {
        cnpj,
        razaoSocial,
        nomeFantasia,
        regime,
        segmento,
        uf,
        municipio,
        observacoes,
      },
    });

    res.status(201).json(empresa);
  } catch (error) {
    console.error('Erro ao criar empresa:', error);
    res.status(500).json({ error: 'Erro ao criar empresa' });
  }
});

// Atualizar empresa
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      cnpj,
      razaoSocial,
      nomeFantasia,
      regime,
      segmento,
      uf,
      municipio,
      ativo,
      observacoes,
    } = req.body;

    const empresa = await prisma.empresa.update({
      where: { id },
      data: {
        cnpj,
        razaoSocial,
        nomeFantasia,
        regime,
        segmento,
        uf,
        municipio,
        ativo,
        observacoes,
      },
    });

    res.json(empresa);
  } catch (error) {
    console.error('Erro ao atualizar empresa:', error);
    res.status(500).json({ error: 'Erro ao atualizar empresa' });
  }
});

// Desativar empresa (soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const empresa = await prisma.empresa.update({
      where: { id },
      data: { ativo: false },
    });

    res.json({ message: 'Empresa desativada com sucesso', empresa });
  } catch (error) {
    console.error('Erro ao desativar empresa:', error);
    res.status(500).json({ error: 'Erro ao desativar empresa' });
  }
});

// Buscar empresas por usuário
router.get('/usuario/:usuarioId', async (req: Request, res: Response) => {
  try {
    const { usuarioId } = req.params;

    const usuarioEmpresas = await prisma.usuarioEmpresa.findMany({
      where: { usuarioId },
      include: {
        empresa: {
          include: {
            competencias: {
              where: { status: { not: 'Concluido' } },
              orderBy: { mesAno: 'desc' },
            },
          },
        },
      },
    });

    const empresas = usuarioEmpresas.map((ue) => ({
      ...ue.empresa,
      papelUsuario: ue.papel,
    }));

    res.json(empresas);
  } catch (error) {
    console.error('Erro ao buscar empresas do usuário:', error);
    res.status(500).json({ error: 'Erro ao buscar empresas do usuário' });
  }
});

// Estatísticas da empresa
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [totalCompetencias, competenciasConcluidas, competenciasEmAndamento, tempoMedio] =
      await Promise.all([
        prisma.competencia.count({ where: { empresaId: id } }),
        prisma.competencia.count({ where: { empresaId: id, status: 'Concluido' } }),
        prisma.competencia.count({ where: { empresaId: id, status: 'Em Andamento' } }),
        prisma.competencia.aggregate({
          where: { empresaId: id, status: 'Concluido' },
          _avg: { tempoTotalMin: true },
        }),
      ]);

    res.json({
      totalCompetencias,
      competenciasConcluidas,
      competenciasEmAndamento,
      tempoMedioMin: tempoMedio._avg.tempoTotalMin || 0,
    });
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

export default router;
