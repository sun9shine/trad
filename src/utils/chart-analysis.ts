/**
 * ============================================
 * Chart Analysis - Technical Indicators
 * تحليل الرسم البياني - مؤشرات فنية
 * ============================================
 * 
 * Lightweight technical analysis before buy decisions:
 * - Volume spike detection
 * - Price momentum (ROC)
 * - Simple Moving Average crossover
 * - RSI overbought/oversold
 * - VWAP deviation
 * 
 * Note: Memecoins are highly volatile, so these are
 * supplementary signals, not primary decision criteria.
 */

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface TechnicalSignal {
  shouldBuy: boolean;
  confidence: number;      // 0-100
  indicators: {
    volumeSpike: boolean;
    priceAboveSMA: boolean;
    rsi: number;
    momentum: number;
    vwapDeviation: number;
  };
  reasoning: string;
}

export class ChartAnalyzer {
  /**
   * Analyze price data and return a technical signal
   * تحليل بيانات السعر وإرجاع إشارة فنية
   */
  analyze(candles: CandleData[], currentPrice: number): TechnicalSignal {
    if (candles.length < 5) {
      // Not enough data for analysis - default to buy (speed matters)
      return {
        shouldBuy: true,
        confidence: 50,
        indicators: {
          volumeSpike: true,
          priceAboveSMA: true,
          rsi: 50,
          momentum: 0,
          vwapDeviation: 0,
        },
        reasoning: 'Insufficient data - proceeding with caution',
      };
    }

    const volumeSpike = this.detectVolumeSpike(candles);
    const sma = this.calculateSMA(candles, Math.min(candles.length, 10));
    const priceAboveSMA = currentPrice > sma;
    const rsi = this.calculateRSI(candles, Math.min(candles.length, 14));
    const momentum = this.calculateMomentum(candles, 5);
    const vwapDeviation = this.calculateVWAPDeviation(candles, currentPrice);

    // Score calculation
    let score = 50; // Neutral start
    if (volumeSpike) score += 15;
    if (priceAboveSMA) score += 10;
    if (rsi > 30 && rsi < 70) score += 10; // Not overbought/oversold
    if (rsi < 30) score += 5; // Oversold = buy opportunity
    if (rsi > 80) score -= 20; // Overbought = risky
    if (momentum > 0) score += 10;
    if (vwapDeviation > -5 && vwapDeviation < 20) score += 5;

    const shouldBuy = score >= 55;
    const confidence = Math.min(100, Math.max(0, score));

    let reasoning = '';
    if (volumeSpike) reasoning += 'Volume spike detected. ';
    if (priceAboveSMA) reasoning += 'Price above SMA. ';
    if (rsi < 30) reasoning += 'RSI oversold (bullish). ';
    if (rsi > 80) reasoning += 'RSI overbought (bearish). ';
    if (momentum > 0) reasoning += 'Positive momentum. ';

    return {
      shouldBuy,
      confidence,
      indicators: { volumeSpike, priceAboveSMA, rsi, momentum, vwapDeviation },
      reasoning: reasoning || 'Neutral conditions',
    };
  }

  /**
   * Detect abnormal volume spike (3x average)
   */
  private detectVolumeSpike(candles: CandleData[]): boolean {
    if (candles.length < 3) return true;
    
    const recentVolume = candles[candles.length - 1].volume;
    const avgVolume = candles.slice(0, -1).reduce((s, c) => s + c.volume, 0) / (candles.length - 1);
    
    return recentVolume > avgVolume * 3;
  }

  /**
   * Simple Moving Average
   */
  private calculateSMA(candles: CandleData[], period: number): number {
    const slice = candles.slice(-period);
    return slice.reduce((sum, c) => sum + c.close, 0) / slice.length;
  }

  /**
   * Relative Strength Index (RSI)
   */
  private calculateRSI(candles: CandleData[], period: number): number {
    if (candles.length < 2) return 50;

    let gains = 0, losses = 0;
    const slice = candles.slice(-period);

    for (let i = 1; i < slice.length; i++) {
      const change = slice[i].close - slice[i - 1].close;
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    if (losses === 0) return 100;
    const rs = (gains / period) / (losses / period);
    return 100 - (100 / (1 + rs));
  }

  /**
   * Rate of Change (Momentum)
   */
  private calculateMomentum(candles: CandleData[], lookback: number): number {
    if (candles.length < lookback + 1) return 0;
    const current = candles[candles.length - 1].close;
    const past = candles[candles.length - 1 - lookback].close;
    return past > 0 ? ((current - past) / past) * 100 : 0;
  }

  /**
   * Volume Weighted Average Price deviation
   */
  private calculateVWAPDeviation(candles: CandleData[], currentPrice: number): number {
    let totalVP = 0, totalVolume = 0;
    for (const c of candles) {
      const typical = (c.high + c.low + c.close) / 3;
      totalVP += typical * c.volume;
      totalVolume += c.volume;
    }
    
    if (totalVolume === 0) return 0;
    const vwap = totalVP / totalVolume;
    return ((currentPrice - vwap) / vwap) * 100;
  }
}
