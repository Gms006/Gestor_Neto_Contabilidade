import prisma from '../config/database';
import env from '../config/env';

export type TemplateComponent = {
  type: string;
  parameters: Array<{ type: string; text?: string; [key: string]: any }>;
};

const GRAPH_URL = (phoneNumberId: string) =>
  `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

async function sendRequest(
  payload: Record<string, unknown>,
  opts: { messageId?: string; retries?: number } = {}
) {
  const { messageId, retries = 1 } = opts;

  if (!env.phoneNumberId || !env.whatsappToken) {
    console.warn('WhatsApp Cloud API não configurada. Payload:', payload);
    return;
  }

  if (messageId) {
    const existing = await prisma.mensagemLog.findFirst({
      where: { messageId, direction: 'outbound' },
    });
    if (existing) {
      return;
    }
  }

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      const response = await fetch(GRAPH_URL(env.phoneNumberId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.whatsappToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`WhatsApp API error ${response.status}: ${text}`);
      }

      const json = (await response.json()) as { messages?: Array<{ id: string }> };
      const outboundId = messageId || json.messages?.[0]?.id;
      await prisma.mensagemLog.create({
        data: {
          direction: 'outbound',
          phone: String(payload['to'] ?? ''),
          messageId: outboundId,
          payload,
        },
      });
      return;
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > retries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }

  console.error('Erro ao enviar mensagem WhatsApp:', lastError);
  throw lastError;
}

export async function sendText(to: string, text: string, messageId?: string) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  await sendRequest(payload, { messageId, retries: 2 });
}

export async function sendTemplate(
  to: string,
  templateName: string,
  components: TemplateComponent[] = [],
  messageId?: string
) {
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'pt_BR' },
      components,
    },
  };

  await sendRequest(payload, { messageId, retries: 2 });
}

export default {
  sendText,
  sendTemplate,
};
