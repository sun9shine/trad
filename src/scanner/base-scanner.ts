/**
 * ============================================
 * Base Scanner - Abstract Event-Driven Scanner
 * الماسح الأساسي - ماسح أحداث مجرد
 * ============================================
 * 
 * All chain-specific scanners extend this base class.
 * Provides common event emission, reconnection logic, and lifecycle management.
 */

import EventEmitter from 'eventemitter3';
import { TokenInfo, Chain } from '../utils/types';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';
import { TIMING } from '../utils/constants';

export interface ScannerEvents {
  'token:discovered': (token: TokenInfo) => void;
  'scanner:connected': (chain: Chain) => void;
  'scanner:disconnected': (chain: Chain) => void;
  'scanner:error': (error: Error, chain: Chain) => void;
  'block:received': (blockNumber: number, chain: Chain) => void;
}

export abstract class BaseScanner extends EventEmitter<ScannerEvents> {
  protected chain: Chain;
  protected isRunning: boolean = false;
  protected reconnectAttempts: number = 0;
  protected maxReconnectAttempts: number = TIMING.MAX_RECONNECT_ATTEMPTS;

  constructor(chain: Chain) {
    super();
    this.chain = chain;
  }

  /**
   * Start scanning for new pools/tokens
   * بدء المسح للبحث عن تجمعات/عملات جديدة
   */
  abstract start(): Promise<void>;

  /**
   * Stop the scanner gracefully
   * إيقاف الماسح بأمان
   */
  abstract stop(): Promise<void>;

  /**
   * Reconnect to the data source
   * إعادة الاتصال بمصدر البيانات
   */
  protected async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const errMsg = `Max reconnection attempts reached for ${this.chain}`;
      logger.error(i18n.t('system', 'error', { message: errMsg }));
      this.emit('scanner:error', new Error(errMsg), this.chain);
      return;
    }

    this.reconnectAttempts++;
    logger.warn(i18n.t('system', 'reconnecting', { chain: this.chain }));

    await this.delay(TIMING.RECONNECT_DELAY_MS * this.reconnectAttempts);

    try {
      await this.stop();
      await this.start();
      this.reconnectAttempts = 0; // Reset on successful reconnection
    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Reconnect attempt ${this.reconnectAttempts} failed: ${error}` 
      }));
      await this.reconnect();
    }
  }

  /**
   * Emit a discovered token event
   * إرسال حدث اكتشاف عملة
   */
  protected emitTokenDiscovered(token: TokenInfo): void {
    logger.info(i18n.t('scanner', 'newPoolDetected', {
      chain: this.chain,
      dex: token.dex,
      token: token.address,
    }));
    this.emit('token:discovered', token);
  }

  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getChain(): Chain {
    return this.chain;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }
}
