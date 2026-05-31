/**
 * ============================================
 * Hyperliquid Sniper - L1 DEX Execution
 * قناص Hyperliquid - تنفيذ على L1 DEX
 * ============================================
 * 
 * Implements trading on Hyperliquid L1:
 * - Native API order placement
 * - Market orders with slippage control
 * - Spot and perp trading
 * - Emergency position close
 */

import axios, { AxiosInstance } from 'axios';
import { ethers } from 'ethers';
import { config } from '../config';
import { TokenInfo, ExecutionResult, TradeSignal } from '../utils/types';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';

interface HyperliquidOrder {
  coin: string;
  isBuy: boolean;
  sz: number;
  limitPx: number;
  orderType: { limit: { tif: 'Ioc' | 'Gtc' | 'Alo' } } | { market: {} };
  reduceOnly: boolean;
}

export class HyperliquidSniper {
  private apiClient: AxiosInstance;
  private wallet: ethers.Wallet | null = null;
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.hyperliquid.rpcUrl || 'https://api.hyperliquid.xyz';
    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' },
    });

    if (config.hyperliquid.privateKey) {
      this.wallet = new ethers.Wallet(config.hyperliquid.privateKey);
    }
  }


  /**
   * Execute a market buy on Hyperliquid
   * تنفيذ شراء سوقي على Hyperliquid
   */
  async snipeBuy(signal: TradeSignal): Promise<ExecutionResult> {
    try {
      if (!this.wallet) {
        return { success: false, error: 'No wallet configured', chain: 'hyperliquid', timestamp: Date.now() };
      }

      const token = signal.token;
      const coin = token.symbol || token.address;

      // Get current market price
      const midPrice = await this.getMidPrice(coin);
      if (!midPrice) {
        return { success: false, error: 'Cannot fetch price', chain: 'hyperliquid', timestamp: Date.now() };
      }

      // Calculate limit price with slippage
      const limitPx = midPrice * (1 + signal.maxSlippage / 100);
      const sz = signal.amount / midPrice;

      // Build and sign the order
      const order: HyperliquidOrder = {
        coin,
        isBuy: true,
        sz: parseFloat(sz.toFixed(4)),
        limitPx: parseFloat(limitPx.toFixed(2)),
        orderType: { limit: { tif: 'Ioc' } }, // Immediate-or-cancel
        reduceOnly: false,
      };

      const result = await this.placeOrder(order);

      if (result.success) {
        logger.info(i18n.t('sniper', 'buyExecuted', {
          amount: sz.toFixed(4),
          token: coin,
          price: limitPx.toFixed(2),
          tx: result.txHash || 'HL-order',
        }));
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        chain: 'hyperliquid',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute emergency sell / close position
   * تنفيذ بيع طارئ / إغلاق مركز
   */
  async emergencySell(coin: string, size?: number): Promise<ExecutionResult> {
    try {
      if (!this.wallet) {
        return { success: false, error: 'No wallet', chain: 'hyperliquid', timestamp: Date.now() };
      }

      // Get current position size if not specified
      const posSize = size || await this.getPositionSize(coin);
      if (posSize <= 0) {
        return { success: false, error: 'No position', chain: 'hyperliquid', timestamp: Date.now() };
      }

      const midPrice = await this.getMidPrice(coin);
      const limitPx = midPrice ? midPrice * 0.9 : 0; // 10% below for emergency

      const order: HyperliquidOrder = {
        coin,
        isBuy: false,
        sz: posSize,
        limitPx: parseFloat(limitPx.toFixed(2)),
        orderType: { limit: { tif: 'Ioc' } },
        reduceOnly: true,
      };

      return await this.placeOrder(order);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        chain: 'hyperliquid',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Place order on Hyperliquid via API
   */
  private async placeOrder(order: HyperliquidOrder): Promise<ExecutionResult> {
    try {
      const timestamp = Date.now();
      const action = {
        type: 'order',
        orders: [order],
        grouping: 'na',
      };

      // Sign the action with EIP-712
      const signature = await this.signAction(action, timestamp);

      const response = await this.apiClient.post('/exchange', {
        action,
        nonce: timestamp,
        signature,
      });

      const data = response.data;
      const success = data?.status === 'ok' || data?.response?.type === 'order';

      return {
        success,
        txHash: data?.response?.data?.statuses?.[0]?.resting?.oid || `HL_${timestamp}`,
        chain: 'hyperliquid',
        timestamp,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        chain: 'hyperliquid',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Get mid price for a coin
   */
  private async getMidPrice(coin: string): Promise<number | null> {
    try {
      const response = await this.apiClient.post('/info', {
        type: 'allMids',
      });
      return parseFloat(response.data?.[coin] || '0') || null;
    } catch {
      return null;
    }
  }

  /**
   * Get current position size
   */
  private async getPositionSize(coin: string): Promise<number> {
    try {
      if (!this.wallet) return 0;
      const response = await this.apiClient.post('/info', {
        type: 'clearinghouseState',
        user: this.wallet.address,
      });
      const position = response.data?.assetPositions?.find(
        (p: any) => p.position?.coin === coin
      );
      return Math.abs(parseFloat(position?.position?.szi || '0'));
    } catch {
      return 0;
    }
  }

  /**
   * Sign action for Hyperliquid API (EIP-712 style)
   */
  private async signAction(action: any, timestamp: number): Promise<string> {
    if (!this.wallet) return '';
    
    const message = JSON.stringify({ action, nonce: timestamp });
    return await this.wallet.signMessage(message);
  }

  /**
   * Get account balance on Hyperliquid
   */
  async getBalance(): Promise<number> {
    try {
      if (!this.wallet) return 0;
      const response = await this.apiClient.post('/info', {
        type: 'clearinghouseState',
        user: this.wallet.address,
      });
      return parseFloat(response.data?.marginSummary?.accountValue || '0');
    } catch {
      return 0;
    }
  }
}
