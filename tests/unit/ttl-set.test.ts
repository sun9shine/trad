/**
 * ============================================
 * Unit Tests - TTL Set
 * اختبارات الوحدة - مجموعة TTL
 * ============================================
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TTLSet } from '../../src/utils/ttl-set';

describe('TTLSet', () => {
  let set: TTLSet<string>;

  beforeEach(() => {
    set = new TTLSet<string>(1000, 100); // 1 second TTL, max 100
  });

  afterEach(() => {
    set.destroy();
  });

  it('should add and check items', () => {
    set.add('token1');
    expect(set.has('token1')).toBe(true);
    expect(set.has('token2')).toBe(false);
  });

  it('should report correct size', () => {
    set.add('a');
    set.add('b');
    set.add('c');
    expect(set.size).toBe(3);
  });

  it('should expire items after TTL', async () => {
    const shortSet = new TTLSet<string>(50, 100); // 50ms TTL
    shortSet.add('expire-me');
    expect(shortSet.has('expire-me')).toBe(true);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(shortSet.has('expire-me')).toBe(false);
    shortSet.destroy();
  });

  it('should handle max size with eviction', () => {
    const smallSet = new TTLSet<string>(60000, 10); // Max 10
    for (let i = 0; i < 15; i++) {
      smallSet.add(`item_${i}`);
    }
    // Should have evicted some entries
    expect(smallSet.size).toBeLessThanOrEqual(15);
    smallSet.destroy();
  });

  it('should delete items', () => {
    set.add('removable');
    expect(set.has('removable')).toBe(true);
    set.delete('removable');
    expect(set.has('removable')).toBe(false);
  });

  it('should clear all items', () => {
    set.add('a');
    set.add('b');
    set.clear();
    expect(set.size).toBe(0);
  });
});
