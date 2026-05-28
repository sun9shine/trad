/**
 * ============================================
 * Configuration Manager
 * مدير التكوين
 * ============================================
 * 
 * Centralizes all environment variables and runtime configuration.
 * Validates required settings on startup and provides typed access.
 */

import * as dotenv from 'dotenv';
import { Locale } from '../i18n';

dotenv.config();

// ---- Helper: Read env with fallback ----
function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`[CONFIG] Missing required environment variable: ${key}`);
  }
  return value;
}

function envNum(key: string, fallback?: number): number {
  const raw = process.env[key];
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`[CONFIG] Missing required environment variable: ${key}`);
  }
  return Number(raw);
}

function envBool(key: string, fallback: boolean = false): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

// ---- Exported Configuration Object ----
export const config = {
  // --- General ---
  language: (env('LANGUAGE', 'en') as Locale),
  tradingMode: env('TRADING_MODE', 'paper') as 'live' | 'paper',
  isPaperTrading: env('TRADING_MODE', 'paper') === 'paper',

  // --- Solana ---
  solana: {
    rpcUrl: env('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
    wsUrl: env('SOLANA_WS_URL', 'wss://api.mainnet-beta.solana.com'),
    grpcUrl: env('SOLANA_GRPC_URL', ''),
    grpcToken: env('SOLANA_GRPC_TOKEN', ''),
    privateKey: env('SOLANA_PRIVATE_KEY', ''),
    jito: {
      blockEngineUrl: env('JITO_BLOCK_ENGINE_URL', 'https://mainnet.block-engine.jito.wtf'),
      tipAccount: env('JITO_TIP_ACCOUNT', '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'),
      defaultTipLamports: envNum('JITO_DEFAULT_TIP_LAMPORTS', 10000),
    },
  },

  // --- Base (EVM L2) ---
  base: {
    rpcUrl: env('BASE_RPC_URL', 'https://mainnet.base.org'),
    wsUrl: env('BASE_WS_URL', ''),
    privateKey: env('BASE_PRIVATE_KEY', ''),
    flashbotsRpc: env('BASE_FLASHBOTS_RPC', 'https://rpc.flashbots.net'),
    maxPriorityFeeGwei: envNum('BASE_MAX_PRIORITY_FEE_GWEI', 50),
  },

  // --- Sui ---
  sui: {
    rpcUrl: env('SUI_RPC_URL', 'https://fullnode.mainnet.sui.io:443'),
    wsUrl: env('SUI_WS_URL', 'wss://fullnode.mainnet.sui.io'),
    privateKey: env('SUI_PRIVATE_KEY', ''),
  },

  // --- BNB Chain ---
  bnb: {
    rpcUrl: env('BNB_RPC_URL', 'https://bsc-dataseed1.binance.org'),
    wsUrl: env('BNB_WS_URL', ''),
    privateKey: env('BNB_PRIVATE_KEY', ''),
  },

  // --- Hyperliquid ---
  hyperliquid: {
    rpcUrl: env('HYPERLIQUID_RPC_URL', 'https://api.hyperliquid.xyz'),
    privateKey: env('HYPERLIQUID_PRIVATE_KEY', ''),
  },

  // --- Telegram ---
  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN', ''),
    chatId: env('TELEGRAM_CHAT_ID', ''),
  },

  // --- Risk Management ---
  risk: {
    maxBuyAmountSol: envNum('MAX_BUY_AMOUNT_SOL', 0.5),
    maxBuyAmountEth: envNum('MAX_BUY_AMOUNT_ETH', 0.1),
    maxBuyAmountSui: envNum('MAX_BUY_AMOUNT_SUI', 50),
    trailingStopPercent: envNum('TRAILING_STOP_PERCENT', 20),
    takeProfitPercent: envNum('TAKE_PROFIT_PERCENT', 100),
    maxSlippagePercent: envNum('MAX_SLIPPAGE_PERCENT', 15),
    maxGasLimitGwei: envNum('MAX_GAS_LIMIT_GWEI', 100),
  },

  // --- Security Thresholds ---
  security: {
    minLiquidityUsd: envNum('MIN_LIQUIDITY_USD', 5000),
    maxTop10HolderPercent: envNum('MAX_TOP10_HOLDER_PERCENT', 15),
    requireMintRevoked: envBool('REQUIRE_MINT_REVOKED', true),
    requireLpLocked: envBool('REQUIRE_LP_LOCKED', true),
    maxAuditTimeMs: envNum('MAX_AUDIT_TIME_MS', 5),
  },

  // --- External APIs ---
  apis: {
    rugcheck: env('RUGCHECK_API_URL', 'https://api.rugcheck.xyz/v1'),
    honeypot: env('HONEYPOT_API_URL', 'https://api.honeypot.is/v2'),
    goplus: env('GOPLUS_API_URL', 'https://api.gopluslabs.io/api/v1'),
  },
} as const;

export type Config = typeof config;
export type ChainConfig = typeof config.solana | typeof config.base | typeof config.sui;
