/**
 * ============================================
 * Price Feed - Multi-Source Price Oracle
 * مصدر الأسعار - Oracle متعدد المصادر
 * ============================================
 * 
 * Provides real-time price data from:
 * - Jupiter API (Solana tokens)
 * - DexScreener (Multi-chain)
 * - Birdeye (Solana)
 * - On-chain pool reserves (fallback)
 * 
 * Used by Position Manager for trailing stop calculation
 * and by Security Auditor for liquidity USD valuation.
 */

import axios, { AxiosInstance } from 'axios';
import EventEmitter from 'eventemitter3';
import { Chain } from '../utils/types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { i18n } from '../i18n';

export interface PriceData {
  token: string;
  chain: Chain;
  priceUsd: number;
  priceNative: number; // Price in native token (SOL/ETH/SUI)
  liquidityUsd: number;
  volume24h: number;
  priceChange5m: number;
  priceChange1h: number;
  lastUpdated: number;
  source: 'jupiter' | 'dexscreener' | 'birdeye' | 'onchain';
}

interface PriceFeedEvents {
  'price:updated': (data: PriceData) => void;
  'price:error': (token: string, error: Error) => void;
}

// DexScreener chain mapping
const DEXSCREENER_CHAINS: Record<Chain, string> = {
  solana: 'solana',
  base: 'base',
  bnb: 'bsc',
  sui: 'sui',
  hyperliquid: 'hyperliquid',
};

export class PriceFeed extends EventEmitter<PriceFeedEvents> {
  private priceCache: Map<string, PriceData> = new Map();
  private watchList: Map<string, { chain: Chain; interval: NodeJS.Timeout }> = new Map();
  private httpClient: AxiosInstance;
  private jupiterClient: AxiosInstance;
  private isRunning: boolean = false;

  constructor() {
    super();
    
    this.httpClient = axios.create({
      timeout: 5000,
      headers: { 'Accept': 'application/json' },
    });

    this.jupiterClient = axios.create({
      baseURL: 'https://price.jup.ag/v6',
      timeout: 3000,
    });
  }

  /**
   * Start the price feed service
   * بدء خدمة مصدر الأسعار
   */
  start(): void {
    this.isRunning = true;
    logger.info(i18n.t('system', 'info', { message: 'Price feed service started' }));
  }

  /**
   * Get current price for a token (cached or fresh)
   * الحصول على السعر الحالي لعملة
   */
  async getPrice(tokenAddress: string, chain: Chain): Promise<PriceData | null> {
    // Check cache (valid for 2 seconds)
    const cached = this.priceCache.get(this.cacheKey(tokenAddress, chain));
    if (cached && Date.now() - cached.lastUpdated < 2000) {
      return cached;
    }

    // Fetch fresh price with fallback chain
    return await this.fetchPriceWithFallback(tokenAddress, chain);
  }

  /**
   * Get liquidity in USD for a token's pool
   * الحصول على قيمة السيولة بالدولار
   */
  async getLiquidityUsd(tokenAddress: string, chain: Chain): Promise<number> {
    const price = await this.getPrice(tokenAddress, chain);
    return price?.liquidityUsd || 0;
  }

  /**
   * Watch a token for price updates (polling)
   * مراقبة عملة لتحديثات السعر
   */
  watchToken(tokenAddress: string, chain: Chain, intervalMs: number = 1000): void {
    const key = this.cacheKey(tokenAddress, chain);
    
    // Don't duplicate watches
    if (this.watchList.has(key)) return;

    const interval = setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        const price = await this.fetchPriceWithFallback(tokenAddress, chain);
        if (price) {
          this.emit('price:updated', price);
        }
      } catch (error) {
        this.emit('price:error', tokenAddress, error as Error);
      }
    }, intervalMs);

    this.watchList.set(key, { chain, interval });
  }

  /**
   * Stop watching a token
   */
  unwatchToken(tokenAddress: string, chain: Chain): void {
    const key = this.cacheKey(tokenAddress, chain);
    const watch = this.watchList.get(key);
    if (watch) {
      clearInterval(watch.interval);
      this.watchList.delete(key);
    }
    this.priceCache.delete(key);
  }

  /**
   * Fetch price with fallback sources
   * جلب السعر مع مصادر بديلة
   * 
   * Priority: Jupiter (Solana) → DexScreener (all) → Birdeye → On-chain
   */
  private async fetchPriceWithFallback(tokenAddress: string, chain: Chain): Promise<PriceData | null> {
    // Try primary source based on chain
    if (chain === 'solana') {
      const jupiterPrice = await this.fetchFromJupiter(tokenAddress);
      if (jupiterPrice) return jupiterPrice;
    }

    // Try DexScreener (supports all chains)
    const dexScreenerPrice = await this.fetchFromDexScreener(tokenAddress, chain);
    if (dexScreenerPrice) return dexScreenerPrice;

    // Try Birdeye for Solana
    if (chain === 'solana') {
      const birdeyePrice = await this.fetchFromBirdeye(tokenAddress);
      if (birdeyePrice) return birdeyePrice;
    }

    return null;
  }

  /**
   * Fetch price from Jupiter Price API (Solana)
   * جلب السعر من Jupiter (سولانا)
   */
  private async fetchFromJupiter(tokenAddress: string): Promise<PriceData | null> {
    try {
      const response = await this.jupiterClient.get('/price', {
        params: {
          ids: tokenAddress,
          vsToken: 'So11111111111111111111111111111111111111112', // SOL
        },
      });

      const data = response.data?.data?.[tokenAddress];
      if (!data) return null;

      const priceData: PriceData = {
        token: tokenAddress,
        chain: 'solana',
        priceUsd: data.price || 0,
        priceNative: data.price || 0,  // Jupiter returns in USD
        liquidityUsd: data.liquidity || 0,
        volume24h: data.volume24h || 0,
        priceChange5m: data.priceChange5m || 0,
        priceChange1h: data.priceChange1h || 0,
        lastUpdated: Date.now(),
        source: 'jupiter',
      };

      this.priceCache.set(this.cacheKey(tokenAddress, 'solana'), priceData);
      return priceData;
    } catch {
      return null;
    }
  }

  /**
   * Fetch price from DexScreener API (Multi-chain)
   * جلب السعر من DexScreener (متعدد السلاسل)
   */
  private async fetchFromDexScreener(tokenAddress: string, chain: Chain): Promise<PriceData | null> {
    try {
      const chainId = DEXSCREENER_CHAINS[chain];
      const response = await this.httpClient.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
      );

      const pairs = response.data?.pairs;
      if (!pairs || pairs.length === 0) return null;

      // Find the pair matching our chain with highest liquidity
      const matchedPair = pairs
        .filter((p: any) => p.chainId === chainId)
        .sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

      if (!matchedPair) return null;

      const priceData: PriceData = {
        token: tokenAddress,
        chain,
        priceUsd: parseFloat(matchedPair.priceUsd || '0'),
        priceNative: parseFloat(matchedPair.priceNative || '0'),
        liquidityUsd: matchedPair.liquidity?.usd || 0,
        volume24h: matchedPair.volume?.h24 || 0,
        priceChange5m: matchedPair.priceChange?.m5 || 0,
        priceChange1h: matchedPair.priceChange?.h1 || 0,
        lastUpdated: Date.now(),
        source: 'dexscreener',
      };

      this.priceCache.set(this.cacheKey(tokenAddress, chain), priceData);
      return priceData;
    } catch {
      return null;
    }
  }

  /**
   * Fetch price from Birdeye API (Solana)
   */
  private async fetchFromBirdeye(tokenAddress: string): Promise<PriceData | null> {
    try {
      const response = await this.httpClient.get(
        `https://public-api.birdeye.so/defi/price?address=${tokenAddress}`,
        { headers: { 'X-API-KEY': process.env.BIRDEYE_API_KEY || '' } }
      );

      const data = response.data?.data;
      if (!data) return null;

      const priceData: PriceData = {
        token: tokenAddress,
        chain: 'solana',
        priceUsd: data.value || 0,
        priceNative: data.value || 0,
        liquidityUsd: data.liquidity || 0,
        volume24h: 0,
        priceChange5m: 0,
        priceChange1h: 0,
        lastUpdated: Date.now(),
        source: 'birdeye',
      };

      this.priceCache.set(this.cacheKey(tokenAddress, 'solana'), priceData);
      return priceData;
    } catch {
      return null;
    }
  }

  /**
   * Get native token price in USD (SOL, ETH, BNB, SUI)
   * الحصول على سعر العملة الأصلية بالدولار
   */
  async getNativeTokenPrice(chain: Chain): Promise<number> {
    const nativeTokens: Record<Chain, string> = {
      solana: 'So11111111111111111111111111111111111111112',
      base: '0x4200000000000000000000000000000000000006', // WETH
      bnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
      sui: '0x2::sui::SUI',
      hyperliquid: 'HYPE',
    };

    try {
      const response = await this.httpClient.get(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: {
            ids: 'solana,ethereum,binancecoin,sui',
            vs_currencies: 'usd',
          },
        }
      );

      const prices: Record<Chain, number> = {
        solana: response.data?.solana?.usd || 0,
        base: response.data?.ethereum?.usd || 0,
        bnb: response.data?.binancecoin?.usd || 0,
        sui: response.data?.sui?.usd || 0,
        hyperliquid: 0,
      };

      return prices[chain] || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Bulk price fetch for multiple tokens
   */
  async getBulkPrices(tokens: Array<{ address: string; chain: Chain }>): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();
    
    // Group by chain for efficient batching
    const byChain = new Map<Chain, string[]>();
    for (const t of tokens) {
      const arr = byChain.get(t.chain) || [];
      arr.push(t.address);
      byChain.set(t.chain, arr);
    }

    // Fetch in parallel per chain
    const promises: Promise<void>[] = [];
    
    for (const [chain, addresses] of byChain) {
      for (const addr of addresses) {
        promises.push(
          this.getPrice(addr, chain).then(price => {
            if (price) results.set(this.cacheKey(addr, chain), price);
          })
        );
      }
    }

    await Promise.allSettled(promises);
    return results;
  }

  private cacheKey(token: string, chain: Chain): string {
    return `${chain}:${token}`;
  }

  /**
   * Stop all watchers and clear cache
   */
  stop(): void {
    this.isRunning = false;
    for (const [_, watch] of this.watchList) {
      clearInterval(watch.interval);
    }
    this.watchList.clear();
    this.priceCache.clear();
    logger.info(i18n.t('system', 'info', { message: 'Price feed stopped' }));
  }
}
