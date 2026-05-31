/**
 * ============================================
 * Priority Queue - Smart Token Processing
 * قائمة أولوية ذكية - معالجة العملات
 * ============================================
 * 
 * Processes discovered tokens by priority:
 * - Emergency (anti-rug sells)
 * - High (migration snipes, Pump.fun graduates)
 * - Medium (new Raydium/Uniswap pools)
 * - Low (general discoveries)
 * 
 * Features:
 * - Configurable concurrency per chain
 * - Deduplication
 * - TTL expiry for stale entries
 * - Metrics tracking
 */

import EventEmitter from 'eventemitter3';
import { TokenInfo, TradeSignal, Chain } from './types';
import { logger } from './logger';
import { i18n } from '../i18n';

type Priority = 'emergency' | 'high' | 'medium' | 'low';

interface QueueItem<T> {
  id: string;
  data: T;
  priority: Priority;
  chain: Chain;
  addedAt: number;
  ttlMs: number;
  retries: number;
  maxRetries: number;
}

interface QueueConfig {
  maxConcurrency: number;
  defaultTtlMs: number;
  maxRetries: number;
  processingTimeoutMs: number;
}

interface QueueEvents {
  'item:processed': (item: QueueItem<any>, result: any) => void;
  'item:failed': (item: QueueItem<any>, error: Error) => void;
  'item:expired': (item: QueueItem<any>) => void;
  'queue:empty': () => void;
}

const PRIORITY_WEIGHTS: Record<Priority, number> = {
  emergency: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const DEFAULT_CONFIG: QueueConfig = {
  maxConcurrency: 3,
  defaultTtlMs: 30_000,  // 30 seconds
  maxRetries: 2,
  processingTimeoutMs: 10_000,
};

export class PriorityQueue<T = TokenInfo> extends EventEmitter<QueueEvents> {
  private items: QueueItem<T>[] = [];
  private processing: Set<string> = new Set();
  private processed: Set<string> = new Set();
  private config: QueueConfig;
  private processInterval: NodeJS.Timeout | null = null;
  private processor: ((item: T) => Promise<any>) | null = null;
  private isRunning: boolean = false;

  // Metrics
  private metrics = {
    totalAdded: 0,
    totalProcessed: 0,
    totalFailed: 0,
    totalExpired: 0,
    totalDuplicated: 0,
  };

  constructor(config?: Partial<QueueConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the processor function for queue items
   * تعيين دالة المعالجة لعناصر القائمة
   */
  setProcessor(fn: (item: T) => Promise<any>): void {
    this.processor = fn;
  }

  /**
   * Start processing the queue
   */
  start(): void {
    this.isRunning = true;
    this.processInterval = setInterval(() => this.tick(), 50);
  }

  /**
   * Add an item to the queue
   * إضافة عنصر إلى القائمة
   */
  enqueue(
    id: string,
    data: T,
    chain: Chain,
    priority: Priority = 'medium',
    ttlMs?: number
  ): boolean {
    // Deduplication check
    if (this.processed.has(id) || this.processing.has(id)) {
      this.metrics.totalDuplicated++;
      return false;
    }

    // Check if already in queue
    if (this.items.some(item => item.id === id)) {
      return false;
    }

    const item: QueueItem<T> = {
      id,
      data,
      priority,
      chain,
      addedAt: Date.now(),
      ttlMs: ttlMs || this.config.defaultTtlMs,
      retries: 0,
      maxRetries: this.config.maxRetries,
    };

    // Insert in priority order
    const insertIdx = this.items.findIndex(
      existing => PRIORITY_WEIGHTS[existing.priority] > PRIORITY_WEIGHTS[priority]
    );

    if (insertIdx === -1) {
      this.items.push(item);
    } else {
      this.items.splice(insertIdx, 0, item);
    }

    this.metrics.totalAdded++;
    return true;
  }

  /**
   * Process next items in the queue
   */
  private async tick(): Promise<void> {
    if (!this.isRunning || !this.processor) return;

    // Remove expired items
    this.removeExpired();

    // Process items up to concurrency limit
    while (
      this.items.length > 0 &&
      this.processing.size < this.config.maxConcurrency
    ) {
      const item = this.items.shift();
      if (!item) break;

      this.processing.add(item.id);
      this.processItem(item);
    }

    if (this.items.length === 0 && this.processing.size === 0) {
      this.emit('queue:empty');
    }
  }

  /**
   * Process a single item with timeout
   */
  private async processItem(item: QueueItem<T>): Promise<void> {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Processing timeout')), this.config.processingTimeoutMs)
      );

      const result = await Promise.race([
        this.processor!(item.data),
        timeoutPromise,
      ]);

      this.processing.delete(item.id);
      this.processed.add(item.id);
      this.metrics.totalProcessed++;
      this.emit('item:processed', item, result);
    } catch (error) {
      this.processing.delete(item.id);
      item.retries++;

      if (item.retries < item.maxRetries) {
        // Re-queue with lower priority
        this.items.push(item);
      } else {
        this.metrics.totalFailed++;
        this.emit('item:failed', item, error as Error);
      }
    }
  }

  /**
   * Remove expired items
   */
  private removeExpired(): void {
    const now = Date.now();
    const expired = this.items.filter(item => now - item.addedAt > item.ttlMs);

    for (const item of expired) {
      this.metrics.totalExpired++;
      this.emit('item:expired', item);
    }

    this.items = this.items.filter(item => now - item.addedAt <= item.ttlMs);
  }

  /**
   * Clear processed set (memory management)
   * Call periodically to prevent memory growth
   */
  clearProcessedHistory(maxAge: number = 300_000): void {
    // In production, track timestamps; here just clear if too large
    if (this.processed.size > 10_000) {
      this.processed.clear();
    }
  }

  getLength(): number { return this.items.length; }
  getProcessingCount(): number { return this.processing.size; }
  getMetrics() { return { ...this.metrics }; }

  stop(): void {
    this.isRunning = false;
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
  }
}
