import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import prisma from './config/database';
import env from './config/env';
import whatsappService from './services/whatsapp.service';
import { getOrStartConversa, advance } from './flows/engine';

// Importar rotas
import empresaRoutes from './controllers/empresa.controller';
import competenciaRoutes from './controllers/competencia.controller';
import etapaRoutes from './controllers/etapa.controller';
import obrigacaoRoutes from './controllers/obrigacao.controller';
import usuarioRoutes from './controllers/usuario.controller';
import problemaRoutes from './controllers/problema.controller';
import dashboardRoutes from './controllers/dashboard.controller';
import relatorioRoutes from './controllers/relatorio.controller';

// Carregar variáveis de ambiente
dotenv.config();

const app: Express = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos do frontend
const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// Rotas da API
app.use('/api/empresas', empresaRoutes);
app.use('/api/competencias', competenciaRoutes);
app.use('/api/etapas', etapaRoutes);
app.use('/api/obrigacoes', obrigacaoRoutes);
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/problemas', problemaRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/relatorios', relatorioRoutes);

// Webhook WhatsApp Cloud API
app.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body;

  if (body.object !== 'whatsapp_business_account') {
    return res.sendStatus(200);
  }

  try {
    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const value = change.value || {};

        if (value.messages) {
          for (const message of value.messages) {
            const messageId = message.id;
            const from = message.from;

            if (!from || !messageId) {
              continue;
            }

            const existing = await prisma.mensagemLog.findFirst({
              where: { messageId, direction: 'inbound' },
            });
            if (existing) {
              continue;
            }

            await prisma.mensagemLog.create({
              data: {
                direction: 'inbound',
                phone: from,
                messageId,
                payload: JSON.stringify(message),
              },
            });

            if (message.type !== 'text') {
              continue;
            }

            const text = message.text?.body || '';
            const conversa = await getOrStartConversa(from);
            const reply = await advance(conversa, text);

            for (const msg of reply.messages) {
              await whatsappService.sendText(from, msg);
            }
          }
        }

        if (value.statuses) {
          for (const status of value.statuses) {
            await prisma.mensagemLog.create({
              data: {
                direction: 'status',
                phone: status.recipient_id,
                messageId: status.id,
                payload: JSON.stringify(status),
              },
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('Erro no webhook do WhatsApp:', error);
  }

  res.sendStatus(200);
});

// Rota de health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Rota de documentação da API
app.get('/api/docs', (req: Request, res: Response) => {
  res.json({
    message: 'Sistema de Gestão Contábil - API Documentation',
    version: '1.0.0',
    endpoints: {
      empresas: '/api/empresas',
      competencias: '/api/competencias',
      etapas: '/api/etapas',
      obrigacoes: '/api/obrigacoes',
      usuarios: '/api/usuarios',
      problemas: '/api/problemas',
      dashboard: '/api/dashboard',
      relatorios: '/api/relatorios',
    },
  });
});

// Rota principal - servir o frontend
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Rota do dashboard
app.get('/dashboard', (req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, 'dashboard.html'));
});

// Tratamento de erro 404
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Rota não encontrada',
    path: req.path,
  });
});

// Tratamento de erros global
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('❌ Erro:', err);
  res.status(500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Erro ao processar requisição',
  });
});

export default app;
