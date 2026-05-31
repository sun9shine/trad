/**
 * ============================================
 * Virtuals.io Scanner - Base Chain AI Agents
 * ماسح Virtuals.io - وكلاء AI على Base
 * ============================================
 * 
 * Monitors Virtuals Protocol on Base for:
 * - New AI agent token launches
 * - Virtual agent bonding curve graduations
 * - Liquidity additions to Uniswap/Aerodrome
 * 
 * Virtuals.io creates AI agent tokens that graduate
 * from a bonding curve to DEX liquidity pools.
 */

import { ethers, WebSocketProvider, Contract } from 'ethers';
import { BaseScanner } from './base-scanner';
import { TokenInfo, Chain } from '../utils/types';
import { config } from '../config';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';

// Virtuals Protocol contract addresses on Base
const VIRTUALS_CONTRACTS = {
  FACTORY: '0x19fD04bBD79Db92A542386ae6858C34BdCC4e0D6',
  BONDING_CURVE: '0x3C8665472ec5aF30981B06B4E0143663Eb8C5425',
  TOKEN_DEPLOYER: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
};

// Events emitted by Virtuals contracts
const VIRTUALS_ABI = [
  'event AgentTokenCreated(address indexed token, address indexed creator, string name, string symbol, uint256 supply)',
  'event TokenGraduated(address indexed token, address indexed pool, uint256 liquidity)',
  'event BondingCurveComplete(address indexed token, uint256 raisedAmount)',
];

export class VirtualsScanner extends BaseScanner {
  private provider: WebSocketProvider | null = null;
  private contracts: Contract[] = [];

  constructor() {
    super('base');
  }

  /**
   * Start monitoring Virtuals.io on Base
   * بدء مراقبة Virtuals.io على Base
   */
  async start(): Promise<void> {
    this.isRunning = true;

    if (!config.base.wsUrl) {
      logger.warn(i18n.t('system', 'warning', {
        message: 'No Base WS URL - Virtuals scanner disabled',
      }));
      return;
    }

    logger.info(i18n.t('scanner', 'listeningChain', {
      chain: 'Base (Virtuals.io)',
      method: 'WebSocket Events',
    }));

    try {
      this.provider = new WebSocketProvider(config.base.wsUrl);

      // Monitor Factory for new agent tokens
      const factoryContract = new Contract(
        VIRTUALS_CONTRACTS.FACTORY,
        VIRTUALS_ABI,
        this.provider
      );
      this.contracts.push(factoryContract);

      factoryContract.on('AgentTokenCreated', (
        token: string,
        creator: string,
        name: string,
        symbol: string,
        supply: bigint,
        event: any
      ) => {
        this.handleNewAgentToken(token, creator, name, symbol, supply, event);
      });

      // Monitor Bonding Curve for graduations (token moves to DEX)
      const bondingContract = new Contract(
        VIRTUALS_CONTRACTS.BONDING_CURVE,
        VIRTUALS_ABI,
        this.provider
      );
      this.contracts.push(bondingContract);

      bondingContract.on('TokenGraduated', (
        token: string,
        pool: string,
        liquidity: bigint,
        event: any
      ) => {
        this.handleTokenGraduation(token, pool, liquidity, event);
      });

      this.emit('scanner:connected', 'base');
      logger.info(i18n.t('system', 'connected', { chain: 'Virtuals.io (Base)' }));
    } catch (error) {
      logger.error(i18n.t('system', 'error', {
        message: `Virtuals scanner failed: ${error}`,
      }));
    }
  }

  /**
   * Handle new AI agent token creation
   * معالجة إنشاء عملة وكيل AI جديدة
   */
  private handleNewAgentToken(
    tokenAddress: string,
    creator: string,
    name: string,
    symbol: string,
    supply: bigint,
    event: any
  ): void {
    logger.info(i18n.t('scanner', 'newPoolDetected', {
      chain: 'Base',
      dex: 'Virtuals.io',
      token: `${symbol} (${tokenAddress.slice(0, 10)}...)`,
    }));

    // Note: Don't emit yet - wait for graduation to DEX
    // Tokens on bonding curve are not tradeable on DEX
    logger.info(i18n.t('system', 'info', {
      message: `New Virtuals agent: ${name} (${symbol}) - watching for graduation`,
    }));
  }

  /**
   * Handle token graduation (bonding curve → DEX pool)
   * This is the KEY snipe moment for Virtuals tokens
   * معالجة تخرج العملة (منحنى الترابط → تجمع DEX)
   */
  private handleTokenGraduation(
    tokenAddress: string,
    poolAddress: string,
    liquidity: bigint,
    event: any
  ): void {
    const token: TokenInfo = {
      address: tokenAddress,
      chain: 'base',
      dex: 'virtuals',
      decimals: 18,
      deployer: '', // Resolve from contract creator
      poolAddress,
      pairToken: '0x4200000000000000000000000000000000000006', // WETH
      liquidity: Number(liquidity) / 1e18, // Rough USD estimate
      createdAt: Date.now(),
      blockNumber: event?.log?.blockNumber,
      txHash: event?.log?.transactionHash || '',
    };

    // Graduated tokens are the prime snipe targets
    this.emitTokenDiscovered(token);
  }

  /**
   * Stop all subscriptions
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    for (const contract of this.contracts) {
      contract.removeAllListeners();
    }
    this.contracts = [];

    if (this.provider) {
      this.provider.removeAllListeners();
      await this.provider.destroy();
      this.provider = null;
    }
  }
}
