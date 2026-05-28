/**
 * ============================================
 * Global Constants & Known Addresses
 * الثوابت والعناوين المعروفة
 * ============================================
 */

// ---- Solana Known Programs & Addresses ----
export const SOLANA = {
  // Raydium AMM Program IDs
  RAYDIUM_AMM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CPMM: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  
  // Pump.fun
  PUMPFUN_PROGRAM: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  PUMPFUN_MIGRATION: '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg',
  
  // System
  TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ASSOCIATED_TOKEN_PROGRAM: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  SYSTEM_PROGRAM: '11111111111111111111111111111111',
  
  // Burn/Dead Addresses
  BURN_ADDRESS: '1nc1nerator11111111111111111111111111111111',
  NULL_ADDRESS: '11111111111111111111111111111111',
  
  // Jito
  JITO_TIP_ACCOUNTS: [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADaUMid9yfUytqMBgopwjb2DTLSKtCyDiGfNhDbg7iSz',
    'DfXygSm4jCyNCzbzYYRNziedMkrZnV7FWRMZqdFRGDaT',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  ],
} as const;

// ---- EVM Known Addresses (Base / BNB) ----
export const EVM = {
  // Uniswap V3 on Base
  UNISWAP_V3_FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  UNISWAP_V3_ROUTER: '0x2626664c2603336E57B271c5C0b26F421741e481',
  UNISWAP_V2_FACTORY: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  
  // Aerodrome on Base
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  
  // PancakeSwap on BNB
  PANCAKE_V3_FACTORY: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
  PANCAKE_V2_FACTORY: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
  
  // Known Dead Addresses
  DEAD_ADDRESS: '0x000000000000000000000000000000000000dEaD',
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  
  // Common Locker Contracts
  UNICRYPT_LOCKER: '0x663A5C229c09b049E36dCc11a9B0d4a8Eb9db214',
  TEAM_FINANCE_LOCKER: '0xE2fE530C047f2d85298b07D9333C05737f1435fB',
  PINKLOCK_LOCKER: '0x71B5759d73262FBb223956913ecF4ecC51057641',
  
  // Event Signatures
  PAIR_CREATED_TOPIC: '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9',
  POOL_CREATED_TOPIC: '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',
  TRANSFER_TOPIC: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  REMOVE_LIQUIDITY_SIGS: [
    '0xbaa1eb22',  // removeLiquidity
    '0x02751cec',  // removeLiquidityETH
    '0xded9382a',  // removeLiquidityETHWithPermit
    '0xaf2979eb',  // removeLiquidityETHSupportingFeeOnTransferTokens
  ],
} as const;

// ---- Sui Known Package IDs ----
export const SUI = {
  // Cetus AMM
  CETUS_CLMM_PACKAGE: '0x1eabed72c53feb73c83637733a4bcd14d5c7891c5fe5e1b7a9fd1e8db4e7e5c6',
  CETUS_FACTORY: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',
  
  // BlueMove
  BLUEMOVE_PACKAGE: '0xb24b6789e088b876afabca733bed2299fbc9e2d47f3d9897c413d58a4b7e2e09',
  BLUEMOVE_DEX: '0x3f2d9f724f4a1ce5e71676448dc452be9a6243dac9c5b975a588c8c867066e5b',
  
  // System
  SUI_FRAMEWORK: '0x0000000000000000000000000000000000000000000000000000000000000002',
  CLOCK_OBJECT: '0x0000000000000000000000000000000000000000000000000000000000000006',
} as const;

// ---- Timing Constants ----
export const TIMING = {
  MAX_AUDIT_MS: 5,            // Maximum time for security audit
  RECONNECT_DELAY_MS: 1000,   // Delay before reconnection attempt
  MAX_RECONNECT_ATTEMPTS: 10, // Max reconnection tries
  BLOCK_POLL_MS: 100,         // Fallback block polling interval
  POSITION_CHECK_MS: 500,     // Position monitoring interval
  MEMPOOL_SCAN_MS: 50,        // Mempool scan frequency
} as const;
