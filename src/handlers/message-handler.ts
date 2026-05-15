import { WASocket, proto } from '@whiskeysockets/baileys';
import { generateReply } from '../ai/gemini';
import { logger } from '../utils/logger';

// Unwrap all the common message wrapper layers and return the inner IMessage
function unwrapMessage(msg: proto.IWebMessageInfo): proto.IMessage | null {
  const m = msg.message;
  if (!m) return null;

  return (
    m.ephemeralMessage?.message ??
    m.viewOnceMessage?.message ??
    m.viewOnceMessageV2?.message?.viewOnceMessage?.message ??
    m.documentWithCaptionMessage?.message ??
    m
  );
}

// Extract plain text from any message type that carries text
function extractText(m: proto.IMessage): string {
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    ''
  );
}

// Extract mentioned JIDs from any context layer
function extractMentions(m: proto.IMessage): string[] {
  return (
    m.extendedTextMessage?.contextInfo?.mentionedJid ??
    m.imageMessage?.contextInfo?.mentionedJid ??
    m.videoMessage?.contextInfo?.mentionedJid ??
    []
  );
}

export class MessageHandler {
  private sock: WASocket;
  private botJid: string = '';
  private botLid: string = '';

  constructor(sock: WASocket) {
    this.sock = sock;
    if (sock.user) {
      this.botJid = sock.user.id;
      // LID is stored as sock.user.lid on newer WhatsApp multi-device accounts
      this.botLid = (sock.user as any).lid ?? '';
    }
  }

  async handleMessage(msg: proto.IWebMessageInfo): Promise<void> {
    if (!msg.key) return;

    const jid = msg.key.remoteJid ?? '';

    // Only group messages
    if (!jid.endsWith('@g.us')) {
      logger.debug({ jid }, 'Skipping — not a group message');
      return;
    }

    // Ignore own messages
    if (msg.key.fromMe) return;

    const inner = unwrapMessage(msg);
    logger.debug({ jid, messageKeys: Object.keys(msg.message ?? {}), inner: JSON.stringify(inner) }, 'Raw message received');

    if (!inner) {
      logger.debug({ jid }, 'Skipping — could not unwrap message');
      return;
    }

    const text = extractText(inner);
    logger.debug({ jid, text }, 'Extracted text');

    if (!text) {
      logger.debug({ jid }, 'Skipping — no text found');
      return;
    }

    const mentionedJids = extractMentions(inner);
    const botNumber = this.botJid.split(':')[0] + '@s.whatsapp.net';
    const botLidNumber = this.botLid ? this.botLid.split(':')[0] : '';
    logger.debug({ botJid: this.botJid, botLid: this.botLid, botNumber, botLidNumber, mentionedJids }, 'Checking mention');

    const isMentioned = mentionedJids.some((m) => {
      const bare = m.split(':')[0];
      if (m.endsWith('@lid')) return bare === botLidNumber;
      return bare + '@s.whatsapp.net' === botNumber;
    });

    if (!isMentioned) {
      logger.debug({ jid }, 'Skipping — bot not mentioned');
      return;
    }

    // Strip @mentions from text before sending to AI
    const cleanText = text.replace(/@\d+/g, '').trim();
    if (!cleanText) return;

    const senderJid = msg.key.participant ?? '';
    logger.info({ group: jid, sender: senderJid, text: cleanText }, 'Mention received');

    try {
      const reply = await generateReply(cleanText);

      await this.sock.sendMessage(
        jid,
        { text: reply, mentions: [senderJid] },
        { quoted: msg as proto.IWebMessageInfo & { key: proto.IMessageKey } }
      );

      logger.info({ group: jid }, 'AI reply sent');
    } catch (err) {
      logger.error({ err }, 'Failed to generate or send AI reply');
    }
  }
}
