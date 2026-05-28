/**
 * ============================================
 * Telegram Bot Interface - Bilingual Notifications
 * واجهة بوت تيليجرام - إشعارات ثنائية اللغة
 * ============================================
 * 
 * Provides:
 * - Real-time trade notifications
 * - Rug pull alerts
 * - Position management commands
 * - Status reports and PnL summaries
 */

import { Telegraf, Context } from 'telegraf';
import { config } from '../config';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';
import { Position, Chain } from '../utils/types';

export class TelegramBot {
  private bot: Telegraf | null = null;
  private chatId: string;
  private isActive: boolean = false;

  // Callbacks for command handlers
  public onPause?: () => void;
  public onResume?: () => void;
  public onGetStatus?: () => { positions: number; pnl: number; winRate: number };
  public onGetPositions?: () => Position[];
  public onLanguageToggle?: () => void;

  constructor() {
    this.chatId = config.telegram.chatId;
  }

  /**
   * Initialize and start the Telegram bot
   * تهيئة وبدء بوت تيليجرام
   */
  async start(): Promise<void> {
    if (!config.telegram.botToken) {
      logger.warn(i18n.t('system', 'warning', { 
        message: 'No Telegram bot token - notifications disabled' 
      }));
      return;
    }

    try {
      this.bot = new Telegraf(config.telegram.botToken);
      this.registerCommands();
      
      // Start polling (non-blocking)
      this.bot.launch().catch(err => {
        logger.error(i18n.t('system', 'error', { 
          message: `Telegram bot error: ${err.message}` 
        }));
      });

      this.isActive = true;

      // Send startup notification
      await this.sendMessage(i18n.t('telegram', 'botStarted', {
        mode: config.tradingMode,
        chains: 'SOL, BASE, SUI, BNB',
      }));

      logger.info(i18n.t('system', 'info', { message: 'Telegram bot started' }));
    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Failed to start Telegram bot: ${error}` 
      }));
    }
  }

  /**
   * Register bot commands
   * تسجيل أوامر البوت
   */
  private registerCommands(): void {
    if (!this.bot) return;

    this.bot.command('start', (ctx) => {
      ctx.reply(i18n.t('telegram', 'commandHelp'));
    });

    this.bot.command('help', (ctx) => {
      ctx.reply(i18n.t('telegram', 'commandHelp'));
    });

    this.bot.command('status', (ctx) => {
      if (this.onGetStatus) {
        const status = this.onGetStatus();
        ctx.reply(i18n.t('telegram', 'statusReport', {
          positions: status.positions.toString(),
          pnl: status.pnl.toFixed(4),
          winRate: status.winRate.toFixed(1),
        }));
      }
    });

    this.bot.command('positions', (ctx) => {
      if (this.onGetPositions) {
        const positions = this.onGetPositions();
        if (positions.length === 0) {
          ctx.reply('📭 No active positions');
          return;
        }
        
        let msg = '📊 Active Positions:\n\n';
        for (const pos of positions) {
          const symbol = pos.token.symbol || pos.token.address.slice(0, 8);
          const pnlEmoji = pos.pnlPercent >= 0 ? '🟢' : '🔴';
          msg += `${pnlEmoji} ${symbol} (${pos.chain})\n`;
          msg += `   Entry: ${pos.entryPrice.toFixed(8)}\n`;
          msg += `   Current: ${pos.currentPrice.toFixed(8)}\n`;
          msg += `   PnL: ${pos.pnlPercent >= 0 ? '+' : ''}${pos.pnlPercent.toFixed(2)}%\n`;
          msg += `   Stop: ${pos.stopLoss.toFixed(8)}\n\n`;
        }
        ctx.reply(msg);
      }
    });

    this.bot.command('pnl', (ctx) => {
      if (this.onGetStatus) {
        const status = this.onGetStatus();
        ctx.reply(i18n.t('risk', 'pnlReport', {
          pnl: status.pnl.toFixed(4),
          winRate: status.winRate.toFixed(1),
          trades: status.positions.toString(),
        }));
      }
    });

    this.bot.command('pause', (ctx) => {
      if (this.onPause) {
        this.onPause();
        ctx.reply('⏸️ Bot paused - scanning stopped');
      }
    });

    this.bot.command('resume', (ctx) => {
      if (this.onResume) {
        this.onResume();
        ctx.reply('▶️ Bot resumed - scanning active');
      }
    });

    this.bot.command('lang', (ctx) => {
      const currentLang = i18n.getLocale();
      const newLang = currentLang === 'en' ? 'ar' : 'en';
      i18n.setLocale(newLang);
      ctx.reply(`🌐 Language switched to: ${newLang === 'en' ? 'English' : 'العربية'}`);
    });
  }

  /**
   * Send notification for a new snipe
   * إرسال إشعار لقنص جديد
   */
  async notifySnipe(tokenAddress: string, chain: Chain, amount: string, txHash: string): Promise<void> {
    await this.sendMessage(i18n.t('telegram', 'newSnipe', {
      token: tokenAddress.slice(0, 16) + '...',
      chain,
      amount,
      tx: this.formatTxLink(txHash, chain),
    }));
  }

  /**
   * Send rug pull alert
   * إرسال تنبيه سحب بساط
   */
  async notifyRugAlert(tokenAddress: string, savedAmount: string): Promise<void> {
    await this.sendMessage(i18n.t('telegram', 'rugAlert', {
      token: tokenAddress.slice(0, 16) + '...',
      amount: savedAmount,
    }));
  }

  /**
   * Send profit/loss notification
   * إرسال إشعار ربح/خسارة
   */
  async notifyPnl(tokenAddress: string, pnl: number, holdTime: string, isProfit: boolean): Promise<void> {
    if (isProfit) {
      await this.sendMessage(i18n.t('telegram', 'profitAlert', {
        token: tokenAddress.slice(0, 16) + '...',
        pnl: pnl.toFixed(2) + '%',
        time: holdTime,
      }));
    } else {
      await this.sendMessage(i18n.t('telegram', 'lossAlert', {
        token: tokenAddress.slice(0, 16) + '...',
        pnl: pnl.toFixed(2) + '%',
        reason: 'Stop loss triggered',
      }));
    }
  }

  /**
   * Send a message to the configured chat
   */
  private async sendMessage(text: string): Promise<void> {
    if (!this.bot || !this.chatId || !this.isActive) return;

    try {
      await this.bot.telegram.sendMessage(this.chatId, text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Failed to send Telegram message: ${error}` 
      }));
    }
  }

  /**
   * Format transaction hash as explorer link
   */
  private formatTxLink(txHash: string, chain: Chain): string {
    const explorers: Record<Chain, string> = {
      solana: `https://solscan.io/tx/${txHash}`,
      base: `https://basescan.org/tx/${txHash}`,
      bnb: `https://bscscan.com/tx/${txHash}`,
      sui: `https://suiscan.xyz/mainnet/tx/${txHash}`,
      hyperliquid: txHash,
    };
    return explorers[chain] || txHash;
  }

  /**
   * Stop the Telegram bot
   */
  async stop(): Promise<void> {
    if (this.bot) {
      this.bot.stop('SIGTERM');
      this.isActive = false;
    }
  }
}
