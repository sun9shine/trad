/**
 * ============================================
 * Blacklist/Whitelist Manager
 * مدير القوائم السوداء والبيضاء
 * ============================================
 * 
 * Manages token, deployer, and wallet filtering:
 * - Blacklisted tokens are never bought
 * - Blacklisted deployers are always rejected
 * - Whitelisted tokens skip some security checks
 * - Auto-blacklist on rug detection
 */

import { Chain } from './types';
import { Database, BlacklistEntry, WhitelistEntry } from '../database';
import { logger } from './logger';
import { i18n } from '../i18n';

export class BlacklistManager {
  private db: Database;
  
  // In-memory caches for speed
  private blacklistedTokens: Set<string> = new Set();
  private blacklistedDeployers: Set<string> = new Set();
  private whitelistedTokens: Set<string> = new Set();

  constructor(db: Database) {
    this.db = db;
    this.loadFromDb();
  }

  /**
   * Check if a token should be filtered out
   * التحقق مما إذا كان يجب تصفية العملة
   */
  shouldReject(tokenAddress: string, deployer: string, chain: Chain): {
    rejected: boolean;
    reason?: string;
  } {
    const tokenKey = `${chain}:${tokenAddress.toLowerCase()}`;
    const deployerKey = `${chain}:${deployer.toLowerCase()}`;

    if (this.blacklistedTokens.has(tokenKey)) {
      return { rejected: true, reason: 'Token blacklisted' };
    }

    if (this.blacklistedDeployers.has(deployerKey)) {
      return { rejected: true, reason: 'Deployer blacklisted' };
    }

    return { rejected: false };
  }

  /**
   * Check if token is whitelisted (skip some checks)
   */
  isWhitelisted(tokenAddress: string, chain: Chain): boolean {
    return this.whitelistedTokens.has(`${chain}:${tokenAddress.toLowerCase()}`);
  }

  /**
   * Blacklist a token (e.g., after rug detection)
   * إضافة عملة للقائمة السوداء
   */
  blacklistToken(address: string, chain: Chain, reason: string): void {
    const key = `${chain}:${address.toLowerCase()}`;
    this.blacklistedTokens.add(key);
    this.db.addToBlacklist({
      address: address.toLowerCase(),
      type: 'token',
      chain,
      reason,
      addedAt: Date.now(),
    });
    logger.info(i18n.t('system', 'info', {
      message: `Blacklisted token: ${address.slice(0, 12)} (${reason})`,
    }));
  }

  /**
   * Blacklist a deployer
   */
  blacklistDeployer(address: string, chain: Chain, reason: string): void {
    const key = `${chain}:${address.toLowerCase()}`;
    this.blacklistedDeployers.add(key);
    this.db.addToBlacklist({
      address: address.toLowerCase(),
      type: 'deployer',
      chain,
      reason,
      addedAt: Date.now(),
    });
    logger.info(i18n.t('system', 'info', {
      message: `Blacklisted deployer: ${address.slice(0, 12)} (${reason})`,
    }));
  }

  /**
   * Whitelist a token
   */
  whitelistToken(address: string, chain: Chain, note: string): void {
    const key = `${chain}:${address.toLowerCase()}`;
    this.whitelistedTokens.add(key);
    this.db.addToWhitelist({
      address: address.toLowerCase(),
      type: 'token',
      chain,
      note,
      addedAt: Date.now(),
    });
  }

  /**
   * Remove from blacklist
   */
  unblacklist(address: string, chain: Chain): void {
    const key = `${chain}:${address.toLowerCase()}`;
    this.blacklistedTokens.delete(key);
    this.blacklistedDeployers.delete(key);
    this.db.removeFromBlacklist(address.toLowerCase(), chain);
  }

  /**
   * Auto-blacklist deployer and token on rug detection
   */
  autoBlacklistOnRug(tokenAddress: string, deployer: string, chain: Chain): void {
    this.blacklistToken(tokenAddress, chain, 'Auto: Rug pull detected');
    this.blacklistDeployer(deployer, chain, 'Auto: Rug pull deployer');
  }

  /**
   * Load lists from database into memory
   */
  private loadFromDb(): void {
    const blacklist = this.db.getBlacklist();
    for (const entry of blacklist) {
      const key = `${entry.chain}:${entry.address.toLowerCase()}`;
      if (entry.type === 'token') this.blacklistedTokens.add(key);
      if (entry.type === 'deployer') this.blacklistedDeployers.add(key);
    }
  }

  getStats(): { tokens: number; deployers: number; whitelisted: number } {
    return {
      tokens: this.blacklistedTokens.size,
      deployers: this.blacklistedDeployers.size,
      whitelisted: this.whitelistedTokens.size,
    };
  }
}
