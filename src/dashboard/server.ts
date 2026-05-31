/**
 * ============================================
 * Dashboard WebSocket Server
 * خادم لوحة المعلومات عبر WebSocket
 * ============================================
 * 
 * Real-time dashboard providing:
 * - Live position updates
 * - Trade feed
 * - Scanner activity stream
 * - PnL charts data
 * - System health metrics
 */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Position, Chain } from '../utils/types';
import { logger } from '../utils/logger';
import { i18n } from '../i18n';

interface DashboardMessage {
  type: 'position_update' | 'new_trade' | 'token_discovered' | 'rug_alert' | 'pnl_update' | 'system_status';
  data: any;
  timestamp: number;
}

export class DashboardServer {
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private clients: Set<WebSocket> = new Set();
  private port: number;
  private messageBuffer: DashboardMessage[] = [];
  private maxBufferSize: number = 100;

  constructor(port: number = 3848) {
    this.port = port;
  }

  /**
   * Start the WebSocket dashboard server
   * بدء خادم لوحة المعلومات WebSocket
   */
  start(): void {
    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.getDashboardHTML());
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      
      // Send buffered messages to new client
      for (const msg of this.messageBuffer) {
        ws.send(JSON.stringify(msg));
      }

      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });

    this.httpServer.listen(this.port, () => {
      logger.info(i18n.t('system', 'info', {
        message: `Dashboard WebSocket server on port ${this.port}`,
      }));
    });
  }

  /**
   * Broadcast a message to all connected clients
   * بث رسالة لجميع العملاء المتصلين
   */
  broadcast(type: DashboardMessage['type'], data: any): void {
    const message: DashboardMessage = { type, data, timestamp: Date.now() };
    
    // Buffer message
    this.messageBuffer.push(message);
    if (this.messageBuffer.length > this.maxBufferSize) {
      this.messageBuffer.shift();
    }

    const payload = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // Convenience methods
  sendPositionUpdate(positions: Position[]): void {
    this.broadcast('position_update', { positions });
  }

  sendNewTrade(trade: any): void {
    this.broadcast('new_trade', trade);
  }

  sendTokenDiscovered(token: any): void {
    this.broadcast('token_discovered', token);
  }

  sendRugAlert(data: any): void {
    this.broadcast('rug_alert', data);
  }

  sendPnlUpdate(pnl: any): void {
    this.broadcast('pnl_update', pnl);
  }

  private getDashboardHTML(): string {
    return `<!DOCTYPE html>
<html dir="auto"><head><meta charset="utf-8">
<title>TRAD Sniper Dashboard</title>
<style>
body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:20px}
h1{color:#58a6ff}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin:10px 0}
.green{color:#3fb950}.red{color:#f85149}.yellow{color:#d29922}
#feed{max-height:400px;overflow-y:auto}
.entry{padding:4px 0;border-bottom:1px solid #21262d;font-size:13px}
</style></head><body>
<h1>🤖 TRAD Sniper Dashboard</h1>
<div class="card"><h3>Live Feed</h3><div id="feed"></div></div>
<script>
const ws=new WebSocket('ws://'+location.host);
const feed=document.getElementById('feed');
ws.onmessage=(e)=>{
  const msg=JSON.parse(e.data);
  const div=document.createElement('div');
  div.className='entry';
  const time=new Date(msg.timestamp).toLocaleTimeString();
  div.innerHTML='<span class="yellow">['+time+']</span> <b>'+msg.type+'</b>: '+JSON.stringify(msg.data).slice(0,120);
  feed.prepend(div);
  if(feed.children.length>200)feed.lastChild.remove();
};
</script></body></html>`;
  }

  stop(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    if (this.wss) this.wss.close();
    if (this.httpServer) this.httpServer.close();
  }
}
