/**
 * ============================================
 * EVM Scanner - Base & BNB Chain WebSocket
 * ماسح EVM - سلسلة Base و BNB عبر WebSocket
 * ============================================
 * 
 * Establishes high-speed WebSocket subscription to:
 * - Parse logs for Uniswap V3 PoolCreated events
 * - Parse logs for Uniswap V2 / Aerodrome PairCreated events
 * - Monitor PancakeSwap on BNB
 * 
 * Supports both Base L2 and BNB Chain with configurable factory addresses.
 */

import { ethers, WebSocketProvider, Log, Contract } from 'ethers';
import { BaseScanner } from './base-scanner';
import { TokenInfo, Chain, DEX } from '../utils/types';
import { config } from '../config';
import { EVM } from '../utils/constants';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';

// Factory ABI fragments for event parsing
const FACTORY_V2_ABI = [
  'event PairCreated(address indexed token0, address indexed token1, address pair, uint)',
];

const FACTORY_V3_ABI = [
  'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
];

interface FactoryConfig {
  address: string;
  abi: string[];
  dex: DEX;
  version: 'v2' | 'v3';
}

export class EVMScanner extends BaseScanner {
  private provider: WebSocketProvider | null = null;
  private contracts: Contract[] = [];
  private chainType: 'base' | 'bnb';
  private factories: FactoryConfig[];

  constructor(chainType: 'base' | 'bnb' = 'base') {
    super(chainType as Chain);
    this.chainType = chainType;

    // Configure factories based on chain
    if (chainType === 'base') {
      this.factories = [
        {
          address: EVM.UNISWAP_V3_FACTORY,
          abi: FACTORY_V3_ABI,
          dex: 'uniswap_v3',
          version: 'v3',
        },
        {
          address: EVM.UNISWAP_V2_FACTORY,
          abi: FACTORY_V2_ABI,
          dex: 'uniswap_v3', // Base uses Uniswap brand for both
          version: 'v2',
        },
        {
          address: EVM.AERODROME_FACTORY,
          abi: FACTORY_V2_ABI,
          dex: 'aerodrome',
          version: 'v2',
        },
      ];
    } else {
      this.factories = [
        {
          address: EVM.PANCAKE_V3_FACTORY,
          abi: FACTORY_V3_ABI,
          dex: 'pancakeswap',
          version: 'v3',
        },
        {
          address: EVM.PANCAKE_V2_FACTORY,
          abi: FACTORY_V2_ABI,
          dex: 'pancakeswap',
          version: 'v2',
        },
      ];
    }
  }

  /**
   * Start the EVM scanner with WebSocket subscriptions
   * بدء ماسح EVM مع اشتراكات WebSocket
   */
  async start(): Promise<void> {
    this.isRunning = true;
    const wsUrl = this.chainType === 'base' ? config.base.wsUrl : config.bnb.wsUrl;

    if (!wsUrl) {
      logger.warn(i18n.t('system', 'warning', { 
        message: `No WebSocket URL configured for ${this.chainType}` 
      }));
      return;
    }

    logger.info(i18n.t('scanner', 'listeningChain', { 
      chain: this.chainType.toUpperCase(), 
      method: 'WebSocket Events' 
    }));

    try {
      this.provider = new WebSocketProvider(wsUrl);

      // Subscribe to each factory's events
      for (const factory of this.factories) {
        await this.subscribeToFactory(factory);
      }

      // Monitor new blocks for additional context
      this.provider.on('block', (blockNumber: number) => {
        this.emit('block:received', blockNumber, this.chainType as Chain);
      });

      // Handle WebSocket disconnection
      this.provider.websocket.on('close', () => {
        logger.warn(i18n.t('system', 'disconnected', { chain: this.chainType }));
        if (this.isRunning) {
          this.reconnect();
        }
      });

      this.emit('scanner:connected', this.chainType as Chain);
      logger.info(i18n.t('system', 'connected', { chain: this.chainType.toUpperCase() }));

    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `EVM Scanner start failed: ${error}` 
      }));
      throw error;
    }
  }

  /**
   * Subscribe to a specific factory contract's events
   * الاشتراك في أحداث عقد مصنع معين
   */
  private async subscribeToFactory(factory: FactoryConfig): Promise<void> {
    if (!this.provider) return;

    const contract = new Contract(factory.address, factory.abi, this.provider);
    this.contracts.push(contract);

    if (factory.version === 'v2') {
      // Listen for PairCreated events (Uniswap V2 / Aerodrome style)
      contract.on('PairCreated', (
        token0: string, 
        token1: string, 
        pair: string, 
        _pairCount: bigint,
        event: any
      ) => {
        this.handlePairCreated(token0, token1, pair, factory.dex, event);
      });
    } else {
      // Listen for PoolCreated events (Uniswap V3 / PancakeSwap V3)
      contract.on('PoolCreated', (
        token0: string, 
        token1: string, 
        fee: number,
        _tickSpacing: number, 
        pool: string,
        event: any
      ) => {
        this.handlePoolCreated(token0, token1, pool, fee, factory.dex, event);
      });
    }

    logger.info(i18n.t('system', 'info', { 
      message: `Subscribed to ${factory.dex} factory at ${factory.address.slice(0, 10)}...` 
    }));
  }

  /**
   * Handle V2-style PairCreated event
   * معالجة حدث PairCreated من النوع V2
   */
  private handlePairCreated(
    token0: string, 
    token1: string, 
    pair: string, 
    dex: DEX,
    event: any
  ): void {
    // Determine which token is the "new" one (non-native/stablecoin)
    const { newToken, quoteToken } = this.identifyNewToken(token0, token1);

    const token: TokenInfo = {
      address: newToken,
      chain: this.chainType as Chain,
      dex,
      decimals: 18, // Default, verified in audit
      deployer: '', // Will be resolved from contract deployer
      poolAddress: pair,
      pairToken: quoteToken,
      liquidity: 0, // Calculated after initial liquidity add
      createdAt: Date.now(),
      blockNumber: event?.log?.blockNumber,
      txHash: event?.log?.transactionHash || '',
    };

    // Resolve deployer asynchronously
    this.resolveDeployer(newToken).then(deployer => {
      token.deployer = deployer;
      this.emitTokenDiscovered(token);
    }).catch(() => {
      // Emit anyway even without deployer info
      this.emitTokenDiscovered(token);
    });
  }

  /**
   * Handle V3-style PoolCreated event
   * معالجة حدث PoolCreated من النوع V3
   */
  private handlePoolCreated(
    token0: string, 
    token1: string, 
    pool: string, 
    fee: number,
    dex: DEX,
    event: any
  ): void {
    const { newToken, quoteToken } = this.identifyNewToken(token0, token1);

    const token: TokenInfo = {
      address: newToken,
      chain: this.chainType as Chain,
      dex,
      decimals: 18,
      deployer: '',
      poolAddress: pool,
      pairToken: quoteToken,
      liquidity: 0,
      createdAt: Date.now(),
      blockNumber: event?.log?.blockNumber,
      txHash: event?.log?.transactionHash || '',
    };

    this.resolveDeployer(newToken).then(deployer => {
      token.deployer = deployer;
      this.emitTokenDiscovered(token);
    }).catch(() => {
      this.emitTokenDiscovered(token);
    });
  }

  /**
   * Identify which token in a pair is the newly created one
   * Known quote tokens: WETH, USDC, USDT, WBNB
   */
  private identifyNewToken(token0: string, token1: string): { newToken: string; quoteToken: string } {
    const knownQuotes = new Set([
      '0x4200000000000000000000000000000000000006', // WETH on Base
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
      '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB on BSC
      '0x55d398326f99059fF775485246999027B3197955', // USDT on BSC
      '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC on BSC
    ].map(a => a.toLowerCase()));

    if (knownQuotes.has(token0.toLowerCase())) {
      return { newToken: token1, quoteToken: token0 };
    }
    if (knownQuotes.has(token1.toLowerCase())) {
      return { newToken: token0, quoteToken: token1 };
    }

    // If neither is a known quote, assume token0 is new (sorted by address)
    return { newToken: token0, quoteToken: token1 };
  }

  /**
   * Resolve the deployer/creator of a token contract
   * حل عنوان ناشر/منشئ عقد العملة
   */
  private async resolveDeployer(tokenAddress: string): Promise<string> {
    if (!this.provider) return '';
    
    try {
      // Get creation transaction by finding the first internal tx
      // This uses eth_getCode nonce check as a lightweight approach
      const code = await this.provider.getCode(tokenAddress);
      if (code === '0x') return ''; // Not a contract

      // For production: use Etherscan/Basescan API to get contract creator
      // Lightweight fallback: return empty, will be resolved in audit phase
      return '';
    } catch {
      return '';
    }
  }

  /**
   * Stop all WebSocket subscriptions
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

    logger.info(i18n.t('system', 'disconnected', { chain: this.chainType }));
  }
}
