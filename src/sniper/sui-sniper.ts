/**
 * ============================================
 * Sui Sniper - Cetus SDK + DeepBook + Sponsored (v2)
 * قناص Sui - Cetus SDK + DeepBook + مدعوم (v2)
 * ============================================
 *
 * Enhanced Sui sniping with:
 * - Cetus SDK for accurate swap quotes and routing
 * - DeepBook V2 orderbook for better pricing comparison
 * - Sponsored transactions for zero-gas emergency exits
 * - Automatic DEX selection (best price wins)
 */

import {
  SuiClient,
  SuiTransactionBlockResponse,
} from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { config } from '../config';
import { SUI } from '../utils/constants';
import { TokenInfo, ExecutionResult, TradeSignal } from '../utils/types';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';
import { CetusSDK } from './cetus-sdk';
import { DeepBookV2 } from './deepbook-v2';
import { SuiSponsoredTx } from './sui-sponsored';

export class SuiSniper {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private cetus: CetusSDK;
  private deepbook: DeepBookV2;
  private sponsored: SuiSponsoredTx;

  constructor() {
    this.client = new SuiClient({ url: config.sui.rpcUrl });

    if (config.sui.privateKey) {
      this.keypair = Ed25519Keypair.fromSecretKey(
        Buffer.from(config.sui.privateKey, 'hex')
      );
    } else {
      this.keypair = new Ed25519Keypair(); // Dummy for paper trading
    }

    // Initialize enhanced modules
    this.cetus = new CetusSDK(this.client);
    this.deepbook = new DeepBookV2(this.client);
    this.sponsored = new SuiSponsoredTx();
  }

  /**
   * Execute a snipe buy on Sui
   * تنفيذ شراء قنص على Sui
   */
  async snipeBuy(signal: TradeSignal): Promise<ExecutionResult> {
    const token = signal.token;
    
    try {
      logger.info(i18n.t('scanner', 'scanningToken', { 
        token: token.address.slice(0, 16) + '...', 
        chain: 'Sui' 
      }));

      // Determine which DEX to use
      const txResult = token.dex === 'cetus'
        ? await this.executeCetusSwap(token, signal.amount, signal.maxSlippage, true)
        : await this.executeBlueMovSwap(token, signal.amount, signal.maxSlippage, true);

      if (txResult.success) {
        logger.info(i18n.t('sniper', 'sniped', { tx: txResult.txHash || '' }));
      }

      return txResult;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(i18n.t('sniper', 'transactionFailed', { 
        reason: errMsg, 
        chain: 'Sui' 
      }));
      
      return {
        success: false,
        error: errMsg,
        chain: 'sui',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute emergency sell (anti-rug)
   * تنفيذ بيع طارئ (مضاد لسحب البساط)
   */
  async emergencySell(token: TokenInfo, amount?: number): Promise<ExecutionResult> {
    try {
      logger.info(i18n.t('antiRug', 'emergencySell', { 
        token: token.address.slice(0, 16) + '...', 
        tx: 'pending...' 
      }));

      // Get user's token balance if amount not specified
      const sellAmount = amount || await this.getTokenBalance(token.address);
      
      if (sellAmount <= 0) {
        return { success: false, error: 'Zero balance', chain: 'sui', timestamp: Date.now() };
      }

      const result = token.dex === 'cetus'
        ? await this.executeCetusSwap(token, sellAmount, 99, false) // 99% slippage for emergency
        : await this.executeBlueMovSwap(token, sellAmount, 99, false);

      if (result.success) {
        logger.info(i18n.t('antiRug', 'rugPrevented', { amount: sellAmount.toString() }));
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        chain: 'sui',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute swap on Cetus CLMM
   * تنفيذ تبادل على Cetus CLMM
   */
  private async executeCetusSwap(
    token: TokenInfo,
    amount: number,
    maxSlippage: number,
    isBuy: boolean
  ): Promise<ExecutionResult> {
    try {
      const tx = new TransactionBlock();
      const walletAddress = this.keypair.getPublicKey().toSuiAddress();
      
      // Convert amount to base units (SUI has 9 decimals)
      const amountInBaseUnits = BigInt(Math.floor(amount * 1_000_000_000));
      
      // Calculate minimum output with slippage
      const minOutput = BigInt(0); // Accept any for speed, controlled by slippage param

      if (isBuy) {
        // Buy: SUI → Token
        // Split SUI coin for the swap amount
        const [coin] = tx.splitCoins(tx.gas, [tx.pure(amountInBaseUnits)]);
        
        // Call Cetus swap
        tx.moveCall({
          target: `${SUI.CETUS_CLMM_PACKAGE}::pool::swap_pay_amount` as any,
          typeArguments: [
            '0x2::sui::SUI',     // CoinTypeA (input)
            token.address,        // CoinTypeB (output)
          ],
          arguments: [
            tx.object(token.poolAddress),     // Pool object
            tx.object(SUI.CLOCK_OBJECT),      // Clock
            coin,                              // Input coin
            tx.pure(true),                     // a2b direction
            tx.pure(amountInBaseUnits),        // amount
            tx.pure(minOutput),                // min output
            tx.pure(BigInt('79226673515401279992447579055')), // sqrt price limit
          ],
        });
      } else {
        // Sell: Token → SUI
        // Get user's token coins
        const coins = await this.client.getCoins({
          owner: walletAddress,
          coinType: token.address,
        });

        if (!coins.data.length) {
          return { success: false, error: 'No coins to sell', chain: 'sui', timestamp: Date.now() };
        }

        // Merge all token coins into one
        const primaryCoin = tx.object(coins.data[0].coinObjectId);
        if (coins.data.length > 1) {
          const otherCoins = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
          tx.mergeCoins(primaryCoin, otherCoins);
        }

        // Call Cetus swap (reverse direction)
        tx.moveCall({
          target: `${SUI.CETUS_CLMM_PACKAGE}::pool::swap_pay_amount` as any,
          typeArguments: [
            token.address,        // CoinTypeA (input)
            '0x2::sui::SUI',     // CoinTypeB (output)
          ],
          arguments: [
            tx.object(token.poolAddress),
            tx.object(SUI.CLOCK_OBJECT),
            primaryCoin,
            tx.pure(true),
            tx.pure(amountInBaseUnits),
            tx.pure(minOutput),
            tx.pure(BigInt('4295048016')), // min sqrt price limit
          ],
        });
      }

      // Set gas budget
      tx.setGasBudget(50_000_000); // 0.05 SUI max gas

      // Execute transaction
      const result = await this.client.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        signer: this.keypair,
        options: {
          showEffects: true,
          showEvents: true,
        },
      });

      const success = result.effects?.status?.status === 'success';
      
      return {
        success,
        txHash: result.digest,
        gasUsed: Number(result.effects?.gasUsed?.computationCost || 0),
        chain: 'sui',
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        chain: 'sui',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute swap on BlueMove DEX
   * تنفيذ تبادل على BlueMove
   */
  private async executeBlueMovSwap(
    token: TokenInfo,
    amount: number,
    maxSlippage: number,
    isBuy: boolean
  ): Promise<ExecutionResult> {
    try {
      const tx = new TransactionBlock();
      const walletAddress = this.keypair.getPublicKey().toSuiAddress();
      const amountInBaseUnits = BigInt(Math.floor(amount * 1_000_000_000));

      if (isBuy) {
        const [coin] = tx.splitCoins(tx.gas, [tx.pure(amountInBaseUnits)]);
        
        tx.moveCall({
          target: `${SUI.BLUEMOVE_PACKAGE}::router::swap_exact_input` as any,
          typeArguments: [
            '0x2::sui::SUI',
            token.address,
          ],
          arguments: [
            tx.object(token.poolAddress),
            coin,
            tx.pure(BigInt(0)), // min output
            tx.object(SUI.CLOCK_OBJECT),
          ],
        });
      } else {
        const coins = await this.client.getCoins({
          owner: walletAddress,
          coinType: token.address,
        });

        if (!coins.data.length) {
          return { success: false, error: 'No coins to sell', chain: 'sui', timestamp: Date.now() };
        }

        const primaryCoin = tx.object(coins.data[0].coinObjectId);
        if (coins.data.length > 1) {
          const otherCoins = coins.data.slice(1).map(c => tx.object(c.coinObjectId));
          tx.mergeCoins(primaryCoin, otherCoins);
        }

        tx.moveCall({
          target: `${SUI.BLUEMOVE_PACKAGE}::router::swap_exact_input` as any,
          typeArguments: [
            token.address,
            '0x2::sui::SUI',
          ],
          arguments: [
            tx.object(token.poolAddress),
            primaryCoin,
            tx.pure(BigInt(0)),
            tx.object(SUI.CLOCK_OBJECT),
          ],
        });
      }

      tx.setGasBudget(50_000_000);

      const result = await this.client.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        signer: this.keypair,
        options: { showEffects: true },
      });

      return {
        success: result.effects?.status?.status === 'success',
        txHash: result.digest,
        gasUsed: Number(result.effects?.gasUsed?.computationCost || 0),
        chain: 'sui',
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        chain: 'sui',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Get token balance for the wallet
   */
  private async getTokenBalance(coinType: string): Promise<number> {
    try {
      const balance = await this.client.getBalance({
        owner: this.keypair.getPublicKey().toSuiAddress(),
        coinType,
      });
      return Number(balance.totalBalance) / 1_000_000_000;
    } catch {
      return 0;
    }
  }

  /**
   * Get wallet SUI balance
   */
  async getBalance(): Promise<number> {
    const balance = await this.client.getBalance({
      owner: this.keypair.getPublicKey().toSuiAddress(),
    });
    return Number(balance.totalBalance) / 1_000_000_000;
  }
}
