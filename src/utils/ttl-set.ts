/**
 * ============================================
 * TTL Set - Memory-Safe Set with Expiry
 * مجموعة TTL - مجموعة آمنة للذاكرة مع انتهاء
 * ============================================
 * 
 * Replaces plain Set for processedTokens to prevent
 * unbounded memory growth. Entries auto-expire after TTL.
 */

export class TTLSet<T = string> {
  private entries: Map<T, number> = new Map(); // value → expiry timestamp
  private ttlMs: number;
  private maxSize: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(ttlMs: number = 300_000, maxSize: number = 50_000) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
    
    // Cleanup expired entries every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
  }

  /**
   * Add a value with TTL
   */
  add(value: T): void {
    // Evict oldest if at capacity
    if (this.entries.size >= this.maxSize) {
      this.evictOldest();
    }
    this.entries.set(value, Date.now() + this.ttlMs);
  }

  /**
   * Check if value exists and is not expired
   */
  has(value: T): boolean {
    const expiry = this.entries.get(value);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.entries.delete(value);
      return false;
    }
    return true;
  }

  /**
   * Remove a value
   */
  delete(value: T): boolean {
    return this.entries.delete(value);
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Remove all expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, expiry] of this.entries) {
      if (now > expiry) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Evict oldest entries when at max capacity
   */
  private evictOldest(): void {
    // Remove 10% of oldest entries
    const toRemove = Math.ceil(this.maxSize * 0.1);
    const sorted = [...this.entries.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      this.entries.delete(sorted[i][0]);
    }
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Stop the cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.entries.clear();
  }
}
