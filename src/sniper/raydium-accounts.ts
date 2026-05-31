/**
 * ============================================
 * Raydium AMM V4 Account Resolver
 * محلل حسابات Raydium AMM V4
 * ============================================
 * 
 * Resolves ALL 17+ accounts required for a Raydium swap instruction.
 * Parses the on-chain pool state to extract vault addresses, 
 * OpenBook market accounts, and authority PDAs.
 */

import {
  Connection,
  PublicKey,
  AccountInfo,
} from '@solana/web3.js';
import { config } from '../config';
import { SOLANA } from '../utils/constants';
import { logger } from '../utils/logger';
import { i18n } from '../i18n';

// ---- Raydium AMM V4 Pool State Layout ----
// Total size: 752 bytes
const AMM_V4_LAYOUT = {
  status: 0,               // u64 (8)
  nonce: 8,                // u64 (8)
  orderNum: 16,            // u64 (8)
  depth: 24,               // u64 (8)
  coinDecimals: 32,        // u64 (8)
  pcDecimals: 40,          // u64 (8)
  state: 48,               // u64 (8)
  resetFlag: 56,           // u64 (8)
  minSize: 64,             // u64 (8)
  volMaxCutRatio: 72,      // u64 (8)
  amountWaveRatio: 80,     // u64 (8)
  coinLotSize: 88,         // u64 (8)
  pcLotSize: 96,           // u64 (8)
  minPriceMultiplier: 104, // u64 (8)
  maxPriceMultiplier: 112, // u64 (8)
  systemDecimalsValue: 120,// u64 (8)
  // Fees
  minSeparateNumerator: 128,   // u64
  minSeparateDenominator: 136, // u64
  tradeFeeNumerator: 144,      // u64
  tradeFeeDenominator: 152,    // u64
  pnlNumerator: 160,           // u64
  pnlDenominator: 168,         // u64
  swapFeeNumerator: 176,       // u64
  swapFeeDenominator: 184,     // u64
  // Constraints
  needTakePnlCoin: 192,   // u64
  needTakePnlPc: 200,     // u64
  totalPnlPc: 208,        // u64
  totalPnlCoin: 216,      // u64
  poolOpenTime: 224,       // u64
  punishPcAmount: 232,    // u64
  punishCoinAmount: 240,  // u64
  orderbookToInitTime: 248, // u64
  // Pool token mints and vaults
  swapCoinInAmount: 256,   // u128 (16)
  swapPcOutAmount: 272,    // u128 (16)
  swapCoin2PcFee: 288,    // u64
  swapPcInAmount: 296,    // u128 (16)
  swapCoinOutAmount: 312,  // u128 (16)
  swapPc2CoinFee: 328,    // u64
  // Key accounts
  poolCoinTokenAccount: 336, // Pubkey (32) - Token vault for coin
  poolPcTokenAccount: 368,   // Pubkey (32) - Token vault for PC
  coinMintAddress: 400,      // Pubkey (32) - Coin mint
  pcMintAddress: 432,        // Pubkey (32) - PC mint (quote)
  lpMintAddress: 464,        // Pubkey (32) - LP token mint
  ammOpenOrders: 496,        // Pubkey (32) - OpenBook open orders
  serumMarket: 528,          // Pubkey (32) - OpenBook market
  serumProgramId: 560,       // Pubkey (32) - OpenBook/Serum program
  ammTargetOrders: 592,      // Pubkey (32) - Target orders account
  poolWithdrawQueue: 624,    // Pubkey (32) - Withdraw queue
  poolTempLpTokenAccount: 656, // Pubkey (32) - Temp LP account
  ammOwner: 688,             // Pubkey (32) - AMM owner
  pnlOwner: 720,            // Pubkey (32) - PnL owner
} as const;

// ---- OpenBook Market State Layout (first relevant fields) ----
const MARKET_LAYOUT = {
  // Skip padding/headers
  ownAddress: 13,        // Pubkey (32)
  vaultSignerNonce: 45,  // u64 (8)
  baseMint: 53,          // Pubkey (32)
  quoteMint: 85,         // Pubkey (32)
  baseVault: 117,        // Pubkey (32) - Serum base vault
  baseDepositsTotal: 149, // u64 (8)
  baseFeesAccrued: 157,  // u64 (8)
  quoteVault: 165,       // Pubkey (32) - Serum quote vault
  quoteDepositsTotal: 197, // u64 (8)
  quoteFeesAccrued: 205,   // u64 (8)
  quoteDustThreshold: 213, // u64 (8)
  requestQueue: 221,       // Pubkey (32)
  eventQueue: 253,         // Pubkey (32) - Event queue
  bids: 285,               // Pubkey (32) - Bids orderbook
  asks: 317,               // Pubkey (32) - Asks orderbook
} as const;

export interface RaydiumSwapAccounts {
  // Token program
  tokenProgram: PublicKey;
  // AMM accounts
  ammId: PublicKey;
  ammAuthority: PublicKey;
  ammOpenOrders: PublicKey;
  ammTargetOrders: PublicKey;
  // Pool vaults
  poolCoinTokenAccount: PublicKey;
  poolPcTokenAccount: PublicKey;
  // OpenBook/Serum
  serumProgramId: PublicKey;
  serumMarket: PublicKey;
  serumBids: PublicKey;
  serumAsks: PublicKey;
  serumEventQueue: PublicKey;
  serumCoinVault: PublicKey;
  serumPcVault: PublicKey;
  serumVaultSigner: PublicKey;
  // User accounts
  userSourceToken: PublicKey;
  userDestinationToken: PublicKey;
  userOwner: PublicKey;
}

export interface PoolState {
  coinMint: PublicKey;
  pcMint: PublicKey;
  lpMint: PublicKey;
  poolCoinVault: PublicKey;
  poolPcVault: PublicKey;
  ammOpenOrders: PublicKey;
  serumMarket: PublicKey;
  serumProgramId: PublicKey;
  ammTargetOrders: PublicKey;
  coinDecimals: number;
  pcDecimals: number;
  poolOpenTime: number;
}

export class RaydiumAccountResolver {
  private connection: Connection;
  private poolStateCache: Map<string, PoolState> = new Map();

  constructor(connection?: Connection) {
    this.connection = connection || new Connection(config.solana.rpcUrl, {
      commitment: 'confirmed',
    });
  }

  /**
   * Resolve ALL accounts needed for a Raydium AMM V4 swap
   * حل جميع الحسابات المطلوبة لتبادل Raydium AMM V4
   * 
   * @param poolAddress - The AMM pool ID
   * @param userWallet - The user's wallet public key
   * @param isBuy - true if buying token (SOL→Token), false if selling (Token→SOL)
   */
  async resolveSwapAccounts(
    poolAddress: string,
    userWallet: PublicKey,
    isBuy: boolean
  ): Promise<RaydiumSwapAccounts> {
    // Step 1: Parse pool state
    const poolState = await this.getPoolState(poolAddress);
    
    // Step 2: Parse OpenBook market state for vault addresses
    const marketState = await this.getMarketState(poolState.serumMarket.toBase58());
    
    // Step 3: Derive AMM authority PDA
    const ammAuthority = this.deriveAmmAuthority();
    
    // Step 4: Derive Serum vault signer
    const serumVaultSigner = await this.deriveSerumVaultSigner(
      poolState.serumMarket,
      poolState.serumProgramId
    );

    // Step 5: Resolve user token accounts (ATA)
    const { sourceToken, destToken } = await this.resolveUserTokenAccounts(
      userWallet,
      poolState.coinMint,
      poolState.pcMint,
      isBuy
    );

    return {
      tokenProgram: new PublicKey(SOLANA.TOKEN_PROGRAM),
      ammId: new PublicKey(poolAddress),
      ammAuthority,
      ammOpenOrders: poolState.ammOpenOrders,
      ammTargetOrders: poolState.ammTargetOrders,
      poolCoinTokenAccount: poolState.poolCoinVault,
      poolPcTokenAccount: poolState.poolPcVault,
      serumProgramId: poolState.serumProgramId,
      serumMarket: poolState.serumMarket,
      serumBids: marketState.bids,
      serumAsks: marketState.asks,
      serumEventQueue: marketState.eventQueue,
      serumCoinVault: marketState.baseVault,
      serumPcVault: marketState.quoteVault,
      serumVaultSigner,
      userSourceToken: sourceToken,
      userDestinationToken: destToken,
      userOwner: userWallet,
    };
  }

  /**
   * Parse Raydium AMM V4 pool state from on-chain account data
   * تحليل حالة تجمع Raydium AMM V4 من بيانات الحساب
   */
  async getPoolState(poolAddress: string): Promise<PoolState> {
    // Check cache first
    const cached = this.poolStateCache.get(poolAddress);
    if (cached) return cached;

    const accountInfo = await this.connection.getAccountInfo(new PublicKey(poolAddress));
    if (!accountInfo || !accountInfo.data) {
      throw new Error(`Pool account not found: ${poolAddress}`);
    }

    const data = accountInfo.data;

    const poolState: PoolState = {
      coinMint: new PublicKey(data.slice(AMM_V4_LAYOUT.coinMintAddress, AMM_V4_LAYOUT.coinMintAddress + 32)),
      pcMint: new PublicKey(data.slice(AMM_V4_LAYOUT.pcMintAddress, AMM_V4_LAYOUT.pcMintAddress + 32)),
      lpMint: new PublicKey(data.slice(AMM_V4_LAYOUT.lpMintAddress, AMM_V4_LAYOUT.lpMintAddress + 32)),
      poolCoinVault: new PublicKey(data.slice(AMM_V4_LAYOUT.poolCoinTokenAccount, AMM_V4_LAYOUT.poolCoinTokenAccount + 32)),
      poolPcVault: new PublicKey(data.slice(AMM_V4_LAYOUT.poolPcTokenAccount, AMM_V4_LAYOUT.poolPcTokenAccount + 32)),
      ammOpenOrders: new PublicKey(data.slice(AMM_V4_LAYOUT.ammOpenOrders, AMM_V4_LAYOUT.ammOpenOrders + 32)),
      serumMarket: new PublicKey(data.slice(AMM_V4_LAYOUT.serumMarket, AMM_V4_LAYOUT.serumMarket + 32)),
      serumProgramId: new PublicKey(data.slice(AMM_V4_LAYOUT.serumProgramId, AMM_V4_LAYOUT.serumProgramId + 32)),
      ammTargetOrders: new PublicKey(data.slice(AMM_V4_LAYOUT.ammTargetOrders, AMM_V4_LAYOUT.ammTargetOrders + 32)),
      coinDecimals: Number(data.readBigUInt64LE(AMM_V4_LAYOUT.coinDecimals)),
      pcDecimals: Number(data.readBigUInt64LE(AMM_V4_LAYOUT.pcDecimals)),
      poolOpenTime: Number(data.readBigUInt64LE(AMM_V4_LAYOUT.poolOpenTime)),
    };

    // Cache the pool state
    this.poolStateCache.set(poolAddress, poolState);
    return poolState;
  }

  /**
   * Parse OpenBook market state for vault and orderbook addresses
   */
  private async getMarketState(marketAddress: string): Promise<{
    bids: PublicKey;
    asks: PublicKey;
    eventQueue: PublicKey;
    baseVault: PublicKey;
    quoteVault: PublicKey;
    vaultSignerNonce: bigint;
  }> {
    const accountInfo = await this.connection.getAccountInfo(new PublicKey(marketAddress));
    if (!accountInfo || !accountInfo.data) {
      throw new Error(`Market account not found: ${marketAddress}`);
    }

    const data = accountInfo.data;

    return {
      bids: new PublicKey(data.slice(MARKET_LAYOUT.bids, MARKET_LAYOUT.bids + 32)),
      asks: new PublicKey(data.slice(MARKET_LAYOUT.asks, MARKET_LAYOUT.asks + 32)),
      eventQueue: new PublicKey(data.slice(MARKET_LAYOUT.eventQueue, MARKET_LAYOUT.eventQueue + 32)),
      baseVault: new PublicKey(data.slice(MARKET_LAYOUT.baseVault, MARKET_LAYOUT.baseVault + 32)),
      quoteVault: new PublicKey(data.slice(MARKET_LAYOUT.quoteVault, MARKET_LAYOUT.quoteVault + 32)),
      vaultSignerNonce: data.readBigUInt64LE(MARKET_LAYOUT.vaultSignerNonce),
    };
  }

  /**
   * Derive AMM authority PDA
   * اشتقاق PDA صلاحية AMM
   */
  private deriveAmmAuthority(): PublicKey {
    const [authority] = PublicKey.findProgramAddressSync(
      [Buffer.from('amm authority')],  // Raydium uses this seed
      new PublicKey(SOLANA.RAYDIUM_AMM_V4)
    );
    return authority;
  }

  /**
   * Derive OpenBook/Serum vault signer from market and nonce
   */
  private async deriveSerumVaultSigner(
    market: PublicKey,
    programId: PublicKey
  ): Promise<PublicKey> {
    // Get market nonce from market state
    const accountInfo = await this.connection.getAccountInfo(market);
    if (!accountInfo) throw new Error('Cannot read market for vault signer');
    
    const nonce = accountInfo.data.readBigUInt64LE(MARKET_LAYOUT.vaultSignerNonce);
    
    // Create vault signer from nonce
    const vaultSigner = await PublicKey.createProgramAddress(
      [
        market.toBuffer(),
        this.bigintToLeBuffer(nonce, 8),
      ],
      programId
    );
    
    return vaultSigner;
  }

  /**
   * Resolve user's Associated Token Accounts for the swap
   */
  private async resolveUserTokenAccounts(
    userWallet: PublicKey,
    coinMint: PublicKey,
    pcMint: PublicKey,
    isBuy: boolean
  ): Promise<{ sourceToken: PublicKey; destToken: PublicKey }> {
    const ATA_PROGRAM = new PublicKey(SOLANA.ASSOCIATED_TOKEN_PROGRAM);
    const TOKEN_PROGRAM = new PublicKey(SOLANA.TOKEN_PROGRAM);

    // For buy (SOL→Token): source = PC vault (SOL/WSOL), dest = coin ATA
    // For sell (Token→SOL): source = coin ATA, dest = PC vault (SOL/WSOL)
    
    const coinAta = PublicKey.findProgramAddressSync(
      [userWallet.toBuffer(), TOKEN_PROGRAM.toBuffer(), coinMint.toBuffer()],
      ATA_PROGRAM
    )[0];

    const pcAta = PublicKey.findProgramAddressSync(
      [userWallet.toBuffer(), TOKEN_PROGRAM.toBuffer(), pcMint.toBuffer()],
      ATA_PROGRAM
    )[0];

    if (isBuy) {
      return { sourceToken: pcAta, destToken: coinAta };
    } else {
      return { sourceToken: coinAta, destToken: pcAta };
    }
  }

  /**
   * Convert BigInt to little-endian buffer
   */
  private bigintToLeBuffer(value: bigint, bytes: number): Buffer {
    const buffer = Buffer.alloc(bytes);
    for (let i = 0; i < bytes; i++) {
      buffer[i] = Number(value & 0xFFn);
      value >>= 8n;
    }
    return buffer;
  }

  /**
   * Clear pool state cache
   */
  clearCache(): void {
    this.poolStateCache.clear();
  }

  /**
   * Get LP mint address from pool state
   */
  async getLPMint(poolAddress: string): Promise<PublicKey> {
    const state = await this.getPoolState(poolAddress);
    return state.lpMint;
  }
}
