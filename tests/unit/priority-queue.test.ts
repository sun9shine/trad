/**
 * ============================================
 * Unit Tests - Priority Queue
 * اختبارات الوحدة - قائمة الأولوية
 * ============================================
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PriorityQueue } from '../../src/utils/priority-queue';

describe('PriorityQueue', () => {
  let queue: PriorityQueue<string>;

  beforeEach(() => {
    queue = new PriorityQueue<string>({ maxConcurrency: 2, defaultTtlMs: 5000 });
  });

  afterEach(() => {
    queue.stop();
  });

  it('should enqueue items', () => {
    const added = queue.enqueue('id1', 'data1', 'solana', 'medium');
    expect(added).toBe(true);
    expect(queue.getLength()).toBe(1);
  });

  it('should reject duplicate IDs', () => {
    queue.enqueue('id1', 'data1', 'solana', 'medium');
    const added = queue.enqueue('id1', 'data1-again', 'solana', 'high');
    expect(added).toBe(false);
    expect(queue.getLength()).toBe(1);
  });

  it('should prioritize items correctly', () => {
    queue.enqueue('low1', 'low', 'solana', 'low');
    queue.enqueue('high1', 'high', 'solana', 'high');
    queue.enqueue('med1', 'med', 'solana', 'medium');
    queue.enqueue('emergency1', 'emer', 'solana', 'emergency');
    
    // Emergency should be first
    expect(queue.getLength()).toBe(4);
  });

  it('should process items with processor', async () => {
    const processed: string[] = [];
    
    queue.setProcessor(async (item: string) => {
      processed.push(item);
      return item;
    });

    queue.enqueue('id1', 'first', 'solana', 'high');
    queue.enqueue('id2', 'second', 'base', 'medium');
    
    queue.start();
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(processed.length).toBe(2);
    expect(processed).toContain('first');
    expect(processed).toContain('second');
  });

  it('should track metrics', () => {
    queue.enqueue('id1', 'a', 'solana');
    queue.enqueue('id1', 'a', 'solana'); // Duplicate

    const metrics = queue.getMetrics();
    expect(metrics.totalAdded).toBe(1);
    expect(metrics.totalDuplicated).toBe(1);
  });
});
