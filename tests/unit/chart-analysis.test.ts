/**
 * ============================================
 * Unit Tests - Chart Analysis
 * اختبارات الوحدة - التحليل الفني
 * ============================================
 */

import { describe, it, expect } from 'vitest';
import { ChartAnalyzer, CandleData } from '../../src/utils/chart-analysis';

describe('ChartAnalyzer', () => {
  const analyzer = new ChartAnalyzer();

  function generateCandles(count: number, trend: 'up' | 'down' | 'flat'): CandleData[] {
    const candles: CandleData[] = [];
    let price = 1.0;

    for (let i = 0; i < count; i++) {
      const change = trend === 'up' ? 0.05 : trend === 'down' ? -0.05 : 0;
      price += change + (Math.random() - 0.5) * 0.02;
      price = Math.max(0.01, price);

      candles.push({
        open: price - 0.01,
        high: price + 0.02,
        low: price - 0.02,
        close: price,
        volume: 1000 + Math.random() * 500,
        timestamp: Date.now() - (count - i) * 60000,
      });
    }
    return candles;
  }

  it('should handle insufficient data', () => {
    const result = analyzer.analyze([], 1.0);
    expect(result.shouldBuy).toBe(true);
    expect(result.confidence).toBe(50);
  });

  it('should detect bullish conditions', () => {
    const candles = generateCandles(20, 'up');
    const currentPrice = candles[candles.length - 1].close * 1.02;
    const result = analyzer.analyze(candles, currentPrice);
    
    expect(result.indicators.priceAboveSMA).toBe(true);
    expect(result.indicators.momentum).toBeGreaterThan(0);
  });

  it('should detect bearish conditions', () => {
    const candles = generateCandles(20, 'down');
    const currentPrice = candles[candles.length - 1].close * 0.95;
    const result = analyzer.analyze(candles, currentPrice);
    
    expect(result.indicators.priceAboveSMA).toBe(false);
    expect(result.indicators.momentum).toBeLessThan(0);
  });

  it('should detect volume spikes', () => {
    const candles = generateCandles(10, 'flat');
    // Add a volume spike on last candle
    candles[candles.length - 1].volume = candles[0].volume * 10;
    
    const result = analyzer.analyze(candles, candles[candles.length - 1].close);
    expect(result.indicators.volumeSpike).toBe(true);
  });

  it('should return confidence between 0 and 100', () => {
    const candles = generateCandles(15, 'up');
    const result = analyzer.analyze(candles, candles[candles.length - 1].close);
    
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });
});
