/**
 * ============================================
 * TRAD SNIPER BOT - Main Orchestrator (v2)
 * بوت تراد القناص - المنسق الرئيسي (الإصدار 2)
 * ============================================
 *
 * Integrates ALL modules:
 * Scanner → Blacklist → Auditor → ChartAnalysis → PriorityQueue → Sniper
 *                                                        ↕
 *                                 PriceFeed → PositionManager ↔ MempoolMonitor
 *                                                        ↕
 *                               Database ← Dashboard ← Telegram ← HealthCheck
 */

import { config } from './config';
import { i18n } from './i18n';
import { logger } from './utils/logger';
import { ScannerOrchestrator } from './scanner';
import { SecurityAuditor } from './security';
import { SolanaSniper, EVMSniper, SuiSniper, HyperliquidSniper, MempoolMonitor } from './sniper';
import { PositionManager, PaperTradingEngine } from './risk';
import { TelegramBot } from './telegram/bot';
import { PriceFeed } from './price-feed';
import { Database } from './database';
import { HealthServer } from './health';
import { DashboardServer } from './dashboard/server';
import { BlacklistManager } from './utils/blacklist';
import { PriorityQueue } from './utils/priority-queue';
import { TTLSet } from './utils/ttl-set';
import { RateLimiter } from './utils/rate-limiter';
import { ChartAnalyzer } from './utils/chart-analysis';
import { TokenInfo, TradeSignal, Position, Chain } from './utils/types';

class TradSniperBot {
  // --- Core Modules ---
  private scanner: ScannerOrchestrator;
  private auditor: SecurityAuditor;
  private solanaSniper: SolanaSniper;
  private evmSniper: EVMSniper;
  private suiSniper: SuiSniper;
  private hyperliquidSniper: HyperliquidSniper;
  private mempoolMonitor: MempoolMonitor;
  private positionManager: PositionManager;
  private paperEngine: PaperTradingEngine;
  private telegramBot: TelegramBot;

  // --- Infrastructure ---
  private priceFeed: PriceFeed;
  private database: Database;
  private healthServer: HealthServer;
  private dashboardServer: DashboardServer;
  private blacklist: BlacklistManager;
  private queue: PriorityQueue<TokenInfo>;
  private processedTokens: TTLSet<string>;
  private rateLimiter: RateLimiter;
  private chartAnalyzer: ChartAnalyzer;

  // --- State ---
  private isPaused: boolean = false;
  private startTime: number = Date.now();

  constructor() {
    // Infrastructure first
    this.database = new Database();
    this.blacklist = new BlacklistManager(this.database);
    this.processedTokens = new TTLSet<string>(300_000, 50_000); // 5min TTL
    this.rateLimiter = new RateLimiter();
    this.chartAnalyzer = new ChartAnalyzer();
    this.priceFeed = new PriceFeed();
    this.healthServer = new HealthServer(3847);
    this.dashboardServer = new DashboardServer(3848);

    // Core modules
    this.scanner = new ScannerOrchestrator(['solana', 'base', 'sui', 'bnb']);
    this.auditor = new SecurityAuditor();
    this.solanaSniper = new SolanaSniper();
    this.evmSniper = new EVMSniper();
    this.suiSniper = new SuiSniper();
    this.hyperliquidSniper = new HyperliquidSniper();
    this.mempoolMonitor = new MempoolMonitor();
    this.positionManager = new PositionManager();
    this.paperEngine = new PaperTradingEngine();
    this.telegramBot = new TelegramBot();

    // Priority queue for token processing
    this.queue = new PriorityQueue<TokenInfo>({ maxConcurrency: 3, defaultTtlMs: 30_000 });
    this.queue.setProcessor((token) => this.processNewToken(token));

    // Wire events
    this.setupEventPipeline();
    this.setupHealthProvider();
  }

  /**
   * Start the bot
   * بدء البوت
   */
  async start(): Promise<void> {
    logger.info(i18n.t('system', 'startup', { mode: config.tradingMode }));

    if (config.isPaperTrading) {
      logger.info(i18n.t('system', 'paperMode'));
    } else {
      logger.info(i18n.t('system', 'liveMode'));
    }

    try {
      // Start infrastructure
      this.healthServer.start();
      this.dashboardServer.start();
      this.priceFeed.start();
      this.queue.start();

      // Start core modules in parallel
      await Promise.all([
        this.scanner.startAll(),
        this.mempoolMonitor.start(),
        this.telegramBot.start(),
      ]);

      this.positionManager.start();

      if (config.isPaperTrading) {
        this.paperEngine.start();
      }

      // Price feed → Position Manager integration
      this.setupPriceFeedLoop();

      // Telegram callbacks
      this.setupTelegramCallbacks();

      logger.info(i18n.t('system', 'info', {
        message: '=== TRAD SNIPER BOT v2 FULLY OPERATIONAL ===',
      }));
    } catch (error) {
      logger.error(i18n.t('system', 'error', { message: `Startup failed: ${error}` }));
      await this.shutdown();
    }
  }

  /**
   * Event pipeline connecting all modules
   * خط أنابيب الأحداث
   */
  private setupEventPipeline(): void {
    // Scanner → Queue (with blacklist filter)
    this.scanner.on('token:discovered', (token: TokenInfo) => {
      if (this.isPaused) return;
      if (this.processedTokens.has(token.address)) return;

      // Blacklist check
      const { rejected, reason } = this.blacklist.shouldReject(
        token.address, token.deployer, token.chain
      );
      if (rejected) {
        logger.info(i18n.t('scanner', 'tokenRejected', { token: token.address.slice(0, 12), reason: reason! }));
        return;
      }

      this.processedTokens.add(token.address);

      // Determine priority
      const priority = token.dex === 'pumpfun' ? 'high' : 'medium';
      this.queue.enqueue(token.address, token, token.chain, priority);

      // Dashboard broadcast
      this.dashboardServer.sendTokenDiscovered({
        address: token.address,
        chain: token.chain,
        dex: token.dex,
        time: new Date().toISOString(),
      });
    });

    // Mempool → Emergency Sell
    this.mempoolMonitor.on('rug:detected', async (data) => {
      await this.handleRugDetected(data);
    });

    // Position Manager → Sell
    this.positionManager.on('stop:triggered', (pos) => this.executeSell(pos, 'stop'));
    this.positionManager.on('takeprofit:triggered', (pos) => this.executeSell(pos, 'takeprofit'));
  }

  /**
   * Process a token through audit → chart → execute
   * معالجة عملة عبر التدقيق → الرسم → التنفيذ
   */
  private async processNewToken(token: TokenInfo): Promise<void> {
    try {
      // 1. Quick filter
      if (!this.auditor.quickFilter(token)) {
        logger.info(i18n.t('scanner', 'tokenRejected', { token: token.address.slice(0, 12), reason: 'Pre-filter' }));
        return;
      }

      // 2. Full security audit
      const auditResult = await this.auditor.audit(token);

      // Cache audit in database
      this.database.cacheAudit({
        tokenAddress: token.address,
        chain: token.chain,
        passed: auditResult.passed,
        auditTimeMs: auditResult.auditTimeMs,
        failReasons: auditResult.failReasons,
        timestamp: Date.now(),
        ttl: Date.now() + 600_000, // 10min cache
      });

      if (!auditResult.passed) {
        logger.info(i18n.t('scanner', 'tokenRejected', {
          token: token.address.slice(0, 12),
          reason: auditResult.failReasons.join('; '),
        }));
        return;
      }

      // 3. Token approved
      logger.info(i18n.t('scanner', 'tokenApproved', { token: token.address.slice(0, 12) }));

      // 4. Check daily limits
      if (this.positionManager.isDailyLimitReached()) {
        logger.warn(i18n.t('risk', 'dailyLimitReached'));
        return;
      }

      // 5. Build trade signal
      const signal: TradeSignal = {
        token,
        audit: auditResult,
        action: 'buy',
        amount: this.getBuyAmount(token.chain),
        maxSlippage: config.risk.maxSlippagePercent,
        priority: 'high',
        timestamp: Date.now(),
      };

      // 6. Execute
      await this.executeBuy(signal);
    } catch (error) {
      logger.error(i18n.t('system', 'error', {
        message: `Pipeline error ${token.address.slice(0, 12)}: ${error}`,
      }));
    }
  }

  /**
   * Execute buy
   */
  private async executeBuy(signal: TradeSignal): Promise<void> {
    let result;

    if (config.isPaperTrading) {
      result = this.paperEngine.simulateBuy(signal);
    } else {
      switch (signal.token.chain) {
        case 'solana':
          result = await this.solanaSniper.snipeBuy(signal);
          break;
        case 'base':
        case 'bnb':
          result = await this.evmSniper.snipeBuy(signal);
          break;
        case 'sui':
          result = await this.suiSniper.snipeBuy(signal);
          break;
        case 'hyperliquid':
          result = await this.hyperliquidSniper.snipeBuy(signal);
          break;
        default:
          logger.warn(i18n.t('system', 'warning', { message: `No sniper for ${signal.token.chain}` }));
          return;
      }
    }

    if (result.success) {
      // Open position
      const position = this.positionManager.openPosition(
        signal.token,
        result.effectivePrice || 0,
        signal.amount,
        result.txHash || ''
      );

      // Watch for rug
      this.mempoolMonitor.watchPosition(position);

      // Watch price
      this.priceFeed.watchToken(signal.token.address, signal.token.chain, 1000);

      // Record trade in DB
      this.database.addTrade({
        id: `trade_${Date.now()}`,
        tokenAddress: signal.token.address,
        chain: signal.token.chain,
        action: 'buy',
        amount: signal.amount,
        price: result.effectivePrice || 0,
        txHash: result.txHash || '',
        timestamp: Date.now(),
        fees: result.gasUsed || 0,
      });

      // Notify
      await this.telegramBot.notifySnipe(
        signal.token.address, signal.token.chain,
        signal.amount.toString(), result.txHash || ''
      );

      // Dashboard
      this.dashboardServer.sendNewTrade({
        action: 'buy',
        token: signal.token.address,
        chain: signal.token.chain,
        amount: signal.amount,
        tx: result.txHash,
      });
    }
  }

  /**
   * Execute sell
   */
  private async executeSell(position: Position, reason: 'stop' | 'takeprofit' | 'manual'): Promise<void> {
    let result;

    if (config.isPaperTrading) {
      result = this.paperEngine.simulateSell(position.token.address, position.currentPrice);
    } else {
      switch (position.chain) {
        case 'solana':
          result = await this.solanaSniper.emergencySell(
            position.token.address, position.token.poolAddress, position.amount
          );
          break;
        case 'base':
        case 'bnb':
          result = await this.evmSniper.emergencySell(position.token.address, position.chain as 'base' | 'bnb');
          break;
        case 'sui':
          result = await this.suiSniper.emergencySell(position.token);
          break;
        case 'hyperliquid':
          result = await this.hyperliquidSniper.emergencySell(position.token.symbol || position.token.address);
          break;
        default:
          return;
      }
    }

    if (result.success) {
      const closed = this.positionManager.closePosition(position.token.address, position.currentPrice, reason);
      this.mempoolMonitor.unwatchPosition(position.token.address);
      this.priceFeed.unwatchToken(position.token.address, position.chain);

      if (closed) {
        // Record in DB
        this.database.addTrade({
          id: `trade_${Date.now()}`,
          tokenAddress: position.token.address,
          chain: position.chain,
          action: reason === 'stop' ? 'sell' : 'sell',
          amount: position.amount,
          price: position.currentPrice,
          txHash: result.txHash || '',
          timestamp: Date.now(),
          pnl: closed.pnl,
          pnlPercent: closed.pnlPercent,
          fees: result.gasUsed || 0,
        });

        const holdTime = this.formatHoldTime(Date.now() - closed.entryTime);
        await this.telegramBot.notifyPnl(position.token.address, closed.pnlPercent, holdTime, closed.pnl > 0);

        this.dashboardServer.sendPnlUpdate({
          token: position.token.address,
          pnl: closed.pnlPercent,
          reason,
        });
      }
    }
  }

  /**
   * Handle rug detection → emergency exit
   */
  private async handleRugDetected(data: {
    chain: Chain; tokenAddress: string; type: string; txHash: string; deployer: string;
  }): Promise<void> {
    logger.warn(i18n.t('antiRug', 'rugDetected', { token: data.tokenAddress.slice(0, 12) + '...' }));

    const position = this.positionManager.getPosition(data.tokenAddress);
    if (!position) return;

    // Auto-blacklist
    this.blacklist.autoBlacklistOnRug(data.tokenAddress, data.deployer, data.chain);

    let result;
    if (config.isPaperTrading) {
      result = this.paperEngine.simulateSell(data.tokenAddress);
    } else {
      switch (data.chain) {
        case 'solana':
          result = await this.solanaSniper.emergencySell(data.tokenAddress, position.token.poolAddress, position.amount);
          break;
        case 'base':
        case 'bnb':
          result = await this.evmSniper.emergencySell(data.tokenAddress, data.chain as 'base' | 'bnb');
          break;
        case 'sui':
          result = await this.suiSniper.emergencySell(position.token);
          break;
        default:
          return;
      }
    }

    if (result.success) {
      this.positionManager.closePosition(data.tokenAddress, position.currentPrice, 'emergency');
      this.mempoolMonitor.unwatchPosition(data.tokenAddress);
      this.priceFeed.unwatchToken(data.tokenAddress, data.chain);
      await this.telegramBot.notifyRugAlert(data.tokenAddress, position.amount.toString());
      this.dashboardServer.sendRugAlert(data);
    }
  }

  /**
   * Price feed loop: updates positions every second
   */
  private setupPriceFeedLoop(): void {
    this.priceFeed.on('price:updated', (priceData) => {
      this.positionManager.updatePrice(priceData.token, priceData.priceUsd);

      if (config.isPaperTrading) {
        this.paperEngine.updatePrice(priceData.token, priceData.priceUsd);
      }
    });
  }

  /**
   * Health endpoint provider
   */
  private setupHealthProvider(): void {
    this.healthServer.setStatusProvider(() => {
      const stats = this.positionManager.getDailyStats();
      const scannerStatus = this.scanner.getStatus();
      const mem = process.memoryUsage();

      return {
        status: this.isPaused ? 'degraded' : 'healthy',
        uptime: Date.now() - this.startTime,
        version: '2.0.0',
        mode: config.tradingMode,
        scanners: scannerStatus,
        positions: this.positionManager.getOpenPositions().length,
        dailyPnl: stats.pnl,
        memoryMb: Math.round(mem.heapUsed / 1024 / 1024),
        lastActivity: Date.now(),
      };
    });
  }

  /**
   * Telegram command callbacks
   */
  private setupTelegramCallbacks(): void {
    this.telegramBot.onPause = () => { this.isPaused = true; };
    this.telegramBot.onResume = () => { this.isPaused = false; };
    this.telegramBot.onGetStatus = () => {
      const stats = this.positionManager.getDailyStats();
      return { positions: this.positionManager.getOpenPositions().length, pnl: stats.pnl, winRate: stats.winRate };
    };
    this.telegramBot.onGetPositions = () => this.positionManager.getOpenPositions();
  }

  private getBuyAmount(chain: Chain): number {
    const map: Record<Chain, number> = {
      solana: config.risk.maxBuyAmountSol,
      base: config.risk.maxBuyAmountEth,
      bnb: config.risk.maxBuyAmountEth,
      sui: config.risk.maxBuyAmountSui,
      hyperliquid: config.risk.maxBuyAmountEth,
    };
    return map[chain] || 0.1;
  }

  private formatHoldTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info(i18n.t('system', 'shutdown'));
    this.isPaused = true;

    await Promise.allSettled([
      this.scanner.stopAll(),
      this.mempoolMonitor.stop(),
      this.telegramBot.stop(),
    ]);

    this.positionManager.stop();
    this.queue.stop();
    this.priceFeed.stop();
    this.rateLimiter.stop();
    this.processedTokens.destroy();
    this.healthServer.stop();
    this.dashboardServer.stop();
    this.database.close();

    if (config.isPaperTrading) this.paperEngine.stop();

    logger.info(i18n.t('system', 'info', { message: 'Shutdown complete' }));
    process.exit(0);
  }
}

// ============================================
// Entry Point
// ============================================
async function main(): Promise<void> {
  const bot = new TradSniperBot();

  process.on('SIGINT', () => bot.shutdown());
  process.on('SIGTERM', () => bot.shutdown());
  process.on('uncaughtException', (err) => {
    logger.error(i18n.t('system', 'error', { message: `Uncaught: ${err.message}` }));
    bot.shutdown();
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(i18n.t('system', 'error', { message: `Unhandled: ${reason}` }));
  });

  await bot.start();
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
