/**
 * ============================================
 * Security Auditor - Multi-Layer Token Analysis
 * المدقق الأمني - تحليل العملات متعدد الطبقات
 * ============================================
 * 
 * Performs rapid security checks on newly discovered tokens:
 * 1. Mint/Freeze Authority verification (Solana) / Ownership renouncement (EVM)
 * 2. Liquidity Lock/Burn verification
 * 3. Top holders cluster analysis
 * 4. Honeypot detection
 * 
 * Target: Complete ALL checks within < 5ms using parallel execution
 * and pre-cached RPC connections.
 */

import { TokenInfo, AuditResult, Chain } from '../utils/types';
import { config } from '../config';
import { i18n } from '../i18n';
import { logger, perfTimer } from '../utils/logger';
import { SolanaAuditor } from './solana-auditor';
import { EVMAuditor } from './evm-auditor';
import { SuiAuditor } from './sui-auditor';

export class SecurityAuditor {
  private solanaAuditor: SolanaAuditor;
  private evmAuditor: EVMAuditor;
  private suiAuditor: SuiAuditor;

  constructor() {
    this.solanaAuditor = new SolanaAuditor();
    this.evmAuditor = new EVMAuditor();
    this.suiAuditor = new SuiAuditor();
  }

  /**
   * Run full security audit on a token
   * تشغيل التدقيق الأمني الكامل على عملة
   * 
   * All checks run in PARALLEL to meet the <5ms target.
   * Returns immediately with cached data when possible.
   */
  async audit(token: TokenInfo): Promise<AuditResult> {
    const timer = perfTimer();

    logger.info(i18n.t('scanner', 'scanningToken', { 
      token: token.address.slice(0, 12) + '...', 
      chain: token.chain 
    }));

    let result: AuditResult;

    try {
      switch (token.chain) {
        case 'solana':
          result = await this.solanaAuditor.audit(token);
          break;
        case 'base':
        case 'bnb':
          result = await this.evmAuditor.audit(token);
          break;
        case 'sui':
          result = await this.suiAuditor.audit(token);
          break;
        default:
          result = this.createFailedResult(token, 'Unsupported chain');
      }
    } catch (error) {
      result = this.createFailedResult(token, `Audit error: ${error}`);
    }

    // Record audit time
    result.auditTimeMs = timer();

    // Log result
    if (result.passed) {
      logger.info(i18n.t('security', 'auditPassed', { 
        token: token.address.slice(0, 12) + '...', 
        time: result.auditTimeMs.toFixed(2) 
      }));
    } else {
      logger.warn(i18n.t('security', 'auditFailed', { 
        token: token.address.slice(0, 12) + '...', 
        reason: result.failReasons.join(', ') 
      }));
    }

    return result;
  }

  /**
   * Quick pre-filter before full audit (ultra-fast rejection)
   * فلتر سريع قبل التدقيق الكامل
   */
  quickFilter(token: TokenInfo): boolean {
    // Reject tokens with zero liquidity indication
    if (token.liquidity > 0 && token.liquidity < config.security.minLiquidityUsd) {
      return false;
    }
    return true;
  }

  private createFailedResult(token: TokenInfo, reason: string): AuditResult {
    return {
      token: token.address,
      chain: token.chain,
      passed: false,
      auditTimeMs: 0,
      checks: {
        mintRevoked: false,
        lpLocked: false,
        honeypot: true,
        topHoldersPercent: 100,
        bundledWallets: 0,
        ownershipRenounced: false,
        liquidityUsd: 0,
      },
      failReasons: [reason],
    };
  }
}
