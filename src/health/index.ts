/**
 * ============================================
 * Health Check & Metrics Server
 * خادم الصحة والمقاييس
 * ============================================
 * 
 * Lightweight HTTP server providing:
 * - /health - Liveness check
 * - /ready - Readiness (all scanners connected)
 * - /metrics - Prometheus-compatible metrics
 * - /status - JSON status report
 */

import http from 'http';
import { Chain } from '../utils/types';
import { logger } from '../utils/logger';
import { i18n } from '../i18n';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
  mode: string;
  scanners: Record<string, boolean>;
  positions: number;
  dailyPnl: number;
  memoryMb: number;
  lastActivity: number;
}

type StatusProvider = () => HealthStatus;

export class HealthServer {
  private server: http.Server | null = null;
  private port: number;
  private startTime: number;
  private statusProvider: StatusProvider | null = null;

  constructor(port: number = 3847) {
    this.port = port;
    this.startTime = Date.now();
  }

  /**
   * Set the function that provides current status
   */
  setStatusProvider(provider: StatusProvider): void {
    this.statusProvider = provider;
  }

  /**
   * Start the health check server
   * بدء خادم الفحص الصحي
   */
  start(): void {
    this.server = http.createServer((req, res) => {
      const url = req.url || '/';
      
      switch (url) {
        case '/health':
          this.handleHealth(res);
          break;
        case '/ready':
          this.handleReady(res);
          break;
        case '/metrics':
          this.handleMetrics(res);
          break;
        case '/status':
          this.handleStatus(res);
          break;
        default:
          res.writeHead(404);
          res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      logger.info(i18n.t('system', 'info', {
        message: `Health server listening on port ${this.port}`,
      }));
    });
  }

  private handleHealth(res: http.ServerResponse): void {
    const status = this.getStatus();
    const code = status.status === 'unhealthy' ? 503 : 200;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: status.status, uptime: status.uptime }));
  }

  private handleReady(res: http.ServerResponse): void {
    const status = this.getStatus();
    const allScannersUp = Object.values(status.scanners).every(v => v);
    const code = allScannersUp ? 200 : 503;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: allScannersUp, scanners: status.scanners }));
  }

  private handleMetrics(res: http.ServerResponse): void {
    const status = this.getStatus();
    const metrics = [
      `# HELP trad_uptime_seconds Bot uptime in seconds`,
      `# TYPE trad_uptime_seconds gauge`,
      `trad_uptime_seconds ${Math.floor(status.uptime / 1000)}`,
      `# HELP trad_positions_active Active positions count`,
      `# TYPE trad_positions_active gauge`,
      `trad_positions_active ${status.positions}`,
      `# HELP trad_daily_pnl Daily PnL`,
      `# TYPE trad_daily_pnl gauge`,
      `trad_daily_pnl ${status.dailyPnl}`,
      `# HELP trad_memory_bytes Memory usage in bytes`,
      `# TYPE trad_memory_bytes gauge`,
      `trad_memory_bytes ${status.memoryMb * 1024 * 1024}`,
    ].join('\n');

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(metrics);
  }

  private handleStatus(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(this.getStatus(), null, 2));
  }

  private getStatus(): HealthStatus {
    if (this.statusProvider) {
      return this.statusProvider();
    }

    const mem = process.memoryUsage();
    return {
      status: 'healthy',
      uptime: Date.now() - this.startTime,
      version: '1.0.0',
      mode: process.env.TRADING_MODE || 'paper',
      scanners: {},
      positions: 0,
      dailyPnl: 0,
      memoryMb: Math.round(mem.heapUsed / 1024 / 1024),
      lastActivity: Date.now(),
    };
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
