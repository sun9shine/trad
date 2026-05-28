/**
 * ============================================
 * Sui Scanner - Event Subscription
 * ماسح Sui - اشتراك الأحداث
 * ============================================
 * 
 * Listens for SuiEvent filtering by package IDs of:
 * - Cetus CLMM: New pool creation events
 * - BlueMove DEX: New pair registration events
 * 
 * Uses Sui JSON-RPC WebSocket for real-time event streaming.
 */

import { SuiClient, SuiEvent, EventId } from '@mysten/sui.js/client';
import { BaseScanner } from './base-scanner';
import { TokenInfo, Chain } from '../utils/types';
import { config } from '../config';
import { SUI } from '../utils/constants';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';

// Cetus pool creation event type
const CETUS_POOL_CREATED_EVENT = `${SUI.CETUS_CLMM_PACKAGE}::factory::CreatePoolEvent`;
const BLUEMOVE_POOL_CREATED_EVENT = `${SUI.BLUEMOVE_PACKAGE}::swap::PoolCreatedEvent`;

export class SuiScanner extends BaseScanner {
  private client: SuiClient;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastEventCursor: EventId | null = null;
  private unsubscribeFns: Array<() => void> = [];

  constructor() {
    super('sui');
    this.client = new SuiClient({ url: config.sui.rpcUrl });
  }

  /**
   * Start the Sui scanner
   * بدء ماسح Sui
   */
  async start(): Promise<void> {
    this.isRunning = true;
    logger.info(i18n.t('scanner', 'listeningChain', { 
      chain: 'Sui', 
      method: 'Event Subscription' 
    }));

    try {
      // Subscribe to Cetus pool creation events
      await this.subscribeToEvents(CETUS_POOL_CREATED_EVENT, 'cetus');
      
      // Subscribe to BlueMove pool creation events
      await this.subscribeToEvents(BLUEMOVE_POOL_CREATED_EVENT, 'bluemove');

      // Fallback polling for missed events
      this.startPolling();

      this.emit('scanner:connected', 'sui');
      logger.info(i18n.t('system', 'connected', { chain: 'Sui' }));
    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Sui Scanner start failed: ${error}` 
      }));
      // Fall back to polling only
      this.startPolling();
    }
  }

  /**
   * Subscribe to specific event type via WebSocket
   * الاشتراك في نوع حدث معين عبر WebSocket
   */
  private async subscribeToEvents(eventType: string, dex: 'cetus' | 'bluemove'): Promise<void> {
    try {
      const unsubscribe = await this.client.subscribeEvent({
        filter: { MoveEventType: eventType },
        onMessage: (event: SuiEvent) => {
          this.processEvent(event, dex);
        },
      });

      this.unsubscribeFns.push(unsubscribe);
      
      logger.info(i18n.t('system', 'info', { 
        message: `Subscribed to ${dex} events: ${eventType.split('::').pop()}` 
      }));
    } catch (error) {
      logger.warn(i18n.t('system', 'warning', { 
        message: `Failed to subscribe to ${dex} events: ${error}` 
      }));
    }
  }

  /**
   * Process a received Sui event
   * معالجة حدث Sui مُستلم
   */
  private processEvent(event: SuiEvent, dex: 'cetus' | 'bluemove'): void {
    try {
      const parsedFields = event.parsedJson as any;
      
      if (dex === 'cetus') {
        this.handleCetusPoolCreated(parsedFields, event);
      } else if (dex === 'bluemove') {
        this.handleBlueMovePairCreated(parsedFields, event);
      }
    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Failed to process Sui event: ${error}` 
      }));
    }
  }

  /**
   * Handle Cetus CLMM pool creation
   * معالجة إنشاء تجمع Cetus CLMM
   */
  private handleCetusPoolCreated(fields: any, event: SuiEvent): void {
    // Cetus CreatePoolEvent fields:
    // pool_id, coin_type_a, coin_type_b, tick_spacing, etc.
    const coinTypeA = fields.coin_type_a || fields.coinTypeA || '';
    const coinTypeB = fields.coin_type_b || fields.coinTypeB || '';
    const poolId = fields.pool_id || fields.pool || '';

    const { newToken, quoteToken } = this.identifySuiNewToken(coinTypeA, coinTypeB);

    const token: TokenInfo = {
      address: newToken,
      chain: 'sui',
      dex: 'cetus',
      decimals: 9, // Default for Sui tokens
      deployer: event.sender || '',
      poolAddress: poolId,
      pairToken: quoteToken,
      liquidity: 0,
      createdAt: Number(event.timestampMs) || Date.now(),
      txHash: event.id?.txDigest || '',
    };

    this.emitTokenDiscovered(token);
  }

  /**
   * Handle BlueMove pair creation
   * معالجة إنشاء زوج BlueMove
   */
  private handleBlueMovePairCreated(fields: any, event: SuiEvent): void {
    const coinTypeA = fields.token_x_type || fields.coin_type_a || '';
    const coinTypeB = fields.token_y_type || fields.coin_type_b || '';
    const poolId = fields.pool_id || fields.lp_id || '';

    const { newToken, quoteToken } = this.identifySuiNewToken(coinTypeA, coinTypeB);

    const token: TokenInfo = {
      address: newToken,
      chain: 'sui',
      dex: 'bluemove',
      decimals: 9,
      deployer: event.sender || '',
      poolAddress: poolId,
      pairToken: quoteToken,
      liquidity: 0,
      createdAt: Number(event.timestampMs) || Date.now(),
      txHash: event.id?.txDigest || '',
    };

    this.emitTokenDiscovered(token);
  }

  /**
   * Identify new token vs quote token on Sui
   * Known Sui quote types: SUI, USDC, USDT
   */
  private identifySuiNewToken(typeA: string, typeB: string): { newToken: string; quoteToken: string } {
    const knownQuotes = [
      '0x2::sui::SUI',
      '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN', // USDC
      '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN', // USDT
    ];

    const isAQuote = knownQuotes.some(q => typeA.includes(q) || typeA.endsWith('::sui::SUI'));
    const isBQuote = knownQuotes.some(q => typeB.includes(q) || typeB.endsWith('::sui::SUI'));

    if (isAQuote) return { newToken: typeB, quoteToken: typeA };
    if (isBQuote) return { newToken: typeA, quoteToken: typeB };

    return { newToken: typeA, quoteToken: typeB };
  }

  /**
   * Polling fallback for environments where WebSocket subscriptions are unreliable
   * آلية الاستطلاع البديلة
   */
  private startPolling(): void {
    this.pollingInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        const events = await this.client.queryEvents({
          query: { MoveEventType: CETUS_POOL_CREATED_EVENT },
          cursor: this.lastEventCursor || undefined,
          limit: 10,
          order: 'descending',
        });

        if (events.data.length > 0) {
          this.lastEventCursor = events.nextCursor || null;
          
          for (const event of events.data) {
            this.processEvent(event, 'cetus');
          }
        }
      } catch (error) {
        // Polling errors are non-fatal
        logger.warn(i18n.t('system', 'warning', { 
          message: `Sui polling error: ${error}` 
        }));
      }
    }, 2000); // Poll every 2 seconds as fallback
  }

  /**
   * Stop all subscriptions and polling
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // Unsubscribe from all event streams
    for (const unsub of this.unsubscribeFns) {
      try { unsub(); } catch {}
    }
    this.unsubscribeFns = [];

    // Clear polling interval
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    logger.info(i18n.t('system', 'disconnected', { chain: 'Sui' }));
  }
}
