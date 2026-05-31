/**
 * ============================================
 * Database Layer - SQLite + In-Memory Cache
 * طبقة قاعدة البيانات - SQLite + ذاكرة مؤقتة
 * ============================================
 * 
 * Persistent storage for:
 * - Trade history and closed positions
 * - Audit results cache
 * - Daily/weekly PnL reports
 * - Blacklist/whitelist entries
 * - Token metadata cache
 */

import fs from 'fs';
import path from 'path';
import { Position, AuditResult, Chain } from '../utils/types';
import { logger } from '../utils/logger';
import { i18n } from '../i18n';

// Lightweight JSON-file database (production should use better-sqlite3)
interface DatabaseSchema {
  trades: TradeRecord[];
  positions: PositionRecord[];
  audits: AuditRecord[];
  blacklist: BlacklistEntry[];
  whitelist: WhitelistEntry[];
  stats: DailyStats[];
}

export interface TradeRecord {
  id: string;
  tokenAddress: string;
  chain: Chain;
  action: 'buy' | 'sell' | 'emergency_sell';
  amount: number;
  price: number;
  txHash: string;
  timestamp: number;
  pnl?: number;
  pnlPercent?: number;
  fees: number;
}

export interface PositionRecord {
  id: string;
  tokenAddress: string;
  chain: Chain;
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  entryTime: number;
  exitTime?: number;
  pnl: number;
  pnlPercent: number;
  status: 'open' | 'closed' | 'emergency_closed';
  exitReason?: string;
}

export interface AuditRecord {
  tokenAddress: string;
  chain: Chain;
  passed: boolean;
  auditTimeMs: number;
  failReasons: string[];
  timestamp: number;
  ttl: number; // Expiry timestamp
}

export interface BlacklistEntry {
  address: string;
  type: 'token' | 'deployer' | 'wallet';
  chain: Chain;
  reason: string;
  addedAt: number;
}

export interface WhitelistEntry {
  address: string;
  type: 'token' | 'deployer';
  chain: Chain;
  note: string;
  addedAt: number;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
  gasSpent: number;
}


export class Database {
  private data: DatabaseSchema;
  private dbPath: string;
  private saveInterval: NodeJS.Timeout | null = null;
  private isDirty: boolean = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'trad.db.json');
    this.data = this.load();
    
    // Auto-save every 10 seconds if dirty
    this.saveInterval = setInterval(() => {
      if (this.isDirty) this.save();
    }, 10_000);
  }

  // ---- Trades ----
  
  addTrade(trade: TradeRecord): void {
    this.data.trades.push(trade);
    this.isDirty = true;
  }

  getTrades(limit: number = 100, chain?: Chain): TradeRecord[] {
    let trades = this.data.trades;
    if (chain) trades = trades.filter(t => t.chain === chain);
    return trades.slice(-limit);
  }

  // ---- Positions ----

  addPosition(pos: PositionRecord): void {
    this.data.positions.push(pos);
    this.isDirty = true;
  }

  updatePosition(id: string, update: Partial<PositionRecord>): void {
    const idx = this.data.positions.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.data.positions[idx] = { ...this.data.positions[idx], ...update };
      this.isDirty = true;
    }
  }

  getOpenPositions(): PositionRecord[] {
    return this.data.positions.filter(p => p.status === 'open');
  }

  getClosedPositions(limit: number = 50): PositionRecord[] {
    return this.data.positions
      .filter(p => p.status !== 'open')
      .slice(-limit);
  }

  // ---- Audits ----

  cacheAudit(audit: AuditRecord): void {
    // Remove expired entries
    const now = Date.now();
    this.data.audits = this.data.audits.filter(a => a.ttl > now);
    this.data.audits.push(audit);
    this.isDirty = true;
  }

  getCachedAudit(tokenAddress: string, chain: Chain): AuditRecord | null {
    const now = Date.now();
    return this.data.audits.find(
      a => a.tokenAddress === tokenAddress && a.chain === chain && a.ttl > now
    ) || null;
  }

  // ---- Blacklist ----

  addToBlacklist(entry: BlacklistEntry): void {
    if (!this.isBlacklisted(entry.address, entry.chain)) {
      this.data.blacklist.push(entry);
      this.isDirty = true;
    }
  }

  removeFromBlacklist(address: string, chain: Chain): void {
    this.data.blacklist = this.data.blacklist.filter(
      b => !(b.address === address && b.chain === chain)
    );
    this.isDirty = true;
  }

  isBlacklisted(address: string, chain: Chain): boolean {
    return this.data.blacklist.some(
      b => b.address.toLowerCase() === address.toLowerCase() && b.chain === chain
    );
  }

  getBlacklist(): BlacklistEntry[] {
    return this.data.blacklist;
  }

  // ---- Whitelist ----

  addToWhitelist(entry: WhitelistEntry): void {
    if (!this.isWhitelisted(entry.address, entry.chain)) {
      this.data.whitelist.push(entry);
      this.isDirty = true;
    }
  }

  isWhitelisted(address: string, chain: Chain): boolean {
    return this.data.whitelist.some(
      w => w.address.toLowerCase() === address.toLowerCase() && w.chain === chain
    );
  }

  // ---- Stats ----

  recordDailyStats(stats: DailyStats): void {
    const idx = this.data.stats.findIndex(s => s.date === stats.date);
    if (idx !== -1) {
      this.data.stats[idx] = stats;
    } else {
      this.data.stats.push(stats);
    }
    this.isDirty = true;
  }

  getDailyStats(days: number = 30): DailyStats[] {
    return this.data.stats.slice(-days);
  }

  // ---- Persistence ----

  private load(): DatabaseSchema {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (error) {
      logger.warn(i18n.t('system', 'warning', { message: `DB load failed: ${error}` }));
    }

    return {
      trades: [],
      positions: [],
      audits: [],
      blacklist: [],
      whitelist: [],
      stats: [],
    };
  }

  save(): void {
    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
      this.isDirty = false;
    } catch (error) {
      logger.error(i18n.t('system', 'error', { message: `DB save failed: ${error}` }));
    }
  }

  close(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    if (this.isDirty) this.save();
  }
}
