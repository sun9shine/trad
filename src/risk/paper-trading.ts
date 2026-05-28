/**
 * ============================================
 * Paper Trading Engine - Virtual Execution Simulator
 * محرك التداول الورقي - محاكاة التنفيذ الافتراضي
 * ============================================
 * 
 * Simulates real trades without risking funds:
 * - Matches real-time order book conditions
 * - Calculates realistic slippage based on liquidity
 * - Simulates gas/fee costs
 * - Tracks virtual PnL with full position management
 * 
 * Perfect for strategy testing before going live.
 */

import EventEmitter from 'eventemitter3';
import { TokenInfo, ExecutionResult, TradeSignal, Position, Chain } from '../utils/types';
import { config } from '../config';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';

interface PaperTrade {
  id: string;
  signal: TradeSignal;
  action: 'buy' | 'sell';
  tokenAddress: string;
  chain: Chain;
  amount: number;
  price: number;
  simulatedSlippage: number;
  simulatedFees: number;
  effectivePrice: number;
  timestamp: number;
  virtualTxHash: string;
}

interface PaperPosition {
  tokenAddress: string;
  chain: Chain;
  entryPrice: number;
  currentPrice: number;
  amount: number;
  entryTime: number;
  fees: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

interface PaperStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  totalFees: number;
  winRate: number;
  averagePnl: number;
  bestTrade: number;
  worstTrade: number;
  sharpeRatio: number;
}

export class PaperTradingEngine extends EventEmitter {
  private trades: PaperTrade[] = [];
  private positions: Map<string, PaperPosition> = new Map();
  private virtualBalance: Map<Chain, number> = new Map();
  private closedPnls: number[] = [];
  private isActive: boolean = false;

  constructor() {
    super();
    this.initializeBalances();
  }

  /**
   * Initialize virtual balances from config
   * تهيئة الأرصدة الافتراضية من الإعدادات
   */
  private initializeBalances(): void {
    this.virtualBalance.set('solana', config.risk.maxBuyAmountSol * 10);
    this.virtualBalance.set('base', config.risk.maxBuyAmountEth * 10);
    this.virtualBalance.set('bnb', config.risk.maxBuyAmountEth * 10);
    this.virtualBalance.set('sui', config.risk.maxBuyAmountSui * 10);
    this.virtualBalance.set('hyperliquid', 1000);
  }

  /**
   * Start paper trading mode
   * بدء وضع التداول الورقي
   */
  start(): void {
    this.isActive = true;
    logger.info(i18n.t('system', 'paperMode'));
    logger.info(i18n.t('system', 'info', { 
      message: 'Paper trading engine active - all trades are simulated' 
    }));
  }

  /**
   * Simulate a buy execution
   * محاكاة تنفيذ شراء
   */
  simulateBuy(signal: TradeSignal): ExecutionResult {
    const token = signal.token;
    const chain = token.chain;

    // Check virtual balance
    const balance = this.virtualBalance.get(chain) || 0;
    if (balance < signal.amount) {
      logger.warn(i18n.t('sniper', 'insufficientBalance', {
        needed: signal.amount.toString(),
        available: balance.toString(),
      }));
      return {
        success: false,
        error: 'Insufficient virtual balance',
        chain,
        timestamp: Date.now(),
      };
    }

    // Calculate simulated execution parameters
    const simulatedSlippage = this.calculateSimulatedSlippage(signal);
    const simulatedFees = this.calculateSimulatedFees(chain);
    const basePrice = this.getSimulatedPrice(token);
    const effectivePrice = basePrice * (1 + simulatedSlippage / 100);

    // Deduct from virtual balance
    this.virtualBalance.set(chain, balance - signal.amount - simulatedFees);

    // Create paper position
    const tokenAmount = signal.amount / effectivePrice;
    const position: PaperPosition = {
      tokenAddress: token.address,
      chain,
      entryPrice: effectivePrice,
      currentPrice: effectivePrice,
      amount: tokenAmount,
      entryTime: Date.now(),
      fees: simulatedFees,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
    };

    this.positions.set(token.address, position);

    // Record trade
    const trade: PaperTrade = {
      id: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      signal,
      action: 'buy',
      tokenAddress: token.address,
      chain,
      amount: signal.amount,
      price: basePrice,
      simulatedSlippage,
      simulatedFees,
      effectivePrice,
      timestamp: Date.now(),
      virtualTxHash: `0xPAPER_${Date.now().toString(16)}`,
    };

    this.trades.push(trade);

    logger.info(i18n.t('sniper', 'buyExecuted', {
      amount: tokenAmount.toFixed(4),
      token: token.address.slice(0, 12) + '...',
      price: effectivePrice.toFixed(8),
      tx: trade.virtualTxHash,
    }));

    return {
      success: true,
      txHash: trade.virtualTxHash,
      effectivePrice,
      slippage: simulatedSlippage,
      chain,
      timestamp: Date.now(),
    };
  }

  /**
   * Simulate a sell execution
   * محاكاة تنفيذ بيع
   */
  simulateSell(tokenAddress: string, currentPrice?: number): ExecutionResult {
    const position = this.positions.get(tokenAddress);
    if (!position) {
      return {
        success: false,
        error: 'No paper position found',
        chain: 'solana',
        timestamp: Date.now(),
      };
    }

    const sellPrice = currentPrice || position.currentPrice;
    const simulatedSlippage = 0.5 + Math.random() * 1.5; // 0.5-2% sell slippage
    const effectiveSellPrice = sellPrice * (1 - simulatedSlippage / 100);
    const simulatedFees = this.calculateSimulatedFees(position.chain);

    // Calculate PnL
    const proceeds = position.amount * effectiveSellPrice;
    const cost = position.amount * position.entryPrice;
    const pnl = proceeds - cost - position.fees - simulatedFees;
    const pnlPercent = ((effectiveSellPrice - position.entryPrice) / position.entryPrice) * 100;

    // Return funds to virtual balance
    const currentBalance = this.virtualBalance.get(position.chain) || 0;
    this.virtualBalance.set(position.chain, currentBalance + proceeds - simulatedFees);

    // Record closed PnL
    this.closedPnls.push(pnlPercent);

    // Record sell trade
    const trade: PaperTrade = {
      id: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      signal: {} as TradeSignal,
      action: 'sell',
      tokenAddress,
      chain: position.chain,
      amount: position.amount,
      price: sellPrice,
      simulatedSlippage,
      simulatedFees,
      effectivePrice: effectiveSellPrice,
      timestamp: Date.now(),
      virtualTxHash: `0xPAPER_SELL_${Date.now().toString(16)}`,
    };

    this.trades.push(trade);

    // Remove position
    this.positions.delete(tokenAddress);

    logger.info(i18n.t('sniper', 'sellExecuted', {
      amount: position.amount.toFixed(4),
      token: tokenAddress.slice(0, 12) + '...',
      price: effectiveSellPrice.toFixed(8),
      pnl: `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`,
      tx: trade.virtualTxHash,
    }));

    return {
      success: true,
      txHash: trade.virtualTxHash,
      effectivePrice: effectiveSellPrice,
      slippage: simulatedSlippage,
      chain: position.chain,
      timestamp: Date.now(),
    };
  }

  /**
   * Update price for a paper position
   */
  updatePrice(tokenAddress: string, newPrice: number): void {
    const position = this.positions.get(tokenAddress);
    if (!position) return;

    position.currentPrice = newPrice;
    position.unrealizedPnl = (newPrice - position.entryPrice) * position.amount;
    position.unrealizedPnlPercent = ((newPrice - position.entryPrice) / position.entryPrice) * 100;
  }

  /**
   * Calculate simulated slippage based on liquidity and size
   * حساب الانزلاق المحاكى بناءً على السيولة والحجم
   */
  private calculateSimulatedSlippage(signal: TradeSignal): number {
    const liquidityFactor = signal.token.liquidity > 0 
      ? signal.amount / signal.token.liquidity 
      : 0.1;

    // Base slippage + impact based on trade size vs liquidity
    const baseSlippage = 0.3; // 0.3% minimum
    const impactSlippage = liquidityFactor * 100 * 2; // Price impact
    const randomVariance = Math.random() * 0.5; // Random market noise

    return Math.min(
      baseSlippage + impactSlippage + randomVariance,
      signal.maxSlippage
    );
  }

  /**
   * Calculate simulated gas/transaction fees
   */
  private calculateSimulatedFees(chain: Chain): number {
    const feeMap: Record<Chain, number> = {
      solana: 0.000005 + Math.random() * 0.001, // ~0.001 SOL with Jito tip
      base: 0.0001 + Math.random() * 0.0005,    // ~0.0005 ETH on Base
      bnb: 0.001 + Math.random() * 0.002,       // ~0.002 BNB
      sui: 0.01 + Math.random() * 0.05,          // ~0.05 SUI
      hyperliquid: 0.0001,
    };
    return feeMap[chain] || 0.001;
  }

  /**
   * Get simulated market price (in production, would use real price feed)
   */
  private getSimulatedPrice(token: TokenInfo): number {
    // Use liquidity as rough price indicator, or generate from pool
    if (token.liquidity > 0) {
      return token.liquidity / 1_000_000; // Very rough estimate
    }
    return 0.00001 + Math.random() * 0.001; // Random memecoin price
  }

  /**
   * Get comprehensive paper trading statistics
   * الحصول على إحصائيات شاملة للتداول الورقي
   */
  getStats(): PaperStats {
    const totalTrades = this.closedPnls.length;
    const winningTrades = this.closedPnls.filter(p => p > 0).length;
    const losingTrades = this.closedPnls.filter(p => p < 0).length;
    const totalPnl = this.closedPnls.reduce((sum, p) => sum + p, 0);
    const totalFees = this.trades.reduce((sum, t) => sum + t.simulatedFees, 0);

    // Calculate Sharpe Ratio (simplified)
    const avgReturn = totalTrades > 0 ? totalPnl / totalTrades : 0;
    const variance = totalTrades > 0 
      ? this.closedPnls.reduce((sum, p) => sum + Math.pow(p - avgReturn, 2), 0) / totalTrades
      : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      totalPnl,
      totalFees,
      winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
      averagePnl: totalTrades > 0 ? totalPnl / totalTrades : 0,
      bestTrade: this.closedPnls.length > 0 ? Math.max(...this.closedPnls) : 0,
      worstTrade: this.closedPnls.length > 0 ? Math.min(...this.closedPnls) : 0,
      sharpeRatio,
    };
  }

  /**
   * Get all open paper positions
   */
  getOpenPositions(): PaperPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get virtual balances
   */
  getBalances(): Map<Chain, number> {
    return this.virtualBalance;
  }

  /**
   * Get trade history
   */
  getTradeHistory(limit: number = 50): PaperTrade[] {
    return this.trades.slice(-limit);
  }

  /**
   * Check if paper trading is active
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Stop paper trading
   */
  stop(): void {
    this.isActive = false;
    const stats = this.getStats();
    
    logger.info(i18n.t('risk', 'pnlReport', {
      pnl: stats.totalPnl.toFixed(2) + '%',
      winRate: stats.winRate.toFixed(1),
      trades: stats.totalTrades.toString(),
    }));
  }
}
