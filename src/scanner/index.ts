/**
 * ============================================
 * Scanner Orchestrator - Multi-Chain Discovery
 * منسق المسح - اكتشاف متعدد السلاسل
 * ============================================
 * 
 * Manages all chain-specific scanners and provides a unified
 * event stream of newly discovered tokens.
 */

import EventEmitter from 'eventemitter3';
import { SolanaScanner } from './solana-scanner';
import { EVMScanner } from './evm-scanner';
import { SuiScanner } from './sui-scanner';
import { BaseScanner } from './base-scanner';
import { TokenInfo, Chain } from '../utils/types';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';

interface ScannerOrchestratorEvents {
  'token:discovered': (token: TokenInfo) => void;
  'all:connected': () => void;
}

export class ScannerOrchestrator extends EventEmitter<ScannerOrchestratorEvents> {
  private scanners: Map<Chain, BaseScanner> = new Map();
  private enabledChains: Set<Chain>;

  constructor(chains: Chain[] = ['solana', 'base', 'sui', 'bnb']) {
    super();
    this.enabledChains = new Set(chains);
    this.initializeScanners();
  }

  /**
   * Initialize all enabled chain scanners
   * تهيئة جميع ماسحات السلاسل المفعّلة
   */
  private initializeScanners(): void {
    if (this.enabledChains.has('solana')) {
      this.scanners.set('solana', new SolanaScanner());
    }

    if (this.enabledChains.has('base')) {
      this.scanners.set('base', new EVMScanner('base'));
    }

    if (this.enabledChains.has('bnb')) {
      this.scanners.set('bnb', new EVMScanner('bnb'));
    }

    if (this.enabledChains.has('sui')) {
      this.scanners.set('sui', new SuiScanner());
    }

    // Wire up events from all scanners to unified stream
    for (const [chain, scanner] of this.scanners) {
      scanner.on('token:discovered', (token: TokenInfo) => {
        this.emit('token:discovered', token);
      });

      scanner.on('scanner:error', (error: Error, chain: Chain) => {
        logger.error(i18n.t('system', 'error', { 
          message: `Scanner error on ${chain}: ${error.message}` 
        }));
      });
    }
  }

  /**
   * Start all scanners
   * بدء جميع الماسحات
   */
  async startAll(): Promise<void> {
    const startPromises: Promise<void>[] = [];

    for (const [chain, scanner] of this.scanners) {
      startPromises.push(
        scanner.start().catch(error => {
          logger.error(i18n.t('system', 'error', { 
            message: `Failed to start ${chain} scanner: ${error}` 
          }));
        })
      );
    }

    await Promise.allSettled(startPromises);
    
    const runningCount = Array.from(this.scanners.values()).filter(s => s.getIsRunning()).length;
    logger.info(i18n.t('system', 'info', { 
      message: `${runningCount}/${this.scanners.size} scanners active` 
    }));

    if (runningCount === this.scanners.size) {
      this.emit('all:connected');
    }
  }

  /**
   * Stop all scanners
   * إيقاف جميع الماسحات
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const scanner of this.scanners.values()) {
      stopPromises.push(scanner.stop());
    }

    await Promise.allSettled(stopPromises);
    logger.info(i18n.t('system', 'info', { message: 'All scanners stopped' }));
  }

  /**
   * Get status of all scanners
   */
  getStatus(): Record<Chain, boolean> {
    const status: Partial<Record<Chain, boolean>> = {};
    for (const [chain, scanner] of this.scanners) {
      status[chain] = scanner.getIsRunning();
    }
    return status as Record<Chain, boolean>;
  }
}

export { SolanaScanner, EVMScanner, SuiScanner, BaseScanner };
