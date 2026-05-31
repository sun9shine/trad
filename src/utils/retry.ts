/**
 * ============================================
 * Retry Engine - Smart Transaction Retry
 * محرك إعادة المحاولة - إعادة محاولة ذكية
 * ============================================
 * 
 * Exponential backoff retry with:
 * - Configurable max attempts
 * - Jitter to prevent thundering herd
 * - Error classification (retryable vs fatal)
 * - Callback hooks for monitoring
 */

import { logger } from './logger';
import { i18n } from '../i18n';

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors?: string[];   // Error messages that are retryable
  fatalErrors?: string[];       // Error messages that should NOT be retried
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: [
    'timeout', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED',
    'rate limit', '429', '503', 'blockhash not found',
    'block height exceeded', 'Transaction simulation failed',
  ],
  fatalErrors: [
    'insufficient funds', 'insufficient balance',
    'invalid signature', 'unauthorized',
    'account not found', 'program error',
  ],
};

export class RetryEngine {
  private options: RetryOptions;

  constructor(options?: Partial<RetryOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a function with retry logic
   * تنفيذ دالة مع منطق إعادة المحاولة
   */
  async execute<T>(
    fn: () => Promise<T>,
    context?: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is fatal (no retry)
        if (this.isFatalError(lastError)) {
          throw lastError;
        }

        // Check if error is retryable
        if (!this.isRetryableError(lastError) && attempt > 1) {
          throw lastError;
        }

        // Last attempt - don't retry
        if (attempt >= this.options.maxAttempts) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(attempt);
        
        logger.warn(i18n.t('system', 'warning', {
          message: `Retry ${attempt}/${this.options.maxAttempts}${context ? ` [${context}]` : ''}: ${lastError.message} (waiting ${delay}ms)`,
        }));

        if (this.options.onRetry) {
          this.options.onRetry(attempt, lastError, delay);
        }

        await this.sleep(delay);
      }
    }

    throw lastError || new Error('Max retry attempts exceeded');
  }

  /**
   * Execute with a timeout wrapper
   */
  async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    context?: string
  ): Promise<T> {
    return this.execute(async () => {
      return Promise.race([
        fn(),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
        ),
      ]);
    }, context);
  }

  private calculateDelay(attempt: number): number {
    let delay = this.options.baseDelayMs * Math.pow(this.options.backoffMultiplier, attempt - 1);
    delay = Math.min(delay, this.options.maxDelayMs);
    
    if (this.options.jitter) {
      // Add random jitter (±25%)
      const jitterFactor = 0.75 + Math.random() * 0.5;
      delay = Math.floor(delay * jitterFactor);
    }
    
    return delay;
  }

  private isRetryableError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (this.options.retryableErrors || []).some(e => msg.includes(e.toLowerCase()));
  }

  private isFatalError(error: Error): boolean {
    const msg = error.message.toLowerCase();
    return (this.options.fatalErrors || []).some(e => msg.includes(e.toLowerCase()));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instances for common use cases
export const txRetry = new RetryEngine({ maxAttempts: 3, baseDelayMs: 300 });
export const rpcRetry = new RetryEngine({ maxAttempts: 5, baseDelayMs: 500 });
export const apiRetry = new RetryEngine({ maxAttempts: 2, baseDelayMs: 1000 });
