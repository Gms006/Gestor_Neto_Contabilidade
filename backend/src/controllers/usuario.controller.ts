import { Router, Request, Response } from 'express';
import prisma from '../config/database';

const router = Router();

// Listar usuários
router.get('/', async (req: Request, res: Response) => {
  try {
    const { ativo, papel } = req.query;

    const where: any = {};
    if (ativo !== undefined) where.ativo = ativo === 'true';
    if (papel) where.papel = papel;

    const usuarios = await prisma.usuario.findMany({
      where,
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        ativo: true,
        createdAt: true,
        empresas: {
          include: {
            empresa: {
              select: { id: true, razaoSocial: true, nomeFantasia: true },
            },
          },
        },
      },
      orderBy: { nome: 'asc' },
    });

    res.json(usuarios);
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// Buscar usuário por ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const usuario = await prisma.usuario.findUnique({
      where: { id },
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        ativo: true,
        createdAt: true,
        empresas: {
          include: {
            empresa: true,
          },
        },
      },
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(usuario);
  } catch (error) {
    console.error('Erro ao buscar usuário:', error);
    res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
});

// Criar usuário
router.post('/', async (req: Request, res: Response) => {
  try {
    const { nome, email, senha, papel } = req.body;

    if (!nome || !email || !senha || !papel) {
      return res.status(400).json({ error: 'Campos obrigatórios não preenchidos' });
    }

    // Verificar se email já existe
    const usuarioExistente = await prisma.usuario.findUnique({
      where: { email },
    });

    if (usuarioExistente) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    // Em produção, fazer hash da senha
    const usuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        senha, // TODO: hash
        papel,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        ativo: true,
        createdAt: true,
      },
    });

    res.status(201).json(usuario);
  } catch (error) {
    console.error('Erro ao criar usuário:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// Atualizar usuário
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { nome, email, papel, ativo } = req.body;

    const data: any = {};
    if (nome) data.nome = nome;
    if (email) data.email = email;
    if (papel) data.papel = papel;
    if (ativo !== undefined) data.ativo = ativo;

    const usuario = await prisma.usuario.update({
      where: { id },
      data,
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        ativo: true,
        updatedAt: true,
      },
    });

    res.json(usuario);
  } catch (error) {
    console.error('Erro ao atualizar usuário:', error);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// Desativar usuário
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const usuario = await prisma.usuario.update({
      where: { id },
      data: { ativo: false },
      select: {
        id: true,
        nome: true,
        email: true,
        ativo: true,
      },
    });

    res.json({ message: 'Usuário desativado com sucesso', usuario });
  } catch (error) {
    console.error('Erro ao desativar usuário:', error);
    res.status(500).json({ error: 'Erro ao desativar usuário' });
  }
});

// Associar usuário a empresa
router.post('/:id/empresas/:empresaId', async (req: Request, res: Response) => {
  try {
    const { id, empresaId } = req.params;
    const { papel } = req.body;

    if (!papel) {
      return res.status(400).json({ error: 'Papel é obrigatório' });
    }

    const usuarioEmpresa = await prisma.usuarioEmpresa.create({
      data: {
        usuarioId: id,
        empresaId,
        papel,
      },
      include: {
        usuario: {
          select: { id: true, nome: true, email: true },
        },
        empresa: {
          select: { id: true, razaoSocial: true, nomeFantasia: true },
        },
      },
    });

    res.status(201).json(usuarioEmpresa);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Usuário já associado a esta empresa' });
    }
    console.error('Erro ao associar usuário:', error);
    res.status(500).json({ error: 'Erro ao associar usuário' });
  }
});

// Remover associação usuário-empresa
router.delete('/:id/empresas/:empresaId', async (req: Request, res: Response) => {
  try {
    const { id, empresaId } = req.params;

    await prisma.usuarioEmpresa.deleteMany({
      where: {
        usuarioId: id,
        empresaId,
      },
    });

    res.json({ message: 'Associação removida com sucesso' });
  } catch (error) {
    console.error('Erro ao remover associação:', error);
    res.status(500).json({ error: 'Erro ao remover associação' });
  }
});

// Login simples (sem JWT por enquanto)
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { email },
      select: {
        id: true,
        nome: true,
        email: true,
        senha: true,
        papel: true,
        ativo: true,
      },
    });

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    if (!usuario.ativo) {
      return res.status(403).json({ error: 'Usuário desativado' });
    }

    // Verificar senha (em produção, comparar hash)
    if (usuario.senha !== senha) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    // Remover senha da resposta
    const { senha: _, ...usuarioSemSenha } = usuario;

    res.json({
      message: 'Login realizado com sucesso',
      usuario: usuarioSemSenha,
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro no login' });
  }
});

export default router;
