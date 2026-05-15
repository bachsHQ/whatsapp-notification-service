import { whatsappConnection } from './bot/connection';
import { WebServer } from './api/web-server';
import { MessageHandler } from './handlers/message-handler';
import { logger } from './utils/logger';
import { config } from './utils/config';
import fs from 'fs';

async function main() {
  logger.info('Starting WhatsApp Notification Service...');

  const webServer = new WebServer(config.port);

  try {
    await webServer.start();

    whatsappConnection.onStatusChange((status) => webServer.updateConnectionStatus(status));
    whatsappConnection.onQR((qr) => webServer.updateQR(qr));

    webServer.setWhatsAppConnection(whatsappConnection);

    // Register message handler on every connection (including reconnects)
    whatsappConnection.onConnectionReady((sock) => {
      const messageHandler = new MessageHandler(sock);
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          try {
            await messageHandler.handleMessage(msg);
          } catch (err) {
            logger.error({ err }, 'Error handling message');
          }
        }
      });
      logger.info('Message handler registered');
    });

    // Auto-connect if a saved session exists on the volume
    const sessionExists = fs.existsSync('auth_info_baileys/creds.json');
    if (sessionExists) {
      logger.info('Saved session found — connecting automatically...');
      whatsappConnection.connect().catch((err) => logger.error({ err }, 'Auto-connect failed'));
    } else {
      logger.info(`No session found — visit http://localhost:${config.port}/qr to connect WhatsApp`);
    }

    const shutdown = async () => {
      logger.info('Shutting down...');
      await webServer.stop();
      await whatsappConnection.disconnect();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    logger.error({ err }, 'Startup failed');
    await webServer.stop().catch(() => {});
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error({ err }, 'Unhandled error');
  process.exit(1);
});
