import { WASocket, proto } from '@whiskeysockets/baileys';
import { generateReply } from '../ai/ai';
import { registerContact } from '../ai/contacts';
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

// Detect name introductions for mentioned JIDs
// Handles: "@Chimama is Chimama", "Chimama is @...", "save her as Chimama", "@... is <Name>"
function extractNameFromIntroduction(
  text: string,
  mentionedJids: string[]
): Array<{ name: string; jid: string }> {
  if (mentionedJids.length === 0) return [];

  const results: Array<{ name: string; jid: string }> = [];

  // Pattern: "@mention is <Name>" or "<Name> is @mention"
  const isPattern = /(?:@\d+\s+is\s+([A-Za-z]+)|([A-Za-z]+)\s+is\s+@\d+)/gi;
  // Pattern: "save (her|him|them|this) (as|contact) <Name>" or "her name is <Name>"
  const savePattern = /(?:save\s+(?:her|him|them|this|as)|(?:her|his|their)\s+name\s+is)\s+([A-Za-z]+)/gi;

  let match;
  while ((match = isPattern.exec(text)) !== null) {
    const name = (match[1] || match[2])?.trim();
    if (name && mentionedJids.length > 0) {
      results.push({ name, jid: mentionedJids[0] });
    }
  }

  if (results.length === 0) {
    while ((match = savePattern.exec(text)) !== null) {
      const name = match[1]?.trim();
      if (name && mentionedJids.length > 0) {
        results.push({ name, jid: mentionedJids[0] });
      }
    }
  }

  return results;
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
    const botLidNumber = this.botLid ? this.botLid.split('@')[0].split(':')[0] : '';
    logger.debug({ botJid: this.botJid, botLid: this.botLid, botNumber, botLidNumber, mentionedJids }, 'Checking mention');

    const isMentioned = mentionedJids.some((m) => {
      const numericId = m.split('@')[0].split(':')[0];
      if (m.endsWith('@lid')) return numericId === botLidNumber;
      return numericId + '@s.whatsapp.net' === botNumber;
    });

    // Also trigger if the user quoted one of the bot's own messages
    const quotedParticipant = inner.extendedTextMessage?.contextInfo?.participant ?? '';
    const quotedId = quotedParticipant.split('@')[0].split(':')[0];
    const isQuoteReply = quotedId === botLidNumber || quotedParticipant === botNumber;

    if (!isMentioned && !isQuoteReply) {
      logger.debug({ jid }, 'Skipping — bot not mentioned or quoted');
      return;
    }

    // Strip @mentions from text before sending to AI
    const cleanText = text.replace(/@\d+/g, '').trim();
    if (!cleanText) return;

    const senderJid = msg.key.participant ?? '';
    logger.info({ group: jid, sender: senderJid, text: cleanText }, 'Mention received');

    // Auto-register sender
    registerContact(senderJid.split('@')[0].split(':')[0], senderJid);

    // Detect "X is <Name>" or "<Name> is X" patterns for mentioned JIDs
    // e.g. "@246952650362894 is Chimama, save her contact"
    const nameFromMention = extractNameFromIntroduction(text, mentionedJids);
    for (const { name, jid: contactJid } of nameFromMention) {
      registerContact(name, contactJid);
      logger.info({ name, contactJid }, 'Contact registered from introduction');
    }

    try {
      const reply = await generateReply(senderJid, cleanText);

      await this.sock.sendMessage(
        jid,
        {
          text: reply.text,
          ...(reply.mentions.length > 0 && {
            mentions: reply.mentions.map((m) => m.jid)
          })
        },
        { quoted: msg as proto.IWebMessageInfo & { key: proto.IMessageKey } }
      );

      logger.info({ group: jid, mentions: reply.mentions }, 'AI reply sent');
    } catch (err) {
      logger.error({ err }, 'Failed to generate or send AI reply');
    }
  }
}
