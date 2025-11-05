import request from 'supertest';

process.env.APP_BASE_URL = 'http://localhost:3000';
process.env.VERIFY_TOKEN = 'token-test';

const logs: any[] = [];
const sendTextMock = jest.fn();
const getOrStartConversaMock = jest.fn(async () => ({ id: 'conversa-1', phone: '5511999990001' }));
const advanceMock = jest.fn(async () => ({ messages: ['Olá de volta!'], conversa: { id: 'conversa-1' } }));

jest.mock('../src/services/whatsapp.service', () => ({
  __esModule: true,
  default: { sendText: sendTextMock, sendTemplate: jest.fn() },
  sendText: sendTextMock,
  sendTemplate: jest.fn(),
}));

jest.mock('../src/flows/engine', () => ({
  getOrStartConversa: getOrStartConversaMock,
  advance: advanceMock,
}));

jest.mock('../src/config/database', () => ({
  __esModule: true,
  default: {
    mensagemLog: {
      findFirst: jest.fn(async ({ where }: any) =>
        logs.find((log) => log.messageId === where.messageId && log.direction === where.direction) || null
      ),
      create: jest.fn(async ({ data }: any) => {
        logs.push({ id: `log-${logs.length + 1}`, ...data });
        return logs[logs.length - 1];
      }),
    },
  },
}));

let app: import('express').Express;

beforeAll(async () => {
  const module = await import('../src/app');
  app = module.default;
});

afterEach(() => {
  logs.splice(0, logs.length);
  sendTextMock.mockClear();
  getOrStartConversaMock.mockClear();
  advanceMock.mockClear();
});

describe('Webhook WhatsApp', () => {
  it('valida token de verificação', async () => {
    const response = await request(app)
      .get('/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'token-test', 'hub.challenge': '1234' });

    expect(response.status).toBe(200);
    expect(response.text).toBe('1234');
  });

  it('processa mensagem de texto e envia resposta', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid-1',
                    from: '5511999990001',
                    type: 'text',
                    text: { body: 'Oi bot!' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const response = await request(app).post('/webhook').send(payload);
    expect(response.status).toBe(200);
    expect(getOrStartConversaMock).toHaveBeenCalledWith('5511999990001');
    expect(advanceMock).toHaveBeenCalled();
    expect(sendTextMock).toHaveBeenCalledWith('5511999990001', 'Olá de volta!');
    expect(logs).toHaveLength(1);
  });

  it('é idempotente para mensagens repetidas', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid-dup',
                    from: '5511888880001',
                    type: 'text',
                    text: { body: 'Primeira vez' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    await request(app).post('/webhook').send(payload);
    await request(app).post('/webhook').send(payload);

    expect(sendTextMock).toHaveBeenCalledTimes(1);
    const duplicatedLogs = logs.filter((log) => log.messageId === 'wamid-dup');
    expect(duplicatedLogs).toHaveLength(1);
  });
});
