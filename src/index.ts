/**
 * ============================================
 * TRAD SNIPER BOT - Main Orchestrator
 * بوت تراد القناص - المنسق الرئيسي
 * ============================================
 * 
 * System Architecture:
 * 
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │                      MAIN ORCHESTRATOR                          │
 *   │                    (Event-Driven Pipeline)                       │
 *   └───────┬────────────────────┬────────────────────┬───────────────┘
 *           │                    │                    │
 *   ┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
 *   │   SCANNER     │   │   SECURITY    │   │   TELEGRAM    │
 *   │ (Discovery)   │   │   (Auditor)   │   │   (Notify)    │
 *   │               │   │               │   │               │
 *   │ • Solana gRPC │   │ • Mint Check  │   │ • Alerts      │
 *   │ • Base WS     │   │ • LP Lock     │   │ • Commands    │
 *   │ • Sui Events  │   │ • Honeypot    │   │ • Reports     │
 *   │ • BNB WS      │   │ • Holders     │   │               │
 *   └───────┬───────┘   └───────┬───────┘   └───────────────┘
 *           │                    │
 *           ▼                    ▼
 *   ┌─────────────────────────────────────────┐
 *   │             EXECUTION ENGINE             │
 *   │                                         │
 *   │  ┌──────────┐  ┌──────────┐  ┌───────┐│
 *   │  │ Solana   │  │  EVM     │  │Mempool││
 *   │  │ Sniper   │  │  Sniper  │  │Monitor││
 *   │  │(Jito)    │  │(Flashbot)│  │(AntiRug)│
 *   │  └──────────┘  └──────────┘  └───────┘│
 *   └───────────────────┬─────────────────────┘
 *                       │
 *                       ▼
 *   ┌─────────────────────────────────────────┐
 *   │          RISK MANAGEMENT                 │
 *   │                                         │
 *   │  • Position Manager (Trailing Stop)     │
 *   │  • Paper Trading (Simulation)           │
 *   │  • Daily Limits & PnL Tracking          │
 *   └─────────────────────────────────────────┘
 * 
 * Data Flow:
 *   RPC/gRPC → Scanner → Auditor → Sniper → Position Manager
 *                                      ↕
 *                              Mempool Monitor (Anti-Rug)
 */

import { config } from './config';
import { i18n } from './i18n';
import { logger } from './utils/logger';
import { ScannerOrchestrator } from './scanner';
import { SecurityAuditor } from './security';
import { SolanaSniper, EVMSniper, MempoolMonitor } from './sniper';
import { PositionManager, PaperTradingEngine } from './risk';
import { TelegramBot } from './telegram/bot';
import { TokenInfo, TradeSignal, Position, Chain } from './utils/types';

class TradSniperBot {
  // Core modules
  private scanner: ScannerOrchestrator;
  private auditor: SecurityAuditor;
  private solanaSniper: SolanaSniper;
  private evmSniper: EVMSniper;
  private mempoolMonitor: MempoolMonitor;
  private positionManager: PositionManager;
  private paperEngine: PaperTradingEngine;
  private telegramBot: TelegramBot;

  // State
  private isPaused: boolean = false;
  private processedTokens: Set<string> = new Set();
  private processingQueue: TokenInfo[] = [];

  constructor() {
    // Initialize all modules
    this.scanner = new ScannerOrchestrator(['solana', 'base', 'sui', 'bnb']);
    this.auditor = new SecurityAuditor();
    this.solanaSniper = new SolanaSniper();
    this.evmSniper = new EVMSniper();
    this.mempoolMonitor = new MempoolMonitor();
    this.positionManager = new PositionManager();
    this.paperEngine = new PaperTradingEngine();
    this.telegramBot = new TelegramBot();

    // Wire up event pipeline
    this.setupEventPipeline();
  }

  /**
   * Start the bot - main entry point
   * بدء البوت - نقطة الدخول الرئيسية
   */
  async start(): Promise<void> {
    logger.info(i18n.t('system', 'startup', { mode: config.tradingMode }));
    
    if (config.isPaperTrading) {
      logger.info(i18n.t('system', 'paperMode'));
    } else {
      logger.info(i18n.t('system', 'liveMode'));
    }

    try {
      // Start all modules in parallel
      await Promise.all([
        this.scanner.startAll(),
        this.mempoolMonitor.start(),
        this.telegramBot.start(),
      ]);

      // Start position monitoring
      this.positionManager.start();

      // Start paper trading engine if in paper mode
      if (config.isPaperTrading) {
        this.paperEngine.start();
      }

      // Setup Telegram callbacks
      this.setupTelegramCallbacks();

      logger.info(i18n.t('system', 'info', { 
        message: '=== TRAD SNIPER BOT FULLY OPERATIONAL ===' 
      }));

    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Failed to start bot: ${error}` 
      }));
      await this.shutdown();
    }
  }

  /**
   * Setup the event-driven pipeline connecting all modules
   * إعداد خط أنابيب الأحداث الذي يربط جميع الوحدات
   */
  private setupEventPipeline(): void {
    // === Scanner → Auditor → Sniper Pipeline ===
    this.scanner.on('token:discovered', async (token: TokenInfo) => {
      if (this.isPaused) return;
      if (this.processedTokens.has(token.address)) return;
      
      this.processedTokens.add(token.address);
      await this.processNewToken(token);
    });

    // === Mempool Monitor → Emergency Sell ===
    this.mempoolMonitor.on('rug:detected', async (data) => {
      await this.handleRugDetected(data);
    });

    // === Position Manager → Sell Triggers ===
    this.positionManager.on('stop:triggered', async (position: Position) => {
      await this.executeSell(position, 'stop');
    });

    this.positionManager.on('takeprofit:triggered', async (position: Position) => {
      await this.executeSell(position, 'takeprofit');
    });
  }

  /**
   * Process a newly discovered token through the pipeline
   * معالجة عملة مكتشفة حديثاً عبر خط الأنابيب
   */
  private async processNewToken(token: TokenInfo): Promise<void> {
    try {
      // Step 1: Quick pre-filter
      if (!this.auditor.quickFilter(token)) {
        logger.info(i18n.t('scanner', 'tokenRejected', { 
          token: token.address.slice(0, 12), 
          reason: 'Failed pre-filter' 
        }));
        return;
      }

      // Step 2: Full security audit (target: <5ms)
      const auditResult = await this.auditor.audit(token);

      if (!auditResult.passed) {
        logger.info(i18n.t('scanner', 'tokenRejected', { 
          token: token.address.slice(0, 12), 
          reason: auditResult.failReasons.join('; ') 
        }));
        return;
      }

      // Step 3: Token approved - prepare trade signal
      logger.info(i18n.t('scanner', 'tokenApproved', { 
        token: token.address.slice(0, 12) 
      }));

      const signal: TradeSignal = {
        token,
        audit: auditResult,
        action: 'buy',
        amount: this.getBuyAmount(token.chain),
        maxSlippage: config.risk.maxSlippagePercent,
        priority: 'high',
        timestamp: Date.now(),
      };

      // Step 4: Check daily limits
      if (this.positionManager.isDailyLimitReached()) {
        logger.warn(i18n.t('risk', 'dailyLimitReached'));
        return;
      }

      // Step 5: Execute trade (paper or live)
      await this.executeBuy(signal);

    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Pipeline error for ${token.address.slice(0, 12)}: ${error}` 
      }));
    }
  }

  /**
   * Execute a buy trade
   * تنفيذ صفقة شراء
   */
  private async executeBuy(signal: TradeSignal): Promise<void> {
    let result;

    if (config.isPaperTrading) {
      // Paper trading simulation
      result = this.paperEngine.simulateBuy(signal);
    } else {
      // Live execution
      switch (signal.token.chain) {
        case 'solana':
          result = await this.solanaSniper.snipeBuy(signal);
          break;
        case 'base':
        case 'bnb':
          result = await this.evmSniper.snipeBuy(signal);
          break;
        default:
          logger.warn(i18n.t('system', 'warning', { 
            message: `No sniper for chain: ${signal.token.chain}` 
          }));
          return;
      }
    }

    if (result.success) {
      // Open position for tracking
      const position = this.positionManager.openPosition(
        signal.token,
        result.effectivePrice || 0,
        signal.amount,
        result.txHash || ''
      );

      // Register with mempool monitor for anti-rug
      this.mempoolMonitor.watchPosition(position);

      // Send Telegram notification
      await this.telegramBot.notifySnipe(
        signal.token.address,
        signal.token.chain,
        signal.amount.toString(),
        result.txHash || ''
      );
    }
  }

  /**
   * Execute a sell trade (stop loss / take profit / manual)
   * تنفيذ صفقة بيع
   */
  private async executeSell(position: Position, reason: 'stop' | 'takeprofit' | 'manual'): Promise<void> {
    let result;

    if (config.isPaperTrading) {
      result = this.paperEngine.simulateSell(position.token.address, position.currentPrice);
    } else {
      switch (position.chain) {
        case 'solana':
          result = await this.solanaSniper.emergencySell(
            position.token.address,
            position.token.poolAddress,
            position.amount
          );
          break;
        case 'base':
        case 'bnb':
          result = await this.evmSniper.emergencySell(
            position.token.address,
            position.chain as 'base' | 'bnb'
          );
          break;
        default:
          return;
      }
    }

    if (result.success) {
      const closedPos = this.positionManager.closePosition(
        position.token.address,
        position.currentPrice,
        reason
      );

      // Unwatch from mempool monitor
      this.mempoolMonitor.unwatchPosition(position.token.address);

      // Notify via Telegram
      if (closedPos) {
        const holdTime = this.formatHoldTime(Date.now() - closedPos.entryTime);
        await this.telegramBot.notifyPnl(
          position.token.address,
          closedPos.pnlPercent,
          holdTime,
          closedPos.pnl > 0
        );
      }
    }
  }

  /**
   * Handle detected rug pull - emergency exit
   * معالجة سحب البساط المكتشف - خروج طوارئ
   */
  private async handleRugDetected(data: { 
    chain: Chain; 
    tokenAddress: string; 
    type: string;
    txHash: string;
    deployer: string;
  }): Promise<void> {
    logger.warn(i18n.t('antiRug', 'rugDetected', { 
      token: data.tokenAddress.slice(0, 12) + '...' 
    }));

    const position = this.positionManager.getPosition(data.tokenAddress);
    if (!position) return;

    // Execute emergency sell with highest priority
    let result;

    if (config.isPaperTrading) {
      result = this.paperEngine.simulateSell(data.tokenAddress);
    } else {
      switch (data.chain) {
        case 'solana':
          result = await this.solanaSniper.emergencySell(
            data.tokenAddress,
            position.token.poolAddress,
            position.amount
          );
          break;
        case 'base':
        case 'bnb':
          result = await this.evmSniper.emergencySell(
            data.tokenAddress,
            data.chain as 'base' | 'bnb'
          );
          break;
        default:
          return;
      }
    }

    if (result.success) {
      this.positionManager.closePosition(data.tokenAddress, position.currentPrice, 'emergency');
      this.mempoolMonitor.unwatchPosition(data.tokenAddress);
      
      await this.telegramBot.notifyRugAlert(
        data.tokenAddress,
        position.amount.toString()
      );
    }
  }

  /**
   * Get buy amount based on chain
   */
  private getBuyAmount(chain: Chain): number {
    switch (chain) {
      case 'solana': return config.risk.maxBuyAmountSol;
      case 'base': return config.risk.maxBuyAmountEth;
      case 'bnb': return config.risk.maxBuyAmountEth;
      case 'sui': return config.risk.maxBuyAmountSui;
      default: return 0.1;
    }
  }

  /**
   * Setup Telegram bot command callbacks
   */
  private setupTelegramCallbacks(): void {
    this.telegramBot.onPause = () => {
      this.isPaused = true;
      logger.info(i18n.t('system', 'info', { message: 'Bot paused via Telegram' }));
    };

    this.telegramBot.onResume = () => {
      this.isPaused = false;
      logger.info(i18n.t('system', 'info', { message: 'Bot resumed via Telegram' }));
    };

    this.telegramBot.onGetStatus = () => {
      const stats = this.positionManager.getDailyStats();
      return {
        positions: this.positionManager.getOpenPositions().length,
        pnl: stats.pnl,
        winRate: stats.winRate,
      };
    };

    this.telegramBot.onGetPositions = () => {
      return this.positionManager.getOpenPositions();
    };
  }

  /**
   * Format hold time to human readable
   */
  private formatHoldTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  /**
   * Graceful shutdown
   * إيقاف آمن
   */
  async shutdown(): Promise<void> {
    logger.info(i18n.t('system', 'shutdown'));

    this.isPaused = true;

    await Promise.all([
      this.scanner.stopAll(),
      this.mempoolMonitor.stop(),
      this.telegramBot.stop(),
    ]);

    this.positionManager.stop();

    if (config.isPaperTrading) {
      this.paperEngine.stop();
    }

    logger.info(i18n.t('system', 'info', { message: 'Shutdown complete' }));
    process.exit(0);
  }
}

// ============================================
// Entry Point
// ============================================

async function main(): Promise<void> {
  const bot = new TradSniperBot();

  // Handle graceful shutdown signals
  process.on('SIGINT', () => bot.shutdown());
  process.on('SIGTERM', () => bot.shutdown());
  process.on('uncaughtException', (error) => {
    logger.error(i18n.t('system', 'error', { 
      message: `Uncaught exception: ${error.message}` 
    }));
    bot.shutdown();
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(i18n.t('system', 'error', { 
      message: `Unhandled rejection: ${reason}` 
    }));
  });

  await bot.start();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
