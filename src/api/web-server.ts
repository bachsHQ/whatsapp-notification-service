import express, { Request, Response, NextFunction } from 'express';
import QRCode from 'qrcode';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { WhatsAppConnection } from '../bot/connection';
import { sendNotification } from './notify';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'logged_out';

export class WebServer {
  private app: express.Application;
  private server: any;
  private port: number;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private latestQR: string | null = null;
  private whatsappConnection: WhatsAppConnection | null = null;

  constructor(port: number = 3000) {
    this.app = express();
    this.app.use(express.json());
    this.port = port;
    this.setupRoutes();
  }

  setWhatsAppConnection(connection: WhatsAppConnection) {
    this.whatsappConnection = connection;
  }

  private requireApiKey(req: Request, res: Response, next: NextFunction) {
    const key = req.headers['x-api-key'];
    if (!key || key !== config.apiKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }

  private setupRoutes() {
    // GET /groups — list all groups the bot is a member of
    this.app.get('/groups', this.requireApiKey.bind(this), async (_req: Request, res: Response) => {
      const sock = this.whatsappConnection?.getSocket();
      if (!this.whatsappConnection?.isConnected() || !sock) {
        res.status(503).json({ error: 'WhatsApp not connected', status: this.connectionStatus });
        return;
      }

      try {
        const groups = await sock.groupFetchAllParticipating();
        const list = Object.values(groups).map((g) => ({
          id: g.id,
          name: g.subject
        }));
        res.json(list);
      } catch (err: any) {
        logger.error({ err }, 'Failed to fetch groups');
        res.status(502).json({ error: 'Failed to fetch groups', detail: err?.message });
      }
    });

    // POST /notify — send a WhatsApp message to one or multiple recipients
    this.app.post('/notify', this.requireApiKey.bind(this), async (req: Request, res: Response) => {
      const { to, message } = req.body ?? {};

      if (!to || (typeof to !== 'string' && !Array.isArray(to))) {
        res.status(400).json({ error: '"to" must be a phone number string or an array of phone numbers/group JIDs' });
        return;
      }
      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: 'Missing or invalid "message" field' });
        return;
      }

      const sock = this.whatsappConnection?.getSocket();
      if (!this.whatsappConnection?.isConnected() || !sock) {
        res.status(503).json({ error: 'WhatsApp not connected', status: this.connectionStatus });
        return;
      }

      const recipients: string[] = Array.isArray(to) ? to : [to];

      const results = await Promise.allSettled(
        recipients.map((recipient) => sendNotification(sock, recipient, message))
      );

      const summary = results.map((result, i) => ({
        to: recipients[i],
        ok: result.status === 'fulfilled',
        ...(result.status === 'rejected' && { error: (result.reason as any)?.message })
      }));

      const allOk = summary.every((s) => s.ok);
      const anyOk = summary.some((s) => s.ok);

      const statusCode = allOk ? 200 : anyOk ? 207 : 502;
      res.status(statusCode).json({ results: summary });
    });

    // GET /health
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        connection_status: this.connectionStatus
      });
    });

    // GET /status
    this.app.get('/status', (_req: Request, res: Response) => {
      res.json({
        service: config.serviceName,
        connection_status: this.connectionStatus,
        uptime_seconds: Math.floor(process.uptime()),
        memory_usage: process.memoryUsage(),
        node_version: process.version
      });
    });

    // GET /qr — WhatsApp auth UI
    this.app.get('/qr', async (_req: Request, res: Response) => {
      try {
        let qrDataURL = '';
        if (this.latestQR) {
          qrDataURL = await QRCode.toDataURL(this.latestQR, { width: 300, margin: 2 });
        }

        const statusColor: Record<ConnectionStatus, string> = {
          connected: '#10b981',
          connecting: '#f59e0b',
          disconnected: '#ef4444',
          logged_out: '#ef4444'
        };

        const body = this.connectionStatus === 'connected'
          ? `<div class="badge" style="background:${statusColor.connected}">Connected</div>
             <p style="margin-top:1.5rem;color:#10b981;font-weight:600">Service is connected and ready to send notifications.</p>
             <p style="color:#666">Uptime: ${Math.floor(process.uptime())}s</p>`
          : this.connectionStatus === 'logged_out'
          ? `<div class="badge" style="background:${statusColor.logged_out}">Logged Out</div>
             <p>Delete <code>auth_info_baileys/</code> and restart to re-authenticate.</p>`
          : this.connectionStatus === 'disconnected'
          ? `<div class="badge" style="background:${statusColor.disconnected}">Disconnected</div>
             <p>Click Connect to start the WhatsApp pairing process.</p>
             <button onclick="connect()">Connect to WhatsApp</button>
             <div id="err" style="display:none;color:#c00;margin-top:1rem"></div>`
          : qrDataURL
          ? `<div class="badge" style="background:${statusColor.connecting}">Scan QR Code</div>
             <div class="qr"><img src="${qrDataURL}" alt="QR Code" /></div>
             <p>Open WhatsApp → Settings → Linked Devices → Link a Device</p>`
          : `<div class="badge" style="background:${statusColor.connecting}">Generating QR...</div>
             <p>Please wait...</p>`;

        const autoRefresh = this.latestQR
          ? '<meta http-equiv="refresh" content="30">'
          : this.connectionStatus === 'connecting'
          ? '<meta http-equiv="refresh" content="5">'
          : '';

        res.setHeader('Content-Type', 'text/html');
        res.send(`<!DOCTYPE html><html><head>
          <title>WhatsApp Notification Service</title>
          ${autoRefresh}
          <style>
            body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#25d366,#128c7e)}
            .card{background:#fff;padding:2.5rem;border-radius:1rem;box-shadow:0 20px 60px rgba(0,0,0,.3);text-align:center;max-width:480px;width:100%}
            h1{color:#333;margin:0 0 .25rem}
            .sub{color:#666;margin:0 0 2rem;font-size:.95rem}
            .badge{display:inline-block;padding:.4rem 1rem;border-radius:.5rem;color:#fff;font-weight:700;margin-bottom:1rem}
            .qr{margin:1.5rem 0;padding:1rem;background:#f9fafb;border-radius:.75rem;border:2px solid #e5e7eb}
            .qr img{max-width:280px}
            button{margin-top:1rem;padding:.8rem 2rem;font-size:1rem;font-weight:700;color:#fff;background:#25d366;border:none;border-radius:.5rem;cursor:pointer}
            button:hover{background:#1da851}
            code{background:#f3f4f6;padding:.1rem .4rem;border-radius:.25rem;font-size:.85rem}
          </style>
          <script>
            async function connect(){
              const btn=document.querySelector('button');
              const err=document.getElementById('err');
              btn.disabled=true;btn.textContent='Connecting...';err.style.display='none';
              try{
                const r=await fetch('/connect',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':'${config.apiKey}'}});
                const d=await r.json();
                if(r.ok&&d.success){setTimeout(()=>location.reload(),1000);}
                else throw new Error(d.error||'Failed');
              }catch(e){err.textContent=e.message;err.style.display='block';btn.disabled=false;btn.textContent='Connect to WhatsApp';}
            }
          </script>
        </head><body><div class="card">
          <h1>WhatsApp Notification Service</h1>
          <p class="sub">${config.serviceName}</p>
          ${body}
        </div></body></html>`);
      } catch (err) {
        logger.error({ err }, 'Error generating QR page');
        res.status(500).send('Error generating page');
      }
    });

    // POST /connect — trigger WhatsApp connection
    this.app.post('/connect', this.requireApiKey.bind(this), async (_req: Request, res: Response) => {
      if (!this.whatsappConnection) {
        res.status(500).json({ success: false, error: 'Connection not initialized' });
        return;
      }
      if (!this.whatsappConnection.canConnect()) {
        res.status(400).json({ success: false, error: 'Already connected or connecting', status: this.whatsappConnection.getStatus() });
        return;
      }
      try {
        await this.whatsappConnection.connect();
        res.json({ success: true, message: 'Connection started — scan the QR code at /qr' });
      } catch (err: any) {
        logger.error({ err }, 'Failed to start connection');
        res.status(500).json({ success: false, error: err.message });
      }
    });

    this.app.get('/', (_req: Request, res: Response) => res.redirect('/qr'));

    this.app.use((req: Request, res: Response) => {
      res.status(404).json({ error: 'Not Found', path: req.path });
    });
  }

  updateConnectionStatus(status: ConnectionStatus) {
    this.connectionStatus = status;
    logger.info({ status }, 'Connection status updated');
  }

  updateQR(qr: string | null) {
    this.latestQR = qr;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`Web server started on port ${this.port}`);
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err: any) => (err ? reject(err) : resolve()));
    });
  }
}
