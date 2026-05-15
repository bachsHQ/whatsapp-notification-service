import { WASocket, proto } from '@whiskeysockets/baileys';
import { generateReply } from '../ai/gemini';
import { logger } from '../utils/logger';

export class MessageHandler {
  private sock: WASocket;
  private botJid: string = '';

  constructor(sock: WASocket) {
    this.sock = sock;
    // Fetch bot's own JID so we can detect mentions
    sock.user && (this.botJid = sock.user.id);
  }

  async handleMessage(msg: proto.IWebMessageInfo): Promise<void> {
    if (!msg.key) return;

    // Only handle group messages
    const jid = msg.key.remoteJid ?? '';
    if (!jid.endsWith('@g.us')) return;

    // Ignore messages sent by the bot itself
    if (msg.key.fromMe) return;

    const content = msg.message;
    if (!content) return;

    const text =
      content.conversation ||
      content.extendedTextMessage?.text ||
      content.ephemeralMessage?.message?.extendedTextMessage?.text ||
      '';

    if (!text) return;

    // Check if the bot is mentioned
    const mentionedJids: string[] =
      content.extendedTextMessage?.contextInfo?.mentionedJid ?? [];

    const botNumber = this.botJid.split(':')[0] + '@s.whatsapp.net';
    const isMentioned = mentionedJids.some(
      (m) => m.split(':')[0] + '@s.whatsapp.net' === botNumber
    );

    if (!isMentioned) return;

    // Strip the @mention tag from the message before sending to AI
    const cleanText = text.replace(/@\d+/g, '').trim();
    if (!cleanText) return;

    const senderJid = msg.key.participant ?? '';
    logger.info({ group: jid, sender: senderJid, text: cleanText }, 'Mention received');

    try {
      const reply = await generateReply(cleanText);

      await this.sock.sendMessage(jid, {
        text: reply,
        mentions: [senderJid]
      }, {
        quoted: msg as proto.IWebMessageInfo & { key: proto.IMessageKey }
      });

      logger.info({ group: jid }, 'AI reply sent');
    } catch (err) {
      logger.error({ err }, 'Failed to generate or send AI reply');
    }
  }
}
