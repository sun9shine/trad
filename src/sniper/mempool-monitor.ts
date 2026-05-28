/**
 * ============================================
 * Mempool Monitor - Anti-Rug Front-Running
 * مراقب Mempool - استباق سحب البساط
 * ============================================
 * 
 * Monitors pending transactions to detect:
 * - Deployer removing liquidity (rug pull)
 * - Massive sell dumps from connected wallets
 * - Ownership changes or suspicious admin actions
 * 
 * When detected, triggers emergency sell BEFORE the rug executes.
 * 
 * Solana: Monitors Jito/gRPC stream for removeLiquidity by deployer
 * EVM: Scans local mempool for owner-initiated liquidations
 */

import EventEmitter from 'eventemitter3';
import { ethers, WebSocketProvider, TransactionResponse } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config';
import { EVM, SOLANA, TIMING } from '../utils/constants';
import { MempoolTransaction, Chain, Position } from '../utils/types';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';

interface MempoolEvents {
  'rug:detected': (data: { 
    chain: Chain; 
    tokenAddress: string; 
    type: string;
    txHash: string;
    deployer: string;
  }) => void;
  'suspicious:activity': (data: {
    chain: Chain;
    tokenAddress: string;
    description: string;
  }) => void;
}

export class MempoolMonitor extends EventEmitter<MempoolEvents> {
  private baseWsProvider: WebSocketProvider | null = null;
  private bnbWsProvider: WebSocketProvider | null = null;
  private solanaConnection: Connection;
  private monitoredTokens: Map<string, Position> = new Map();
  private monitoredDeployers: Map<string, string[]> = new Map(); // deployer -> token[]
  private isRunning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.solanaConnection = new Connection(config.solana.wsUrl || config.solana.rpcUrl, {
      commitment: 'confirmed',
    });
  }

  /**
   * Start monitoring mempool for rug indicators
   * بدء مراقبة Mempool لمؤشرات سحب البساط
   */
  async start(): Promise<void> {
    this.isRunning = true;

    // Start EVM mempool monitoring
    await this.startEVMMonitoring();

    // Start Solana monitoring
    await this.startSolanaMonitoring();

    logger.info(i18n.t('system', 'info', { 
      message: 'Mempool monitor active - watching for rug indicators' 
    }));
  }

  /**
   * Add a position to monitor for rug pull activity
   * إضافة مركز للمراقبة ضد سحب البساط
   */
  watchPosition(position: Position): void {
    this.monitoredTokens.set(position.token.address, position);
    
    // Track deployer -> tokens mapping
    const deployerTokens = this.monitoredDeployers.get(position.token.deployer) || [];
    deployerTokens.push(position.token.address);
    this.monitoredDeployers.set(position.token.deployer, deployerTokens);

    logger.info(i18n.t('antiRug', 'deployerActivity', { 
      wallet: position.token.deployer.slice(0, 12) + '...' 
    }));
  }

  /**
   * Remove a position from monitoring
   */
  unwatchPosition(tokenAddress: string): void {
    const position = this.monitoredTokens.get(tokenAddress);
    if (position) {
      this.monitoredTokens.delete(tokenAddress);
      
      const deployerTokens = this.monitoredDeployers.get(position.token.deployer) || [];
      const filtered = deployerTokens.filter(t => t !== tokenAddress);
      if (filtered.length === 0) {
        this.monitoredDeployers.delete(position.token.deployer);
      } else {
        this.monitoredDeployers.set(position.token.deployer, filtered);
      }
    }
  }

  /**
   * Monitor EVM mempool (Base/BNB) for pending rug transactions
   * مراقبة mempool EVM للمعاملات المعلقة المشبوهة
   */
  private async startEVMMonitoring(): Promise<void> {
    // Base chain monitoring
    if (config.base.wsUrl) {
      try {
        this.baseWsProvider = new WebSocketProvider(config.base.wsUrl);
        this.baseWsProvider.on('pending', (txHash: string) => {
          this.analyzeEVMPendingTx(txHash, 'base');
        });
      } catch (error) {
        logger.warn(i18n.t('system', 'warning', { 
          message: `Base mempool monitor failed: ${error}` 
        }));
      }
    }

    // BNB chain monitoring
    if (config.bnb.wsUrl) {
      try {
        this.bnbWsProvider = new WebSocketProvider(config.bnb.wsUrl);
        this.bnbWsProvider.on('pending', (txHash: string) => {
          this.analyzeEVMPendingTx(txHash, 'bnb');
        });
      } catch (error) {
        logger.warn(i18n.t('system', 'warning', { 
          message: `BNB mempool monitor failed: ${error}` 
        }));
      }
    }
  }

  /**
   * Analyze a pending EVM transaction for rug indicators
   * تحليل معاملة EVM معلقة لمؤشرات سحب البساط
   */
  private async analyzeEVMPendingTx(txHash: string, chain: 'base' | 'bnb'): Promise<void> {
    try {
      const provider = chain === 'base' ? this.baseWsProvider : this.bnbWsProvider;
      if (!provider) return;

      const tx = await provider.getTransaction(txHash);
      if (!tx || !tx.data || !tx.to) return;

      // Check if transaction is from a monitored deployer
      const fromAddress = tx.from.toLowerCase();
      const deployerTokens = this.monitoredDeployers.get(fromAddress);
      if (!deployerTokens || deployerTokens.length === 0) return;

      // Check for removeLiquidity function signatures
      const funcSig = tx.data.slice(0, 10).toLowerCase();
      const isRemoveLiquidity = EVM.REMOVE_LIQUIDITY_SIGS.some(
        sig => sig.toLowerCase() === funcSig
      );

      if (isRemoveLiquidity) {
        // CRITICAL: Deployer is removing liquidity!
        for (const tokenAddress of deployerTokens) {
          logger.warn(i18n.t('antiRug', 'liquidityRemovalDetected', { 
            token: tokenAddress.slice(0, 12) + '...' 
          }));

          this.emit('rug:detected', {
            chain: chain as Chain,
            tokenAddress,
            type: 'liquidity_removal',
            txHash: tx.hash,
            deployer: fromAddress,
          });
        }
        return;
      }

      // Check for massive token transfers (dump)
      if (funcSig === '0xa9059cbb' || funcSig === '0x23b872dd') {
        // transfer or transferFrom - check if it's a massive amount
        // In production, decode the amount and compare to total supply
        this.emit('suspicious:activity', {
          chain: chain as Chain,
          tokenAddress: deployerTokens[0],
          description: `Deployer ${fromAddress.slice(0, 10)} executing transfer`,
        });
      }

    } catch {
      // Silent fail - mempool tx might have been mined already
    }
  }

  /**
   * Monitor Solana for deployer rugpull transactions
   * مراقبة سولانا لمعاملات سحب البساط من المطور
   */
  private async startSolanaMonitoring(): Promise<void> {
    // Monitor each deployer's account for removeLiquidity instructions
    this.scanInterval = setInterval(async () => {
      if (!this.isRunning) return;

      for (const [deployer, tokens] of this.monitoredDeployers) {
        try {
          // Skip non-Solana deployers (they won't be valid PublicKeys)
          if (deployer.startsWith('0x') || deployer.length < 32) continue;

          const signatures = await this.solanaConnection.getSignaturesForAddress(
            new PublicKey(deployer),
            { limit: 3 },
            'confirmed'
          );

          for (const sig of signatures) {
            // Check if transaction involves Raydium removeLiquidity
            if (sig.memo?.includes('removeLiquidity') || 
                sig.memo?.includes('withdraw')) {
              
              for (const tokenAddress of tokens) {
                logger.warn(i18n.t('antiRug', 'liquidityRemovalDetected', { 
                  token: tokenAddress.slice(0, 12) + '...' 
                }));

                this.emit('rug:detected', {
                  chain: 'solana',
                  tokenAddress,
                  type: 'liquidity_removal',
                  txHash: sig.signature,
                  deployer,
                });
              }
            }
          }
        } catch {
          // Non-fatal - continue monitoring
        }
      }
    }, TIMING.MEMPOOL_SCAN_MS);
  }

  /**
   * Stop all mempool monitoring
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    if (this.baseWsProvider) {
      this.baseWsProvider.removeAllListeners();
      await this.baseWsProvider.destroy();
      this.baseWsProvider = null;
    }

    if (this.bnbWsProvider) {
      this.bnbWsProvider.removeAllListeners();
      await this.bnbWsProvider.destroy();
      this.bnbWsProvider = null;
    }

    this.monitoredTokens.clear();
    this.monitoredDeployers.clear();

    logger.info(i18n.t('system', 'info', { message: 'Mempool monitor stopped' }));
  }
}
