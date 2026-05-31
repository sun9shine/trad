/**
 * ============================================
 * Unit Tests - i18n Translation System
 * اختبارات الوحدة - نظام الترجمة
 * ============================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { I18nManager } from '../../src/i18n';

describe('I18nManager', () => {
  let i18n: I18nManager;

  beforeEach(() => {
    i18n = new I18nManager('en');
  });

  it('should return English translations by default', () => {
    const msg = i18n.t('sniper', 'sniped', { tx: '0x123' });
    expect(msg).toContain('SUCCESS');
    expect(msg).toContain('0x123');
  });

  it('should switch to Arabic', () => {
    i18n.setLocale('ar');
    const msg = i18n.t('sniper', 'sniped', { tx: '0xABC' });
    expect(msg).toContain('نجاح');
    expect(msg).toContain('0xABC');
  });

  it('should interpolate multiple parameters', () => {
    const msg = i18n.t('sniper', 'buyExecuted', {
      amount: '1.5',
      token: 'PEPE',
      price: '0.0001',
      tx: '0xDEF',
    });
    expect(msg).toContain('1.5');
    expect(msg).toContain('PEPE');
    expect(msg).toContain('0.0001');
    expect(msg).toContain('0xDEF');
  });

  it('should handle missing parameters gracefully', () => {
    const msg = i18n.t('sniper', 'sniped');
    expect(msg).toContain('{tx}'); // Unreplaced placeholder
  });

  it('should handle missing keys', () => {
    const msg = i18n.t('sniper', 'nonexistent' as any);
    expect(msg).toContain('MISSING_TRANSLATION');
  });

  it('should report current locale', () => {
    expect(i18n.getLocale()).toBe('en');
    i18n.setLocale('ar');
    expect(i18n.getLocale()).toBe('ar');
  });
});
