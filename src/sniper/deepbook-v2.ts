/**
 * ============================================
 * DeepBook V2 - Sui Native Orderbook DEX
 * DeepBook V2 - دفتر أوامر Sui الأصلي
 * ============================================
 *
 * Integration with Sui's native CLOB (Central Limit Order Book):
 * - Market orders for instant execution
 * - Limit orders for better prices
 * - Order book depth analysis
 * - Best bid/ask fetching
 *
 * DeepBook is Sui's built-in orderbook protocol,
 * offering lower slippage than AMMs for liquid pairs.
 */

import { SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { config } from '../config';
import { ExecutionResult } from '../utils/types';
import { logger } from '../utils/logger';
import { i18n } from '../i18n';

// DeepBook V2 Package on Mainnet
const DEEPBOOK_PACKAGE = '0x000000000000000000000000000000000000000000000000000000000000dee9';
const DEEPBOOK_REGISTRY = '0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d';

// Known DeepBook pools
const KNOWN_POOLS: Record<string, string> = {
  'SUI/USDC': '0x4405b50d791fd3346754e8171aaab6bc2ed26c2c46efdd033c14b30ae507ac33',
  'SUI/USDT': '0x6e566fec4c388eeb78a2a685d9446e89f7baeb7b12e850e6e5e847ee1dd7a981',
};

// Lot size and tick constants
const FLOAT_SCALING = BigInt(1_000_000_000); // 1e9
const CUSTODIAN_ADDRESS = '0x6e566fec4c388eeb78a2a685d9446e89f7baeb7b12e850e6e5e847ee1dd7a981';

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookState {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  midPrice: number;
}

export interface DeepBookQuote {
  expectedOutput: bigint;
  avgPrice: number;
  priceImpact: number;
  feePaid: bigint;
}

export class DeepBookV2 {
  private client: SuiClient;

  constructor(client?: SuiClient) {
    this.client = client || new SuiClient({ url: config.sui.rpcUrl });
  }

  /**
   * Get order book state (best bid/ask + depth)
   * الحصول على حالة دفتر الأوامر
   */
  async getOrderBook(poolId: string): Promise<OrderBookState | null> {
    try {
      const obj = await this.client.getObject({
        id: poolId,
        options: { showContent: true },
      });

      if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') {
        return null;
      }

      const fields = (obj.data.content as any).fields;

      // Parse bids and asks from critbit tree
      const bids = this.parseLevels(fields.bids);
      const asks = this.parseLevels(fields.asks);

      const bestBid = bids.length > 0 ? bids[0].price : 0;
      const bestAsk = asks.length > 0 ? asks[0].price : 0;
      const spread = bestAsk - bestBid;
      const midPrice = (bestBid + bestAsk) / 2;
      const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

      return { bids, asks, bestBid, bestAsk, spread, spreadPercent, midPrice };
    } catch (error) {
      logger.warn(i18n.t('system', 'warning', {
        message: `DeepBook order book fetch failed: ${error}`,
      }));
      return null;
    }
  }

  /**
   * Get a quote for market buy
   * الحصول على اقتباس للشراء السوقي
   */
  async getMarketBuyQuote(poolId: string, amountIn: bigint): Promise<DeepBookQuote | null> {
    const orderBook = await this.getOrderBook(poolId);
    if (!orderBook || orderBook.asks.length === 0) return null;

    let remaining = Number(amountIn) / Number(FLOAT_SCALING);
    let totalOutput = 0;
    let totalCost = 0;

    // Walk through ask levels
    for (const ask of orderBook.asks) {
      if (remaining <= 0) break;

      const canFill = Math.min(remaining / ask.price, ask.quantity);
      totalOutput += canFill;
      totalCost += canFill * ask.price;
      remaining -= canFill * ask.price;
    }

    if (totalOutput === 0) return null;

    const avgPrice = totalCost / totalOutput;
    const priceImpact = orderBook.midPrice > 0
      ? ((avgPrice - orderBook.midPrice) / orderBook.midPrice) * 100
      : 0;

    // Fee: 0.1% taker fee on DeepBook
    const feePaid = BigInt(Math.floor(totalCost * 0.001 * Number(FLOAT_SCALING)));

    return {
      expectedOutput: BigInt(Math.floor(totalOutput * Number(FLOAT_SCALING))),
      avgPrice,
      priceImpact,
      feePaid,
    };
  }

  /**
   * Build market buy transaction on DeepBook
   * بناء معاملة شراء سوقي على DeepBook
   */
  buildMarketBuyTx(
    tx: TransactionBlock,
    poolId: string,
    baseType: string,
    quoteType: string,
    inputCoin: any, // Quote coin (e.g., USDC)
    quantity: bigint,
    clientOrderId: bigint = BigInt(Date.now())
  ): any {
    return tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::clob_v2::place_market_order` as any,
      typeArguments: [baseType, quoteType],
      arguments: [
        tx.object(poolId),                        // Pool
        tx.object(DEEPBOOK_REGISTRY),             // AccountCap (using registry)
        tx.pure(clientOrderId),                   // client_order_id
        tx.pure(quantity),                        // quantity
        tx.pure(true),                            // is_bid (true = buy base)
        inputCoin,                                // quote coin input
        tx.object('0x6'),                         // Clock
      ],
    });
  }

  /**
   * Build market sell transaction on DeepBook
   * بناء معاملة بيع سوقي على DeepBook
   */
  buildMarketSellTx(
    tx: TransactionBlock,
    poolId: string,
    baseType: string,
    quoteType: string,
    inputCoin: any, // Base coin (e.g., SUI)
    quantity: bigint,
    clientOrderId: bigint = BigInt(Date.now())
  ): any {
    return tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::clob_v2::place_market_order` as any,
      typeArguments: [baseType, quoteType],
      arguments: [
        tx.object(poolId),
        tx.object(DEEPBOOK_REGISTRY),
        tx.pure(clientOrderId),
        tx.pure(quantity),
        tx.pure(false),                           // is_bid (false = sell base)
        inputCoin,
        tx.object('0x6'),
      ],
    });
  }

  /**
   * Build limit order (for better entry prices)
   * بناء أمر محدد (لأسعار دخول أفضل)
   */
  buildLimitOrderTx(
    tx: TransactionBlock,
    poolId: string,
    baseType: string,
    quoteType: string,
    inputCoin: any,
    price: bigint,
    quantity: bigint,
    isBid: boolean,
    expireTimestamp: bigint = BigInt(0) // 0 = GTC (Good Til Cancel)
  ): any {
    return tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::clob_v2::place_limit_order` as any,
      typeArguments: [baseType, quoteType],
      arguments: [
        tx.object(poolId),
        tx.object(DEEPBOOK_REGISTRY),
        tx.pure(BigInt(Date.now())),    // client_order_id
        tx.pure(price),                 // price (scaled)
        tx.pure(quantity),              // quantity
        tx.pure(0),                     // self_matching_prevention
        tx.pure(isBid),                 // is_bid
        tx.pure(expireTimestamp),       // expire_timestamp
        tx.pure(0),                     // restriction (0 = no restriction)
        inputCoin,
        tx.object('0x6'),
      ],
    });
  }

  /**
   * Check if DeepBook has better pricing than Cetus AMM
   * التحقق مما إذا كان DeepBook يقدم سعراً أفضل من Cetus AMM
   */
  async compareWithAMM(
    poolId: string,
    amountIn: bigint,
    cetusQuote: bigint
  ): Promise<{ deepbookBetter: boolean; priceDifference: number }> {
    const dbQuote = await this.getMarketBuyQuote(poolId, amountIn);
    if (!dbQuote) return { deepbookBetter: false, priceDifference: 0 };

    const dbOutput = Number(dbQuote.expectedOutput);
    const cetusOutput = Number(cetusQuote);

    if (cetusOutput === 0) return { deepbookBetter: dbOutput > 0, priceDifference: 100 };

    const diff = ((dbOutput - cetusOutput) / cetusOutput) * 100;
    return { deepbookBetter: diff > 0, priceDifference: diff };
  }

  /**
   * Find DeepBook pool for a pair
   */
  findPool(baseType: string, quoteType: string): string | null {
    for (const [pair, poolId] of Object.entries(KNOWN_POOLS)) {
      const [base, quote] = pair.split('/');
      if ((baseType.includes(base) || base.includes(baseType)) &&
          (quoteType.includes(quote) || quote.includes(quoteType))) {
        return poolId;
      }
    }
    return null;
  }

  /**
   * Parse order book levels from critbit tree
   */
  private parseLevels(treeData: any): OrderBookLevel[] {
    const levels: OrderBookLevel[] = [];
    try {
      // DeepBook stores orders in a critbit tree
      // Simplified parsing - production should traverse full tree
      const entries = treeData?.fields?.entries || [];
      for (const entry of entries.slice(0, 20)) {
        const price = Number(entry.fields?.key || 0) / Number(FLOAT_SCALING);
        const quantity = Number(entry.fields?.value?.fields?.size || 0) / Number(FLOAT_SCALING);
        if (price > 0 && quantity > 0) {
          levels.push({ price, quantity });
        }
      }
    } catch {}
    return levels;
  }
}
