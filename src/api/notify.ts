import { WASocket } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger';

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

function toJid(to: string): string {
  // Strip any non-digit chars except leading +, then append @s.whatsapp.net
  const digits = to.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendNotification(
  sock: WASocket,
  to: string,
  message: string
): Promise<void> {
  const jid = toJid(to);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sock.sendMessage(jid, { text: message });
      logger.info({ to, jid, attempt }, 'Notification sent');
      return;
    } catch (err) {
      lastError = err;
      logger.warn({ to, jid, attempt, err }, 'Send attempt failed');

      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }

  throw lastError;
}
