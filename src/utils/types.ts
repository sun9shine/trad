/**
 * ============================================
 * Shared Type Definitions
 * تعريفات الأنواع المشتركة
 * ============================================
 */

export type Chain = 'solana' | 'base' | 'sui' | 'bnb' | 'hyperliquid';

export type DEX = 
  | 'raydium' | 'pumpfun'           // Solana
  | 'uniswap_v3' | 'aerodrome' | 'virtuals'  // Base
  | 'cetus' | 'bluemove'            // Sui
  | 'pancakeswap'                   // BNB
  | 'hyperliquid_native';           // Hyperliquid

export interface TokenInfo {
  address: string;
  chain: Chain;
  dex: DEX;
  name?: string;
  symbol?: string;
  decimals: number;
  deployer: string;
  poolAddress: string;
  pairToken: string;       // SOL, ETH, SUI etc.
  liquidity: number;       // In USD
  createdAt: number;       // Unix timestamp
  blockNumber?: number;
  txHash: string;
}

export interface AuditResult {
  token: string;
  chain: Chain;
  passed: boolean;
  auditTimeMs: number;
  checks: {
    mintRevoked: boolean;
    lpLocked: boolean;
    honeypot: boolean;
    topHoldersPercent: number;
    bundledWallets: number;
    ownershipRenounced: boolean;
    liquidityUsd: number;
  };
  failReasons: string[];
}

export interface TradeSignal {
  token: TokenInfo;
  audit: AuditResult;
  action: 'buy' | 'sell' | 'emergency_sell';
  amount: number;
  maxSlippage: number;
  priority: 'high' | 'medium' | 'low';
  timestamp: number;
}

export interface Position {
  id: string;
  token: TokenInfo;
  chain: Chain;
  entryPrice: number;
  currentPrice: number;
  amount: number;
  entryTx: string;
  entryTime: number;
  stopLoss: number;
  takeProfit: number;
  trailingStop: number;
  highestPrice: number;
  pnl: number;
  pnlPercent: number;
  status: 'open' | 'closed' | 'emergency_closed';
}

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  error?: string;
  gasUsed?: number;
  effectivePrice?: number;
  slippage?: number;
  chain: Chain;
  timestamp: number;
}

export interface MempoolTransaction {
  hash: string;
  from: string;
  to: string;
  data: string;
  value: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  chain: Chain;
  type: 'removeLiquidity' | 'sell' | 'transfer' | 'unknown';
  tokenAddress?: string;
}

export interface BundleConfig {
  transactions: Uint8Array[];
  tipLamports: number;
  maxRetries: number;
  timeout: number;
}
