/**
 * ============================================
 * i18n Type Definitions
 * نظام الترجمة - تعريف الأنواع
 * ============================================
 */

export type Locale = 'en' | 'ar';

export interface TranslationStrings {
  // --- System Messages ---
  system: {
    startup: string;
    shutdown: string;
    connected: string;
    disconnected: string;
    reconnecting: string;
    error: string;
    warning: string;
    info: string;
    paperMode: string;
    liveMode: string;
  };

  // --- Scanner Messages ---
  scanner: {
    newPoolDetected: string;
    scanningToken: string;
    tokenApproved: string;
    tokenRejected: string;
    listeningChain: string;
    blockReceived: string;
  };

  // --- Security Messages ---
  security: {
    auditPassed: string;
    auditFailed: string;
    mintRevoked: string;
    mintNotRevoked: string;
    lpLocked: string;
    lpNotLocked: string;
    honeypotDetected: string;
    topHoldersRisk: string;
    bundledWalletsDetected: string;
    ownershipRenounced: string;
    ownershipNotRenounced: string;
  };

  // --- Sniper Messages ---
  sniper: {
    sniped: string;
    buyExecuted: string;
    sellExecuted: string;
    bundleSent: string;
    frontRunDetected: string;
    frontRunExecuted: string;
    transactionFailed: string;
    slippageExceeded: string;
    insufficientBalance: string;
  };

  // --- Anti-Rug Messages ---
  antiRug: {
    rugDetected: string;
    emergencySell: string;
    rugPrevented: string;
    liquidityRemovalDetected: string;
    massiveSellDetected: string;
    deployerActivity: string;
  };

  // --- Risk Management ---
  risk: {
    trailingStopHit: string;
    takeProfitHit: string;
    stopLossUpdated: string;
    positionOpened: string;
    positionClosed: string;
    pnlReport: string;
    dailyLimitReached: string;
  };

  // --- Telegram Notifications ---
  telegram: {
    botStarted: string;
    newSnipe: string;
    rugAlert: string;
    profitAlert: string;
    lossAlert: string;
    statusReport: string;
    commandHelp: string;
  };
}

export type TranslationKey = keyof TranslationStrings;
export type NestedTranslationKey<T extends TranslationKey> = keyof TranslationStrings[T];
