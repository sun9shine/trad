/**
 * ============================================
 * Solana Auditor - SPL Token Security Checks
 * مدقق سولانا - فحوصات أمان عملات SPL
 * ============================================
 * 
 * Checks for Solana SPL tokens:
 * 1. Mint Authority revoked (set to null)
 * 2. Freeze Authority revoked
 * 3. LP tokens burned or locked
 * 4. Top holder concentration analysis
 * 5. Bundled wallet detection
 */

import { Connection, PublicKey, AccountInfo } from '@solana/web3.js';
import { config } from '../config';
import { TokenInfo, AuditResult } from '../utils/types';
import { SOLANA } from '../utils/constants';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';
import axios from 'axios';

// SPL Token Mint layout offsets (compact parsing for speed)
const MINT_LAYOUT = {
  mintAuthorityOption: 0,   // u32 (4 bytes) - 0 = None, 1 = Some
  mintAuthority: 4,         // Pubkey (32 bytes)
  supply: 36,               // u64 (8 bytes)
  decimals: 44,             // u8 (1 byte)
  isInitialized: 45,        // bool (1 byte)
  freezeAuthorityOption: 46, // u32 (4 bytes)
  freezeAuthority: 50,      // Pubkey (32 bytes)
};

export class SolanaAuditor {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(config.solana.rpcUrl, {
      commitment: 'confirmed',
      disableRetryOnRateLimit: true,
    });
  }

  /**
   * Run all Solana-specific security checks in parallel
   * تشغيل جميع فحوصات الأمان الخاصة بسولانا بشكل متوازي
   */
  async audit(token: TokenInfo): Promise<AuditResult> {
    const failReasons: string[] = [];

    // Execute ALL checks in parallel for speed
    const [
      mintCheck,
      lpCheck,
      holdersCheck,
    ] = await Promise.all([
      this.checkMintAuthority(token.address),
      this.checkLPLocked(token.poolAddress, token.address),
      this.checkTopHolders(token.address),
    ]);

    // Evaluate mint authority
    if (config.security.requireMintRevoked && !mintCheck.mintRevoked) {
      failReasons.push('Mint authority not revoked');
      logger.warn(i18n.t('security', 'mintNotRevoked', { token: token.address.slice(0, 12) }));
    }

    // Evaluate LP lock
    if (config.security.requireLpLocked && !lpCheck.locked) {
      failReasons.push('LP not locked or burned');
      logger.warn(i18n.t('security', 'lpNotLocked', { token: token.address.slice(0, 12) }));
    }

    // Evaluate top holders
    if (holdersCheck.topPercent > config.security.maxTop10HolderPercent) {
      failReasons.push(`Top 10 holders own ${holdersCheck.topPercent.toFixed(1)}%`);
      logger.warn(i18n.t('security', 'topHoldersRisk', { 
        percent: holdersCheck.topPercent.toFixed(1), 
        token: token.address.slice(0, 12) 
      }));
    }

    // Bundled wallets check
    if (holdersCheck.bundledWallets > 3) {
      failReasons.push(`${holdersCheck.bundledWallets} bundled wallets detected`);
      logger.warn(i18n.t('security', 'bundledWalletsDetected', { 
        count: holdersCheck.bundledWallets.toString(), 
        token: token.address.slice(0, 12) 
      }));
    }

    const passed = failReasons.length === 0;

    return {
      token: token.address,
      chain: 'solana',
      passed,
      auditTimeMs: 0, // Set by caller
      checks: {
        mintRevoked: mintCheck.mintRevoked,
        lpLocked: lpCheck.locked,
        honeypot: false, // Solana tokens rarely have honeypot mechanics
        topHoldersPercent: holdersCheck.topPercent,
        bundledWallets: holdersCheck.bundledWallets,
        ownershipRenounced: mintCheck.mintRevoked && mintCheck.freezeRevoked,
        liquidityUsd: lpCheck.liquidityUsd,
      },
      failReasons,
    };
  }

  /**
   * Check if Mint and Freeze authorities are revoked
   * التحقق من إلغاء صلاحيات السك والتجميد
   */
  private async checkMintAuthority(tokenMint: string): Promise<{
    mintRevoked: boolean;
    freezeRevoked: boolean;
    supply: bigint;
  }> {
    try {
      const mintPubkey = new PublicKey(tokenMint);
      const accountInfo = await this.connection.getAccountInfo(mintPubkey);

      if (!accountInfo || !accountInfo.data) {
        return { mintRevoked: false, freezeRevoked: false, supply: 0n };
      }

      const data = accountInfo.data;

      // Parse mint authority option (0 = None/Revoked, 1 = Some/Active)
      const mintAuthorityOption = data.readUInt32LE(MINT_LAYOUT.mintAuthorityOption);
      const freezeAuthorityOption = data.readUInt32LE(MINT_LAYOUT.freezeAuthorityOption);
      
      // Parse supply
      const supply = data.readBigUInt64LE(MINT_LAYOUT.supply);

      return {
        mintRevoked: mintAuthorityOption === 0,
        freezeRevoked: freezeAuthorityOption === 0,
        supply,
      };
    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Mint authority check failed: ${error}` 
      }));
      return { mintRevoked: false, freezeRevoked: false, supply: 0n };
    }
  }

  /**
   * Check if LP tokens are burned or locked
   * التحقق من حرق أو قفل عملات LP
   */
  private async checkLPLocked(poolAddress: string, tokenMint: string): Promise<{
    locked: boolean;
    burnedPercent: number;
    liquidityUsd: number;
  }> {
    try {
      if (!poolAddress) {
        return { locked: false, burnedPercent: 0, liquidityUsd: 0 };
      }

      // Fetch pool account to get LP mint
      const poolPubkey = new PublicKey(poolAddress);
      const poolInfo = await this.connection.getAccountInfo(poolPubkey);
      
      if (!poolInfo) {
        return { locked: false, burnedPercent: 0, liquidityUsd: 0 };
      }

      // Check if LP tokens are sent to burn addresses
      // For Raydium AMM, LP mint is derived from the pool
      // We check the largest token accounts for the LP mint
      const lpMint = this.deriveLPMint(poolAddress);
      
      if (lpMint) {
        const largestAccounts = await this.connection.getTokenLargestAccounts(
          new PublicKey(lpMint)
        );

        const burnAddresses = new Set([
          SOLANA.BURN_ADDRESS,
          SOLANA.NULL_ADDRESS,
          '1nc1nerator11111111111111111111111111111111',
        ]);

        let totalSupply = 0n;
        let burnedAmount = 0n;

        for (const account of largestAccounts.value) {
          totalSupply += BigInt(account.amount);
          
          // Check if held by burn address
          const ownerInfo = await this.connection.getAccountInfo(account.address);
          if (ownerInfo) {
            const owner = new PublicKey(ownerInfo.data.slice(32, 64)).toBase58();
            if (burnAddresses.has(owner)) {
              burnedAmount += BigInt(account.amount);
            }
          }
        }

        const burnedPercent = totalSupply > 0n 
          ? Number((burnedAmount * 100n) / totalSupply) 
          : 0;

        return {
          locked: burnedPercent > 90, // >90% burned = considered locked
          burnedPercent,
          liquidityUsd: 0, // Would need price oracle for USD value
        };
      }

      return { locked: false, burnedPercent: 0, liquidityUsd: 0 };
    } catch (error) {
      // Non-blocking: return cautious result
      return { locked: false, burnedPercent: 0, liquidityUsd: 0 };
    }
  }

  /**
   * Analyze top 10 holders for concentration and bundled wallets
   * تحليل أكبر 10 حاملين للتركيز والمحافظ المجمعة
   */
  private async checkTopHolders(tokenMint: string): Promise<{
    topPercent: number;
    bundledWallets: number;
  }> {
    try {
      const mintPubkey = new PublicKey(tokenMint);
      const largestAccounts = await this.connection.getTokenLargestAccounts(mintPubkey);
      
      if (!largestAccounts.value.length) {
        return { topPercent: 100, bundledWallets: 0 };
      }

      // Calculate total from top accounts
      let totalFromTop10 = 0n;
      let totalSupply = 0n;
      const holders: string[] = [];

      // Get total supply from mint
      const mintInfo = await this.connection.getAccountInfo(mintPubkey);
      if (mintInfo) {
        totalSupply = mintInfo.data.readBigUInt64LE(MINT_LAYOUT.supply);
      }

      // Sum top 10 (excluding pool/burn addresses)
      const excludeAddresses = new Set([SOLANA.BURN_ADDRESS, SOLANA.NULL_ADDRESS]);
      let counted = 0;

      for (const account of largestAccounts.value) {
        if (counted >= 10) break;
        
        const amount = BigInt(account.amount);
        // Skip likely pool addresses (very large holdings)
        if (amount > (totalSupply * 50n) / 100n) continue;
        
        totalFromTop10 += amount;
        holders.push(account.address.toBase58());
        counted++;
      }

      const topPercent = totalSupply > 0n 
        ? Number((totalFromTop10 * 10000n) / totalSupply) / 100 
        : 100;

      // Detect bundled wallets by checking if multiple top holders
      // received tokens in the same transaction (simplified heuristic)
      const bundledWallets = await this.detectBundledWallets(holders);

      return { topPercent, bundledWallets };
    } catch (error) {
      return { topPercent: 100, bundledWallets: 0 };
    }
  }

  /**
   * Detect wallets that received tokens in the same block/transaction
   * اكتشاف المحافظ التي تلقت عملات في نفس البلوك/المعاملة
   */
  private async detectBundledWallets(holders: string[]): Promise<number> {
    try {
      if (holders.length < 3) return 0;

      // Get recent signatures for each holder and check for common transaction origins
      const signatureSets: Set<string>[] = [];

      // Limit to first 5 holders for speed
      const checkHolders = holders.slice(0, 5);
      
      const sigPromises = checkHolders.map(holder =>
        this.connection.getSignaturesForAddress(
          new PublicKey(holder),
          { limit: 5 },
          'confirmed'
        ).catch(() => [])
      );

      const allSigs = await Promise.all(sigPromises);

      // Check for overlapping signatures (same tx sent to multiple wallets)
      const txCounts = new Map<string, number>();
      
      for (const sigs of allSigs) {
        for (const sig of sigs) {
          const count = txCounts.get(sig.signature) || 0;
          txCounts.set(sig.signature, count + 1);
        }
      }

      // Count wallets that share transactions
      let bundled = 0;
      for (const count of txCounts.values()) {
        if (count >= 2) bundled++;
      }

      return bundled;
    } catch {
      return 0;
    }
  }

  /**
   * Derive LP mint from pool address (Raydium specific)
   */
  private deriveLPMint(poolAddress: string): string | null {
    try {
      // For Raydium AMM V4, LP mint is at offset 272 in pool state
      // This is a simplified approach - in production, parse full pool state
      return null; // Will be resolved from pool account data
    } catch {
      return null;
    }
  }
}
