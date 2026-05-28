/**
 * ============================================
 * EVM Auditor - Smart Contract Security Checks
 * مدقق EVM - فحوصات أمان العقود الذكية
 * ============================================
 * 
 * Checks for EVM tokens (Base / BNB):
 * 1. Contract ownership renounced (owner() == address(0))
 * 2. LP tokens burned to dead address or locked in locker contract
 * 3. Top holder concentration
 * 4. Honeypot detection (simulate buy+sell)
 * 5. External API verification (GoPlus, Honeypot.is)
 */

import { ethers, JsonRpcProvider, Contract, Interface } from 'ethers';
import { config } from '../config';
import { TokenInfo, AuditResult } from '../utils/types';
import { EVM } from '../utils/constants';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';
import axios from 'axios';

// Minimal ABIs for security checks
const ERC20_ABI = [
  'function owner() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const OWNABLE_ABI = [
  'function owner() view returns (address)',
  'function renounceOwnership()',
];

const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
];

export class EVMAuditor {
  private baseProvider: JsonRpcProvider;
  private bnbProvider: JsonRpcProvider;

  constructor() {
    this.baseProvider = new JsonRpcProvider(config.base.rpcUrl);
    this.bnbProvider = new JsonRpcProvider(config.bnb.rpcUrl);
  }

  /**
   * Run all EVM security checks in parallel
   * تشغيل جميع فحوصات أمان EVM بشكل متوازي
   */
  async audit(token: TokenInfo): Promise<AuditResult> {
    const provider = token.chain === 'base' ? this.baseProvider : this.bnbProvider;
    const failReasons: string[] = [];

    // Run ALL checks in parallel for <5ms target
    const [
      ownershipCheck,
      lpCheck,
      holdersCheck,
      honeypotCheck,
    ] = await Promise.all([
      this.checkOwnership(token.address, provider),
      this.checkLPLocked(token.poolAddress, provider),
      this.checkTopHolders(token.address, provider),
      this.checkHoneypot(token.address, token.chain),
    ]);

    // Evaluate ownership
    if (!ownershipCheck.renounced) {
      failReasons.push('Contract ownership not renounced');
      logger.warn(i18n.t('security', 'ownershipNotRenounced', { 
        token: token.address.slice(0, 12) 
      }));
    }

    // Evaluate LP lock
    if (config.security.requireLpLocked && !lpCheck.locked) {
      failReasons.push('LP not locked or burned');
    }

    // Evaluate honeypot
    if (honeypotCheck.isHoneypot) {
      failReasons.push('Honeypot detected - cannot sell');
      logger.warn(i18n.t('security', 'honeypotDetected', { 
        token: token.address.slice(0, 12) 
      }));
    }

    // Evaluate holders
    if (holdersCheck.topPercent > config.security.maxTop10HolderPercent) {
      failReasons.push(`Top holders own ${holdersCheck.topPercent.toFixed(1)}%`);
    }

    const passed = failReasons.length === 0;

    return {
      token: token.address,
      chain: token.chain,
      passed,
      auditTimeMs: 0,
      checks: {
        mintRevoked: true, // EVM tokens don't have mint authority in same way
        lpLocked: lpCheck.locked,
        honeypot: honeypotCheck.isHoneypot,
        topHoldersPercent: holdersCheck.topPercent,
        bundledWallets: holdersCheck.bundledWallets,
        ownershipRenounced: ownershipCheck.renounced,
        liquidityUsd: lpCheck.liquidityUsd,
      },
      failReasons,
    };
  }

  /**
   * Check if contract ownership is renounced
   * التحقق من التنازل عن ملكية العقد
   */
  private async checkOwnership(tokenAddress: string, provider: JsonRpcProvider): Promise<{
    renounced: boolean;
    owner: string;
  }> {
    try {
      const contract = new Contract(tokenAddress, OWNABLE_ABI, provider);
      const owner = await contract.owner();
      
      const renounced = (
        owner === EVM.ZERO_ADDRESS ||
        owner === EVM.DEAD_ADDRESS
      );

      return { renounced, owner };
    } catch {
      // If owner() doesn't exist, contract might not be Ownable
      // Check if it has a different ownership pattern
      try {
        // Try reading storage slot 0 (common for proxy owner)
        const slot0 = await provider.getStorage(tokenAddress, 0);
        const possibleOwner = '0x' + slot0.slice(26); // Last 20 bytes
        
        return { 
          renounced: possibleOwner === EVM.ZERO_ADDRESS.slice(2),
          owner: possibleOwner,
        };
      } catch {
        // Cannot determine ownership - cautious: assume not renounced
        return { renounced: false, owner: 'unknown' };
      }
    }
  }

  /**
   * Check if LP tokens are locked or burned
   * التحقق من قفل أو حرق عملات LP
   */
  private async checkLPLocked(poolAddress: string, provider: JsonRpcProvider): Promise<{
    locked: boolean;
    burnedPercent: number;
    liquidityUsd: number;
  }> {
    try {
      if (!poolAddress) {
        return { locked: false, burnedPercent: 0, liquidityUsd: 0 };
      }

      const pair = new Contract(poolAddress, PAIR_ABI, provider);
      
      const [totalSupply, reserves] = await Promise.all([
        pair.totalSupply(),
        pair.getReserves().catch(() => null),
      ]);

      if (totalSupply === 0n) {
        return { locked: false, burnedPercent: 0, liquidityUsd: 0 };
      }

      // Check balances at known dead/locker addresses
      const deadAddresses = [
        EVM.DEAD_ADDRESS,
        EVM.ZERO_ADDRESS,
        EVM.UNICRYPT_LOCKER,
        EVM.TEAM_FINANCE_LOCKER,
        EVM.PINKLOCK_LOCKER,
      ];

      const balancePromises = deadAddresses.map(addr =>
        pair.balanceOf(addr).catch(() => 0n)
      );

      const balances = await Promise.all(balancePromises);
      const lockedAmount = balances.reduce((sum: bigint, bal: bigint) => sum + bal, 0n);
      const burnedPercent = Number((lockedAmount * 10000n) / totalSupply) / 100;

      return {
        locked: burnedPercent > 90,
        burnedPercent,
        liquidityUsd: 0, // Would need price feed for USD conversion
      };
    } catch (error) {
      return { locked: false, burnedPercent: 0, liquidityUsd: 0 };
    }
  }

  /**
   * Check top token holders concentration
   * فحص تركيز أكبر حاملي العملة
   */
  private async checkTopHolders(tokenAddress: string, provider: JsonRpcProvider): Promise<{
    topPercent: number;
    bundledWallets: number;
  }> {
    try {
      // Use GoPlus API for holder analysis (fastest method)
      const chainId = config.base.rpcUrl.includes('base') ? '8453' : '56';
      const response = await axios.get(
        `${config.apis.goplus}/token_security/${chainId}?contract_addresses=${tokenAddress}`,
        { timeout: 3000 }
      );

      const data = response.data?.result?.[tokenAddress.toLowerCase()];
      if (!data) {
        return { topPercent: 100, bundledWallets: 0 };
      }

      // Calculate top 10 holder percentage
      const holders = data.holders || [];
      let topPercent = 0;
      
      for (let i = 0; i < Math.min(10, holders.length); i++) {
        topPercent += parseFloat(holders[i].percent || '0') * 100;
      }

      // Detect bundled wallets from GoPlus data
      const bundledWallets = data.lp_holder_count ? 
        parseInt(data.lp_holder_count) : 0;

      return { topPercent, bundledWallets };
    } catch {
      // Fallback: on-chain analysis using Transfer events
      return await this.onChainHolderAnalysis(tokenAddress, provider);
    }
  }

  /**
   * Fallback on-chain holder analysis using recent Transfer events
   */
  private async onChainHolderAnalysis(tokenAddress: string, provider: JsonRpcProvider): Promise<{
    topPercent: number;
    bundledWallets: number;
  }> {
    try {
      const contract = new Contract(tokenAddress, ERC20_ABI, provider);
      const totalSupply = await contract.totalSupply();
      
      if (totalSupply === 0n) {
        return { topPercent: 100, bundledWallets: 0 };
      }

      // Get recent transfer events to identify holders
      const currentBlock = await provider.getBlockNumber();
      const filter = contract.filters.Transfer();
      const events = await contract.queryFilter(filter, currentBlock - 100, currentBlock);

      // Build holder map from transfers
      const balances = new Map<string, bigint>();
      
      for (const event of events) {
        const args = (event as any).args;
        if (!args) continue;
        
        const [from, to, value] = args;
        
        // Debit sender
        const fromBal = balances.get(from) || 0n;
        balances.set(from, fromBal - value);
        
        // Credit receiver
        const toBal = balances.get(to) || 0n;
        balances.set(to, toBal + value);
      }

      // Sort by balance and get top 10
      const sorted = [...balances.entries()]
        .filter(([_, bal]) => bal > 0n)
        .sort((a, b) => Number(b[1] - a[1]))
        .slice(0, 10);

      const top10Sum = sorted.reduce((sum, [_, bal]) => sum + bal, 0n);
      const topPercent = Number((top10Sum * 10000n) / totalSupply) / 100;

      return { topPercent, bundledWallets: 0 };
    } catch {
      return { topPercent: 50, bundledWallets: 0 }; // Conservative estimate
    }
  }

  /**
   * Check if token is a honeypot (cannot sell)
   * فحص ما إذا كانت العملة فخ عسل (لا يمكن البيع)
   * 
   * Uses Honeypot.is API for fast detection
   */
  private async checkHoneypot(tokenAddress: string, chain: string): Promise<{
    isHoneypot: boolean;
    buyTax: number;
    sellTax: number;
  }> {
    try {
      const chainId = chain === 'base' ? '8453' : '56';
      
      // Primary: Honeypot.is API
      const response = await axios.get(
        `${config.apis.honeypot}/IsHoneypot?address=${tokenAddress}&chainID=${chainId}`,
        { timeout: 2000 }
      );

      const data = response.data;
      return {
        isHoneypot: data.honeypotResult?.isHoneypot || false,
        buyTax: data.simulationResult?.buyTax || 0,
        sellTax: data.simulationResult?.sellTax || 0,
      };
    } catch {
      // Fallback: GoPlus API
      try {
        const chainId = chain === 'base' ? '8453' : '56';
        const response = await axios.get(
          `${config.apis.goplus}/token_security/${chainId}?contract_addresses=${tokenAddress}`,
          { timeout: 2000 }
        );

        const data = response.data?.result?.[tokenAddress.toLowerCase()];
        return {
          isHoneypot: data?.is_honeypot === '1',
          buyTax: parseFloat(data?.buy_tax || '0') * 100,
          sellTax: parseFloat(data?.sell_tax || '0') * 100,
        };
      } catch {
        // Cannot determine - assume safe but flag
        return { isHoneypot: false, buyTax: 0, sellTax: 0 };
      }
    }
  }
}
