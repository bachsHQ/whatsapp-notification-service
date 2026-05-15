import { WASocket } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger';

const MAX_ATTEMPTS = 3;

// Invisible unicode variation selectors — appended randomly to avoid identical
// message fingerprints across recipients without changing visible content.
const VARIATION_CHARS = ['​', '‌', '‍', '﻿'];

function toJid(to: string): string {
  const digits = to.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Appends a random invisible char so the message is never byte-identical
// across sends, reducing spam fingerprint risk.
function vary(message: string): string {
  const char = VARIATION_CHARS[Math.floor(Math.random() * VARIATION_CHARS.length)];
  return message + char;
}

export async function sendNotification(
  sock: WASocket,
  to: string,
  message: string
): Promise<void> {
  const jid = toJid(to);

  // Random pre-send delay: 5–15 seconds, as recommended to avoid rate limiting
  const preDelay = randomBetween(5000, 15000);
  logger.debug({ to, preDelayMs: preDelay }, 'Pre-send delay');
  await sleep(preDelay);

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await sock.sendMessage(jid, { text: vary(message) });
      logger.info({ to, jid, attempt }, 'Notification sent');
      return;
    } catch (err) {
      lastError = err;
      logger.warn({ to, jid, attempt, err }, 'Send attempt failed');

      if (attempt < MAX_ATTEMPTS) {
        // Exponential backoff between retry attempts: 2s, 4s
        await sleep(2000 * 2 ** (attempt - 1));
      }
    }
  }

  throw lastError;
}
