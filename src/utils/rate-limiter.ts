/**
 * ============================================
 * Rate Limiter - RPC Call Protection
 * محدد المعدل - حماية استدعاءات RPC
 * ============================================
 * 
 * Token-bucket rate limiter with:
 * - Per-chain configurable limits
 * - Automatic queuing when limit exceeded
 * - Exponential backoff on 429 responses
 * - Priority bypass for emergency transactions
 */

import { Chain } from './types';
import { logger } from './logger';
import { i18n } from '../i18n';

interface RateLimitConfig {
  maxRequestsPerSecond: number;
  maxBurst: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  priority: 'emergency' | 'high' | 'normal' | 'low';
  timestamp: number;
}

const DEFAULT_LIMITS: Record<Chain, RateLimitConfig> = {
  solana: { maxRequestsPerSecond: 40, maxBurst: 60, backoffMultiplier: 2, maxBackoffMs: 30000 },
  base: { maxRequestsPerSecond: 25, maxBurst: 40, backoffMultiplier: 2, maxBackoffMs: 30000 },
  bnb: { maxRequestsPerSecond: 20, maxBurst: 35, backoffMultiplier: 2, maxBackoffMs: 30000 },
  sui: { maxRequestsPerSecond: 30, maxBurst: 50, backoffMultiplier: 2, maxBackoffMs: 30000 },
  hyperliquid: { maxRequestsPerSecond: 10, maxBurst: 20, backoffMultiplier: 2, maxBackoffMs: 30000 },
};

export class RateLimiter {
  private tokens: Map<Chain, number> = new Map();
  private lastRefill: Map<Chain, number> = new Map();
  private configs: Map<Chain, RateLimitConfig> = new Map();
  private queues: Map<Chain, QueuedRequest<any>[]> = new Map();
  private processingIntervals: Map<Chain, NodeJS.Timeout> = new Map();
  private backoffUntil: Map<Chain, number> = new Map();
  private consecutiveErrors: Map<Chain, number> = new Map();

  constructor(customLimits?: Partial<Record<Chain, Partial<RateLimitConfig>>>) {
    for (const [chain, defaultConfig] of Object.entries(DEFAULT_LIMITS)) {
      const custom = customLimits?.[chain as Chain];
      const config = { ...defaultConfig, ...custom };
      this.configs.set(chain as Chain, config);
      this.tokens.set(chain as Chain, config.maxBurst);
      this.lastRefill.set(chain as Chain, Date.now());
      this.queues.set(chain as Chain, []);
      this.backoffUntil.set(chain as Chain, 0);
      this.consecutiveErrors.set(chain as Chain, 0);
    }

    // Start queue processors
    this.startProcessors();
  }


  /**
   * Execute a rate-limited RPC call
   * تنفيذ استدعاء RPC محدد المعدل
   */
  async execute<T>(
    chain: Chain,
    fn: () => Promise<T>,
    priority: 'emergency' | 'high' | 'normal' | 'low' = 'normal'
  ): Promise<T> {
    // Emergency calls bypass rate limiting
    if (priority === 'emergency') {
      return await fn();
    }

    // Check backoff
    const backoffEnd = this.backoffUntil.get(chain) || 0;
    if (Date.now() < backoffEnd && priority !== 'high') {
      return new Promise((resolve, reject) => {
        this.queues.get(chain)!.push({ execute: fn, resolve, reject, priority, timestamp: Date.now() });
      });
    }

    // Try to consume a token
    if (this.tryConsume(chain)) {
      try {
        const result = await fn();
        this.consecutiveErrors.set(chain, 0);
        return result;
      } catch (error: any) {
        if (error?.status === 429 || error?.message?.includes('rate limit')) {
          this.handleRateLimit(chain);
        }
        throw error;
      }
    }

    // No tokens available - queue the request
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(chain)!;
      queue.push({ execute: fn, resolve, reject, priority, timestamp: Date.now() });
      
      // Sort by priority
      queue.sort((a, b) => {
        const pMap = { emergency: 0, high: 1, normal: 2, low: 3 };
        return pMap[a.priority] - pMap[b.priority];
      });
    });
  }

  /**
   * Try to consume a rate limit token
   */
  private tryConsume(chain: Chain): boolean {
    this.refillTokens(chain);
    const current = this.tokens.get(chain) || 0;
    if (current > 0) {
      this.tokens.set(chain, current - 1);
      return true;
    }
    return false;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(chain: Chain): void {
    const now = Date.now();
    const last = this.lastRefill.get(chain) || now;
    const config = this.configs.get(chain)!;
    const elapsed = (now - last) / 1000;
    const refill = Math.floor(elapsed * config.maxRequestsPerSecond);

    if (refill > 0) {
      const current = this.tokens.get(chain) || 0;
      this.tokens.set(chain, Math.min(current + refill, config.maxBurst));
      this.lastRefill.set(chain, now);
    }
  }

  /**
   * Handle rate limit response (429)
   */
  private handleRateLimit(chain: Chain): void {
    const config = this.configs.get(chain)!;
    const errors = (this.consecutiveErrors.get(chain) || 0) + 1;
    this.consecutiveErrors.set(chain, errors);

    const backoffMs = Math.min(
      1000 * Math.pow(config.backoffMultiplier, errors),
      config.maxBackoffMs
    );

    this.backoffUntil.set(chain, Date.now() + backoffMs);
    logger.warn(i18n.t('system', 'warning', { 
      message: `Rate limited on ${chain} - backing off ${backoffMs}ms` 
    }));
  }

  /**
   * Process queued requests
   */
  private startProcessors(): void {
    for (const [chain] of this.configs) {
      const interval = setInterval(async () => {
        const queue = this.queues.get(chain)!;
        if (queue.length === 0) return;

        const backoffEnd = this.backoffUntil.get(chain) || 0;
        if (Date.now() < backoffEnd) return;

        if (this.tryConsume(chain)) {
          const item = queue.shift();
          if (item) {
            try {
              const result = await item.execute();
              item.resolve(result);
            } catch (error) {
              item.reject(error);
            }
          }
        }
      }, 25); // Process every 25ms

      this.processingIntervals.set(chain, interval);
    }
  }

  /**
   * Get current status for monitoring
   */
  getStatus(): Record<Chain, { tokens: number; queued: number; backoff: boolean }> {
    const status: any = {};
    for (const [chain] of this.configs) {
      status[chain] = {
        tokens: this.tokens.get(chain) || 0,
        queued: this.queues.get(chain)?.length || 0,
        backoff: Date.now() < (this.backoffUntil.get(chain) || 0),
      };
    }
    return status;
  }

  /**
   * Stop all processors
   */
  stop(): void {
    for (const interval of this.processingIntervals.values()) {
      clearInterval(interval);
    }
    this.processingIntervals.clear();
  }
}
