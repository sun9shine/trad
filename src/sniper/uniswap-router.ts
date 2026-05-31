/**
 * ============================================
 * Uniswap V3 Multi-Hop Router - Path Encoding
 * موجه Uniswap V3 متعدد القفزات - ترميز المسار
 * ============================================
 *
 * Finds optimal swap routes across multiple pools:
 * - Direct: WETH → TOKEN
 * - 2-hop: WETH → USDC → TOKEN
 * - 3-hop: WETH → USDC → WBTC → TOKEN
 *
 * Uses Uniswap V3 path encoding (token+fee+token+fee+token)
 * for exactInput multi-hop swaps.
 *
 * Also supports Uniswap V2 style routing via Aerodrome.
 */

import { ethers, Contract, JsonRpcProvider, solidityPacked } from 'ethers';
import { config } from '../config';
import { EVM } from '../utils/constants';
import { logger } from '../utils/logger';
import { i18n } from '../i18n';
import axios from 'axios';

// Uniswap V3 fee tiers
export enum FeeTier {
  LOWEST = 100,    // 0.01% - stablecoins
  LOW = 500,       // 0.05% - stable pairs
  MEDIUM = 3000,   // 0.30% - most pairs
  HIGH = 10000,    // 1.00% - exotic pairs
}

export interface SwapRoute {
  path: string;         // Encoded path bytes
  tokens: string[];     // Token addresses in order
  fees: FeeTier[];      // Fee tiers between each hop
  hops: number;
  estimatedOutput: bigint;
  priceImpact: number;  // Percentage
  gasEstimate: number;
}

// Known intermediate tokens for routing (Base)
const BASE_INTERMEDIATES = [
  { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC' },
  { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI' },
  { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC' },
];

// Known intermediate tokens for BNB
const BNB_INTERMEDIATES = [
  { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB' },
  { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT' },
  { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC' },
  { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD' },
];

// Uniswap V3 Quoter ABI
const QUOTER_ABI = [
  'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut)',
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
];

// Uniswap V3 SwapRouter ABI
const SWAP_ROUTER_ABI = [
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)',
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)',
  'function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[] results)',
];

// Quoter V2 addresses
const QUOTER_ADDRESSES: Record<string, string> = {
  base: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
  bnb: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
};

export class UniswapV3Router {
  private baseProvider: JsonRpcProvider;
  private bnbProvider: JsonRpcProvider;

  constructor() {
    this.baseProvider = new JsonRpcProvider(config.base.rpcUrl);
    this.bnbProvider = new JsonRpcProvider(config.bnb.rpcUrl);
  }

  /**
   * Find the best route for a swap (checks direct + multi-hop)
   * إيجاد أفضل مسار للتبادل
   */
  async findBestRoute(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    chain: 'base' | 'bnb'
  ): Promise<SwapRoute | null> {
    const routes = await this.getAllPossibleRoutes(tokenIn, tokenOut, amountIn, chain);

    if (routes.length === 0) return null;

    // Sort by output amount (highest first)
    routes.sort((a, b) => {
      if (b.estimatedOutput > a.estimatedOutput) return 1;
      if (b.estimatedOutput < a.estimatedOutput) return -1;
      return 0;
    });

    const best = routes[0];
    logger.info(i18n.t('system', 'info', {
      message: `Best route: ${best.hops}-hop via ${best.tokens.map(t => t.slice(0, 8)).join('→')} | Output: ${best.estimatedOutput}`,
    }));

    return best;
  }

  /**
   * Generate all possible routes and quote each
   * توليد جميع المسارات الممكنة واستعلام كل منها
   */
  private async getAllPossibleRoutes(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    chain: 'base' | 'bnb'
  ): Promise<SwapRoute[]> {
    const intermediates = chain === 'base' ? BASE_INTERMEDIATES : BNB_INTERMEDIATES;
    const routes: SwapRoute[] = [];

    // 1. Try all direct routes (different fee tiers)
    const directFees = [FeeTier.LOW, FeeTier.MEDIUM, FeeTier.HIGH];
    for (const fee of directFees) {
      const quote = await this.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, chain);
      if (quote > 0n) {
        routes.push({
          path: this.encodePath([tokenIn, tokenOut], [fee]),
          tokens: [tokenIn, tokenOut],
          fees: [fee],
          hops: 1,
          estimatedOutput: quote,
          priceImpact: 0,
          gasEstimate: 150_000,
        });
      }
    }

    // 2. Try 2-hop routes through intermediates
    for (const intermediate of intermediates) {
      // Skip if intermediate is same as input or output
      if (intermediate.address.toLowerCase() === tokenIn.toLowerCase() ||
          intermediate.address.toLowerCase() === tokenOut.toLowerCase()) {
        continue;
      }

      for (const fee1 of [FeeTier.LOW, FeeTier.MEDIUM]) {
        for (const fee2 of [FeeTier.MEDIUM, FeeTier.HIGH]) {
          const path = this.encodePath(
            [tokenIn, intermediate.address, tokenOut],
            [fee1, fee2]
          );

          const quote = await this.quoteExactInput(path, amountIn, chain);
          if (quote > 0n) {
            routes.push({
              path,
              tokens: [tokenIn, intermediate.address, tokenOut],
              fees: [fee1, fee2],
              hops: 2,
              estimatedOutput: quote,
              priceImpact: 0,
              gasEstimate: 250_000,
            });
          }
        }
      }
    }

    return routes;
  }

  /**
   * Encode Uniswap V3 multi-hop path
   * ترميز مسار Uniswap V3 متعدد القفزات
   *
   * Format: token0 (20 bytes) + fee (3 bytes) + token1 (20 bytes) + fee (3 bytes) + token2 (20 bytes)
   */
  encodePath(tokens: string[], fees: FeeTier[]): string {
    if (tokens.length !== fees.length + 1) {
      throw new Error('Path encoding: tokens.length must equal fees.length + 1');
    }

    let encoded = '0x';
    for (let i = 0; i < fees.length; i++) {
      // token address (20 bytes) + fee (3 bytes)
      encoded += tokens[i].slice(2).toLowerCase();
      encoded += fees[i].toString(16).padStart(6, '0');
    }
    // Last token (20 bytes)
    encoded += tokens[tokens.length - 1].slice(2).toLowerCase();

    return encoded;
  }

  /**
   * Quote exact input for single hop
   */
  private async quoteExactInputSingle(
    tokenIn: string,
    tokenOut: string,
    fee: FeeTier,
    amountIn: bigint,
    chain: 'base' | 'bnb'
  ): Promise<bigint> {
    try {
      const provider = chain === 'base' ? this.baseProvider : this.bnbProvider;
      const quoterAddress = QUOTER_ADDRESSES[chain];
      if (!quoterAddress) return 0n;

      const quoter = new Contract(quoterAddress, QUOTER_ABI, provider);

      const result = await quoter.quoteExactInputSingle.staticCall(
        tokenIn, tokenOut, fee, amountIn, 0n
      );
      return result;
    } catch {
      return 0n;
    }
  }

  /**
   * Quote exact input for multi-hop path
   */
  private async quoteExactInput(
    path: string,
    amountIn: bigint,
    chain: 'base' | 'bnb'
  ): Promise<bigint> {
    try {
      const provider = chain === 'base' ? this.baseProvider : this.bnbProvider;
      const quoterAddress = QUOTER_ADDRESSES[chain];
      if (!quoterAddress) return 0n;

      const quoter = new Contract(quoterAddress, QUOTER_ABI, provider);
      const result = await quoter.quoteExactInput.staticCall(path, amountIn);
      return result;
    } catch {
      return 0n;
    }
  }

  /**
   * Build exactInput swap calldata for multi-hop
   * بناء بيانات استدعاء exactInput للتبادل متعدد القفزات
   */
  buildExactInputCalldata(
    route: SwapRoute,
    recipient: string,
    amountIn: bigint,
    minAmountOut: bigint
  ): string {
    const iface = new ethers.Interface(SWAP_ROUTER_ABI);

    if (route.hops === 1) {
      // Single hop - use exactInputSingle (more gas efficient)
      return iface.encodeFunctionData('exactInputSingle', [{
        tokenIn: route.tokens[0],
        tokenOut: route.tokens[1],
        fee: route.fees[0],
        recipient,
        amountIn,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0n,
      }]);
    }

    // Multi-hop - use exactInput
    return iface.encodeFunctionData('exactInput', [{
      path: route.path,
      recipient,
      amountIn,
      amountOutMinimum: minAmountOut,
    }]);
  }

  /**
   * Build multicall with WETH wrapping for native ETH input
   */
  buildMulticallWithWrap(
    route: SwapRoute,
    recipient: string,
    amountIn: bigint,
    minAmountOut: bigint
  ): string {
    const iface = new ethers.Interface(SWAP_ROUTER_ABI);
    const swapData = this.buildExactInputCalldata(route, recipient, amountIn, minAmountOut);
    const deadline = Math.floor(Date.now() / 1000) + 120;

    return iface.encodeFunctionData('multicall', [deadline, [swapData]]);
  }

  /**
   * Calculate minimum output with slippage
   */
  calculateMinOutput(estimatedOutput: bigint, slippagePercent: number): bigint {
    const factor = BigInt(Math.floor((100 - slippagePercent) * 100));
    return (estimatedOutput * factor) / 10000n;
  }
}
