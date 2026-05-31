/**
 * ============================================
 * Multi-Wallet Manager
 * مدير المحافظ المتعددة
 * ============================================
 * 
 * Manages multiple wallets per chain for:
 * - Load distribution across wallets
 * - Concurrent sniping from multiple addresses
 * - Wallet rotation to avoid detection
 * - Balance tracking per wallet
 */

import { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ethers, Wallet, JsonRpcProvider } from 'ethers';
import { Chain } from './types';
import { config } from '../config';
import { KeyVault } from './key-vault';
import { logger } from './logger';
import { i18n } from '../i18n';

interface WalletInfo {
  address: string;
  chain: Chain;
  label: string;
  balance: number;
  lastUsed: number;
  totalTrades: number;
  isActive: boolean;
}

export class MultiWalletManager {
  private solanaWallets: Map<string, Keypair> = new Map();
  private evmWallets: Map<string, { wallet: Wallet; chain: Chain }> = new Map();
  private walletMeta: Map<string, WalletInfo> = new Map();
  private vault: KeyVault;
  private roundRobinIndex: Map<Chain, number> = new Map();

  constructor(vault: KeyVault) {
    this.vault = vault;
  }

  /**
   * Load wallets from vault or environment
   * تحميل المحافظ من الخزنة أو البيئة
   */
  async initialize(): Promise<void> {
    // Load primary wallets from config
    await this.loadPrimaryWallets();
    
    // Load additional wallets from vault (if any stored)
    await this.loadVaultWallets();

    logger.info(i18n.t('system', 'info', {
      message: `Loaded ${this.walletMeta.size} wallets across all chains`,
    }));
  }

  /**
   * Get next available wallet for a chain (round-robin)
   * الحصول على المحفظة التالية المتاحة لسلسلة
   */
  getNextWallet(chain: Chain): WalletInfo | null {
    const wallets = this.getWalletsByChain(chain).filter(w => w.isActive);
    if (wallets.length === 0) return null;

    const idx = (this.roundRobinIndex.get(chain) || 0) % wallets.length;
    this.roundRobinIndex.set(chain, idx + 1);
    
    return wallets[idx];
  }

  /**
   * Get wallet with highest balance
   */
  getBestWallet(chain: Chain): WalletInfo | null {
    const wallets = this.getWalletsByChain(chain).filter(w => w.isActive);
    if (wallets.length === 0) return null;
    return wallets.sort((a, b) => b.balance - a.balance)[0];
  }

  /**
   * Get Solana Keypair by address
   */
  getSolanaKeypair(address: string): Keypair | null {
    return this.solanaWallets.get(address) || null;
  }

  /**
   * Get EVM Wallet by address
   */
  getEVMWallet(address: string): Wallet | null {
    return this.evmWallets.get(address)?.wallet || null;
  }

  /**
   * Add a new wallet
   */
  addWallet(privateKey: string, chain: Chain, label: string): string {
    if (chain === 'solana') {
      const keypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
      const address = keypair.publicKey.toBase58();
      this.solanaWallets.set(address, keypair);
      this.registerWallet(address, chain, label);
      return address;
    } else {
      const wallet = new ethers.Wallet(privateKey);
      const address = wallet.address;
      this.evmWallets.set(address, { wallet, chain });
      this.registerWallet(address, chain, label);
      return address;
    }
  }

  /**
   * Refresh balances for all wallets
   * تحديث أرصدة جميع المحافظ
   */
  async refreshBalances(): Promise<void> {
    for (const [address, info] of this.walletMeta) {
      try {
        if (info.chain === 'solana') {
          const connection = new Connection(config.solana.rpcUrl);
          const balance = await connection.getBalance(new PublicKey(address));
          info.balance = balance / LAMPORTS_PER_SOL;
        } else {
          const rpcUrl = info.chain === 'base' ? config.base.rpcUrl : config.bnb.rpcUrl;
          const provider = new JsonRpcProvider(rpcUrl);
          const balance = await provider.getBalance(address);
          info.balance = Number(ethers.formatEther(balance));
        }
      } catch {
        // Non-fatal
      }
    }
  }

  /**
   * Get all wallets for a specific chain
   */
  getWalletsByChain(chain: Chain): WalletInfo[] {
    return [...this.walletMeta.values()].filter(w => w.chain === chain);
  }

  /**
   * Get all wallets info
   */
  getAllWallets(): WalletInfo[] {
    return [...this.walletMeta.values()];
  }

  private registerWallet(address: string, chain: Chain, label: string): void {
    this.walletMeta.set(address, {
      address,
      chain,
      label,
      balance: 0,
      lastUsed: 0,
      totalTrades: 0,
      isActive: true,
    });
  }

  private async loadPrimaryWallets(): Promise<void> {
    if (config.solana.privateKey) {
      try {
        const keypair = Keypair.fromSecretKey(
          Buffer.from(config.solana.privateKey, 'base64').length === 64
            ? Buffer.from(config.solana.privateKey, 'base64')
            : Buffer.from(config.solana.privateKey, 'hex')
        );
        const addr = keypair.publicKey.toBase58();
        this.solanaWallets.set(addr, keypair);
        this.registerWallet(addr, 'solana', 'primary');
      } catch {}
    }

    if (config.base.privateKey) {
      try {
        const wallet = new ethers.Wallet(config.base.privateKey);
        this.evmWallets.set(wallet.address, { wallet, chain: 'base' });
        this.registerWallet(wallet.address, 'base', 'primary');
      } catch {}
    }

    if (config.bnb.privateKey) {
      try {
        const wallet = new ethers.Wallet(config.bnb.privateKey);
        this.evmWallets.set(wallet.address, { wallet, chain: 'bnb' });
        this.registerWallet(wallet.address, 'bnb', 'primary');
      } catch {}
    }
  }

  private async loadVaultWallets(): Promise<void> {
    // Load additional wallets from vault if available
    for (let i = 1; i <= 5; i++) {
      const solKey = this.vault.getKey(`solana_${i}`);
      if (solKey) this.addWallet(solKey, 'solana', `vault_${i}`);

      const baseKey = this.vault.getKey(`base_${i}`);
      if (baseKey) this.addWallet(baseKey, 'base', `vault_${i}`);
    }
  }
}
