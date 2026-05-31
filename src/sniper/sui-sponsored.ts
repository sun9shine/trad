/**
 * ============================================
 * Sui Sponsored Transactions
 * معاملات Sui المدعومة (بدون غاز)
 * ============================================
 *
 * Enables gas-free transaction execution on Sui:
 * - Sponsor pays gas on behalf of the user
 * - Faster inclusion (no need to split gas coins)
 * - Useful for emergency sells (even with 0 SUI balance)
 * - Integrates with Shinami Gas Station API
 * - Self-sponsoring with separate wallet
 */

import { SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { i18n } from '../i18n';

interface SponsorConfig {
  provider: 'shinami' | 'enoki' | 'self' | 'none';
  apiKey?: string;
  maxGasBudget: number;
}

export interface SponsoredTxResult {
  success: boolean;
  digest?: string;
  error?: string;
  gasSponsor?: string;
  gasUsed?: number;
}

export class SuiSponsoredTx {
  private client: SuiClient;
  private sponsorConfig: SponsorConfig;
  private apiClient: AxiosInstance | null = null;
  private sponsorKeypair: Ed25519Keypair | null = null;

  constructor() {
    this.client = new SuiClient({ url: config.sui.rpcUrl });
    this.sponsorConfig = {
      provider: (process.env.SUI_SPONSOR_PROVIDER as any) || 'none',
      apiKey: process.env.SUI_SPONSOR_API_KEY || '',
      maxGasBudget: 100_000_000,
    };

    if (this.sponsorConfig.provider === 'shinami' && this.sponsorConfig.apiKey) {
      this.apiClient = axios.create({
        baseURL: 'https://api.shinami.com/gas/v1',
        headers: { 'X-Api-Key': this.sponsorConfig.apiKey },
        timeout: 10_000,
      });
    }

    if (this.sponsorConfig.provider === 'self' && process.env.SUI_SPONSOR_PRIVATE_KEY) {
      this.sponsorKeypair = Ed25519Keypair.fromSecretKey(
        Buffer.from(process.env.SUI_SPONSOR_PRIVATE_KEY, 'hex')
      );
    }
  }


  async executeSponsored(tx: TransactionBlock, signer: Ed25519Keypair): Promise<SponsoredTxResult> {
    switch (this.sponsorConfig.provider) {
      case 'shinami': return this.executeShinami(tx, signer);
      case 'self': return this.executeSelf(tx, signer);
      default: return this.executeNormal(tx, signer);
    }
  }

  private async executeShinami(tx: TransactionBlock, signer: Ed25519Keypair): Promise<SponsoredTxResult> {
    if (!this.apiClient) return { success: false, error: 'Shinami not configured' };
    try {
      tx.setGasBudget(this.sponsorConfig.maxGasBudget);
      const txBytes = await tx.build({ client: this.client });
      const txBase64 = Buffer.from(txBytes).toString('base64');
      const resp = await this.apiClient.post('/', {
        jsonrpc: '2.0', id: 1,
        method: 'gas_sponsorTransactionBlock',
        params: [txBase64, signer.getPublicKey().toSuiAddress(), this.sponsorConfig.maxGasBudget],
      });
      const sponsoredBytes = resp.data?.result?.txBytes;
      const sponsorSig = resp.data?.result?.signature;
      if (!sponsoredBytes || !sponsorSig) return { success: false, error: 'Sponsorship rejected' };
      const userSig = await signer.signTransactionBlock(Buffer.from(sponsoredBytes, 'base64'));
      const result = await this.client.executeTransactionBlock({
        transactionBlock: sponsoredBytes,
        signature: [userSig.signature, sponsorSig],
        options: { showEffects: true },
      });
      return { success: result.effects?.status?.status === 'success', digest: result.digest, gasSponsor: 'shinami' };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  private async executeSelf(tx: TransactionBlock, signer: Ed25519Keypair): Promise<SponsoredTxResult> {
    if (!this.sponsorKeypair) return this.executeNormal(tx, signer);
    try {
      const signerAddr = signer.getPublicKey().toSuiAddress();
      const sponsorAddr = this.sponsorKeypair.getPublicKey().toSuiAddress();
      tx.setGasBudget(this.sponsorConfig.maxGasBudget);
      tx.setGasOwner(sponsorAddr);
      tx.setSender(signerAddr);
      const txBytes = await tx.build({ client: this.client });
      const sig1 = await signer.signTransactionBlock(txBytes);
      const sig2 = await this.sponsorKeypair.signTransactionBlock(txBytes);
      const result = await this.client.executeTransactionBlock({
        transactionBlock: Buffer.from(txBytes).toString('base64'),
        signature: [sig1.signature, sig2.signature],
        options: { showEffects: true },
      });
      return { success: result.effects?.status?.status === 'success', digest: result.digest, gasSponsor: sponsorAddr };
    } catch (e: any) { return this.executeNormal(tx, signer); }
  }

  private async executeNormal(tx: TransactionBlock, signer: Ed25519Keypair): Promise<SponsoredTxResult> {
    try {
      const result = await this.client.signAndExecuteTransactionBlock({
        transactionBlock: tx, signer, options: { showEffects: true },
      });
      return { success: result.effects?.status?.status === 'success', digest: result.digest };
    } catch (e: any) { return { success: false, error: e.message }; }
  }

  isAvailable(): boolean {
    if (this.sponsorConfig.provider === 'shinami') return !!this.apiClient;
    if (this.sponsorConfig.provider === 'self') return !!this.sponsorKeypair;
    return false;
  }
}
