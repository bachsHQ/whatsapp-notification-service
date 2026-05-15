import { whatsappConnection } from './bot/connection';
import { WebServer } from './api/web-server';
import { logger } from './utils/logger';
import { config } from './utils/config';

async function main() {
  logger.info('Starting WhatsApp Notification Service...');

  const webServer = new WebServer(config.port);

  try {
    await webServer.start();

    whatsappConnection.onStatusChange((status) => webServer.updateConnectionStatus(status));
    whatsappConnection.onQR((qr) => webServer.updateQR(qr));

    webServer.setWhatsAppConnection(whatsappConnection);

    logger.info(`Visit http://localhost:${config.port}/qr to connect WhatsApp`);
    logger.info('POST /notify to send notifications (requires X-API-Key header)');

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
