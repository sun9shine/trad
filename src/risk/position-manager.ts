/**
 * ============================================
 * Position Manager - Active Trade Tracking
 * مدير المراكز - تتبع الصفقات النشطة
 * ============================================
 * 
 * Manages all open positions with:
 * - Trailing stop-loss that adjusts with price growth
 * - Take profit triggers
 * - Real-time PnL calculation
 * - Position lifecycle management
 */

import EventEmitter from 'eventemitter3';
import { Position, TokenInfo, ExecutionResult, Chain } from '../utils/types';
import { config } from '../config';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';
import { TIMING } from '../utils/constants';
import { v4 as uuidv4 } from 'crypto';

interface PositionEvents {
  'stop:triggered': (position: Position) => void;
  'takeprofit:triggered': (position: Position) => void;
  'position:opened': (position: Position) => void;
  'position:closed': (position: Position) => void;
  'stop:updated': (position: Position, oldStop: number, newStop: number) => void;
}

export class PositionManager extends EventEmitter<PositionEvents> {
  private positions: Map<string, Position> = new Map(); // tokenAddress -> Position
  private closedPositions: Position[] = [];
  private monitorInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  // Daily stats
  private dailyPnl: number = 0;
  private dailyTrades: number = 0;
  private dailyWins: number = 0;

  constructor() {
    super();
  }

  /**
   * Start position monitoring loop
   * بدء حلقة مراقبة المراكز
   */
  start(): void {
    this.isRunning = true;
    this.monitorInterval = setInterval(() => {
      this.checkAllPositions();
    }, TIMING.POSITION_CHECK_MS);

    logger.info(i18n.t('system', 'info', { 
      message: `Position manager active - monitoring every ${TIMING.POSITION_CHECK_MS}ms` 
    }));
  }

  /**
   * Open a new position after successful buy
   * فتح مركز جديد بعد شراء ناجح
   */
  openPosition(
    token: TokenInfo,
    entryPrice: number,
    amount: number,
    entryTx: string
  ): Position {
    const trailingStopPrice = entryPrice * (1 - config.risk.trailingStopPercent / 100);
    const takeProfitPrice = entryPrice * (1 + config.risk.takeProfitPercent / 100);

    const position: Position = {
      id: this.generateId(),
      token,
      chain: token.chain,
      entryPrice,
      currentPrice: entryPrice,
      amount,
      entryTx,
      entryTime: Date.now(),
      stopLoss: trailingStopPrice,
      takeProfit: takeProfitPrice,
      trailingStop: config.risk.trailingStopPercent,
      highestPrice: entryPrice,
      pnl: 0,
      pnlPercent: 0,
      status: 'open',
    };

    this.positions.set(token.address, position);

    logger.info(i18n.t('risk', 'positionOpened', {
      token: token.symbol || token.address.slice(0, 12),
      price: entryPrice.toFixed(8),
      size: amount.toString(),
    }));

    this.emit('position:opened', position);
    return position;
  }

  /**
   * Update price for a position (called by price feed)
   * تحديث السعر لمركز (يُستدعى من مصدر الأسعار)
   */
  updatePrice(tokenAddress: string, newPrice: number): void {
    const position = this.positions.get(tokenAddress);
    if (!position || position.status !== 'open') return;

    position.currentPrice = newPrice;
    position.pnl = (newPrice - position.entryPrice) * position.amount;
    position.pnlPercent = ((newPrice - position.entryPrice) / position.entryPrice) * 100;

    // Update trailing stop if price made new high
    if (newPrice > position.highestPrice) {
      position.highestPrice = newPrice;
      const oldStop = position.stopLoss;
      const newStop = newPrice * (1 - position.trailingStop / 100);

      // Only move stop UP, never down
      if (newStop > position.stopLoss) {
        position.stopLoss = newStop;
        
        logger.info(i18n.t('risk', 'stopLossUpdated', {
          token: position.token.symbol || tokenAddress.slice(0, 12),
          oldStop: oldStop.toFixed(8),
          newStop: newStop.toFixed(8),
        }));

        this.emit('stop:updated', position, oldStop, newStop);
      }
    }
  }

  /**
   * Check all positions for stop/take-profit triggers
   * فحص جميع المراكز لتفعيل الوقف/جني الأرباح
   */
  private checkAllPositions(): void {
    for (const [tokenAddress, position] of this.positions) {
      if (position.status !== 'open') continue;

      // Check trailing stop
      if (position.currentPrice <= position.stopLoss) {
        logger.info(i18n.t('risk', 'trailingStopHit', {
          token: position.token.symbol || tokenAddress.slice(0, 12),
          price: position.currentPrice.toFixed(8),
          pnl: position.pnlPercent.toFixed(2) + '%',
        }));
        this.emit('stop:triggered', position);
      }

      // Check take profit
      if (position.currentPrice >= position.takeProfit) {
        logger.info(i18n.t('risk', 'takeProfitHit', {
          token: position.token.symbol || tokenAddress.slice(0, 12),
          price: position.currentPrice.toFixed(8),
          pnl: position.pnlPercent.toFixed(2) + '%',
        }));
        this.emit('takeprofit:triggered', position);
      }
    }
  }

  /**
   * Close a position (after sell execution)
   * إغلاق مركز (بعد تنفيذ البيع)
   */
  closePosition(
    tokenAddress: string, 
    exitPrice: number, 
    reason: 'stop' | 'takeprofit' | 'manual' | 'emergency'
  ): Position | null {
    const position = this.positions.get(tokenAddress);
    if (!position) return null;

    position.currentPrice = exitPrice;
    position.pnl = (exitPrice - position.entryPrice) * position.amount;
    position.pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    position.status = reason === 'emergency' ? 'emergency_closed' : 'closed';

    // Update daily stats
    this.dailyPnl += position.pnl;
    this.dailyTrades++;
    if (position.pnl > 0) this.dailyWins++;

    // Move to closed positions
    this.positions.delete(tokenAddress);
    this.closedPositions.push(position);

    logger.info(i18n.t('risk', 'positionClosed', {
      token: position.token.symbol || tokenAddress.slice(0, 12),
      price: exitPrice.toFixed(8),
      pnl: position.pnlPercent.toFixed(2) + '%',
    }));

    this.emit('position:closed', position);
    return position;
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): Position[] {
    return Array.from(this.positions.values()).filter(p => p.status === 'open');
  }

  /**
   * Get position by token address
   */
  getPosition(tokenAddress: string): Position | undefined {
    return this.positions.get(tokenAddress);
  }

  /**
   * Get daily PnL stats
   */
  getDailyStats(): { pnl: number; trades: number; winRate: number } {
    return {
      pnl: this.dailyPnl,
      trades: this.dailyTrades,
      winRate: this.dailyTrades > 0 ? (this.dailyWins / this.dailyTrades) * 100 : 0,
    };
  }

  /**
   * Check if daily loss limit is reached
   */
  isDailyLimitReached(): boolean {
    // If daily PnL is negative and exceeds 50% of max buy, stop trading
    const maxDailyLoss = -(config.risk.maxBuyAmountSol * 3); // 3x max buy as daily limit
    return this.dailyPnl < maxDailyLoss;
  }

  /**
   * Reset daily stats (called at midnight)
   */
  resetDailyStats(): void {
    this.dailyPnl = 0;
    this.dailyTrades = 0;
    this.dailyWins = 0;
    this.closedPositions = [];
  }

  /**
   * Stop position monitoring
   */
  stop(): void {
    this.isRunning = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  private generateId(): string {
    return `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
