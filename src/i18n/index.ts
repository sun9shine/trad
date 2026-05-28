/**
 * ============================================
 * i18n Manager - Localization Engine
 * مدير الترجمة - محرك التوطين
 * ============================================
 * 
 * Provides runtime translation with string interpolation.
 * Supports dynamic locale switching between Arabic and English.
 */

import { Locale, TranslationStrings, TranslationKey, NestedTranslationKey } from './types';
import { en } from './en';
import { ar } from './ar';

const translations: Record<Locale, TranslationStrings> = { en, ar };

class I18nManager {
  private locale: Locale;
  private strings: TranslationStrings;

  constructor(locale: Locale = 'en') {
    this.locale = locale;
    this.strings = translations[locale];
  }

  /**
   * Switch the active locale at runtime
   * تبديل اللغة أثناء التشغيل
   */
  setLocale(locale: Locale): void {
    this.locale = locale;
    this.strings = translations[locale];
  }

  /**
   * Get current locale
   */
  getLocale(): Locale {
    return this.locale;
  }

  /**
   * Translate a key with optional parameter interpolation
   * ترجمة مفتاح مع استبدال المتغيرات
   * 
   * @example
   * t('sniper', 'sniped', { tx: '0x123...' })
   * // EN: [SUCCESS] Token Sniped! Hash: 0x123... | Anti-Rug Active
   * // AR: [نجاح] تم قنص العملة! الهاش: 0x123... | نظام الحماية من السحب نشط
   */
  t<K extends TranslationKey>(
    category: K,
    key: NestedTranslationKey<K>,
    params?: Record<string, string | number>
  ): string {
    const template = (this.strings[category] as any)[key] as string;
    
    if (!template) {
      return `[MISSING_TRANSLATION: ${String(category)}.${String(key)}]`;
    }

    if (!params) return template;

    // Replace {param} placeholders with actual values
    return template.replace(/\{(\w+)\}/g, (_, paramKey) => {
      return params[paramKey]?.toString() ?? `{${paramKey}}`;
    });
  }

  /**
   * Get all available translation keys for a category
   */
  getKeys<K extends TranslationKey>(category: K): Array<NestedTranslationKey<K>> {
    return Object.keys(this.strings[category]) as Array<NestedTranslationKey<K>>;
  }
}

// Singleton instance - shared across all modules
export const i18n = new I18nManager(
  (process.env.LANGUAGE as Locale) || 'en'
);

export { I18nManager, Locale, TranslationStrings, TranslationKey };
