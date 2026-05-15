import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { logger, baileysLogger } from '../utils/logger';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'logged_out';

export class WhatsAppConnection {
  private sock: WASocket | null = null;
  private statusCallback?: (status: ConnectionStatus) => void;
  private qrCallback?: (qr: string | null) => void;
  private connectionReadyCallback?: (sock: WASocket) => void;
  private currentStatus: ConnectionStatus = 'disconnected';
  private isConnecting: boolean = false;

  async connect(): Promise<WASocket> {
    if (this.isConnecting) {
      throw new Error('Connection already in progress');
    }

    if (this.sock && this.currentStatus === 'connected') {
      logger.warn('Already connected to WhatsApp');
      return this.sock;
    }

    this.isConnecting = true;
    this.currentStatus = 'connecting';
    this.statusCallback?.('connecting');

    logger.info('Starting WhatsApp connection...');

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      logger: baileysLogger as any
    });
    this.sock = sock;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('QR Code ready — scan via /qr');
        console.log('\n--- WhatsApp QR Code ---');
        qrcode.generate(qr, { small: true });
        console.log('------------------------\n');
        this.qrCallback?.(qr);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        this.isConnecting = false;

        if (statusCode === DisconnectReason.restartRequired) {
          logger.info('Authentication successful — reconnecting...');
          setTimeout(() => this.connect().catch((err) => logger.error({ err }, 'Reconnect failed')), 1000);
          return;
        }

        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        const newStatus: ConnectionStatus = isLoggedOut ? 'logged_out' : 'disconnected';
        this.currentStatus = newStatus;
        this.statusCallback?.(newStatus);

        logger.error({ statusCode, error: lastDisconnect?.error?.message }, 'Connection closed');

        if (isLoggedOut) {
          logger.error('Logged out — delete auth_info_baileys/ and reconnect.');
        } else {
          // Auto-reconnect after transient failures
          logger.info('Reconnecting in 5s...');
          setTimeout(() => this.connect().catch((err) => logger.error({ err }, 'Reconnect failed')), 5000);
        }
      } else if (connection === 'open') {
        this.isConnecting = false;
        this.qrCallback?.(null);
        this.currentStatus = 'connected';
        this.statusCallback?.('connected');
        logger.info('WhatsApp connected');

        if (this.connectionReadyCallback && this.sock) {
          this.connectionReadyCallback(this.sock);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
    return sock;
  }

  getSocket(): WASocket | null {
    return this.sock;
  }

  async disconnect() {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
      logger.info('Disconnected from WhatsApp (session preserved)');
    }
  }

  isConnected(): boolean {
    return this.currentStatus === 'connected';
  }

  canConnect(): boolean {
    return !this.isConnecting && this.currentStatus !== 'connected';
  }

  getStatus(): ConnectionStatus {
    return this.currentStatus;
  }

  onStatusChange(callback: (status: ConnectionStatus) => void) {
    this.statusCallback = callback;
  }

  onQR(callback: (qr: string | null) => void) {
    this.qrCallback = callback;
  }

  onConnectionReady(callback: (sock: WASocket) => void) {
    this.connectionReadyCallback = callback;
  }
}

export const whatsappConnection = new WhatsAppConnection();
