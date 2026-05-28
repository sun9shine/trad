/**
 * ============================================
 * Solana Scanner - gRPC Geyser + WebSocket
 * ماسح سولانا - gRPC Geyser + WebSocket
 * ============================================
 * 
 * Streams transactions via Helius/Triton Geyser gRPC plugin to detect:
 * - Raydium AMM pool initialization (initialize2 instruction)
 * - Raydium CPMM/CLMM pool creation
 * - Pump.fun token migrations to Raydium
 * 
 * Falls back to WebSocket subscription if gRPC unavailable.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { BaseScanner } from './base-scanner';
import { TokenInfo, Chain } from '../utils/types';
import { config } from '../config';
import { SOLANA } from '../utils/constants';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';

// Raydium instruction discriminators (first 8 bytes)
const RAYDIUM_INIT_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]); // initialize2
const PUMPFUN_MIGRATE_DISCRIMINATOR = Buffer.from([102, 182, 45, 87, 136, 75, 245, 149]); // migrate

interface GeyserSubscription {
  stream: grpc.ClientReadableStream<any>;
  cancel: () => void;
}

export class SolanaScanner extends BaseScanner {
  private connection: Connection;
  private geyserClient: any = null;
  private geyserStream: GeyserSubscription | null = null;
  private wsSubscriptionId: number | null = null;

  constructor() {
    super('solana');
    this.connection = new Connection(config.solana.rpcUrl, {
      wsEndpoint: config.solana.wsUrl,
      commitment: 'confirmed',
    });
  }

  /**
   * Start the Solana scanner
   * Attempts gRPC first, falls back to WebSocket log subscription
   */
  async start(): Promise<void> {
    this.isRunning = true;
    logger.info(i18n.t('scanner', 'listeningChain', { 
      chain: 'Solana', 
      method: config.solana.grpcUrl ? 'gRPC Geyser' : 'WebSocket' 
    }));

    if (config.solana.grpcUrl) {
      await this.startGeyserStream();
    } else {
      await this.startWebSocketListener();
    }

    this.emit('scanner:connected', 'solana');
  }

  /**
   * Connect to Geyser gRPC and subscribe to Raydium/Pump.fun transactions
   * الاتصال بـ Geyser gRPC والاشتراك في معاملات Raydium/Pump.fun
   */
  private async startGeyserStream(): Promise<void> {
    try {
      // Load gRPC proto definition for Geyser
      const packageDefinition = protoLoader.loadSync(
        require.resolve('./proto/geyser.proto'),
        {
          keepCase: true,
          longs: String,
          enums: String,
          defaults: true,
          oneofs: true,
        }
      );

      const geyserProto = grpc.loadPackageDefinition(packageDefinition) as any;

      // Create authenticated gRPC channel
      const credentials = config.solana.grpcToken
        ? grpc.credentials.combineChannelCredentials(
            grpc.credentials.createSsl(),
            grpc.credentials.createFromMetadataGenerator((_, callback) => {
              const metadata = new grpc.Metadata();
              metadata.set('x-token', config.solana.grpcToken);
              callback(null, metadata);
            })
          )
        : grpc.credentials.createSsl();

      this.geyserClient = new geyserProto.geyser.Geyser(
        config.solana.grpcUrl,
        credentials
      );

      // Subscribe to transactions involving Raydium & Pump.fun programs
      const request = {
        transactions: {
          raydium: {
            account_include: [SOLANA.RAYDIUM_AMM_V4, SOLANA.RAYDIUM_CPMM, SOLANA.RAYDIUM_CLMM],
            account_exclude: [],
            account_required: [],
          },
          pumpfun: {
            account_include: [SOLANA.PUMPFUN_PROGRAM, SOLANA.PUMPFUN_MIGRATION],
            account_exclude: [],
            account_required: [],
          },
        },
        commitment: 1, // CONFIRMED
        accounts_data_slice: [],
        ping: { id: 1 },
      };

      const stream = this.geyserClient.Subscribe(request);

      stream.on('data', (update: any) => {
        if (update.transaction) {
          this.processGeyserTransaction(update.transaction);
        }
      });

      stream.on('error', (error: Error) => {
        logger.error(i18n.t('system', 'error', { 
          message: `Geyser stream error: ${error.message}` 
        }));
        if (this.isRunning) {
          this.reconnect();
        }
      });

      stream.on('end', () => {
        logger.warn(i18n.t('system', 'disconnected', { chain: 'Solana gRPC' }));
        if (this.isRunning) {
          this.reconnect();
        }
      });

      this.geyserStream = {
        stream,
        cancel: () => stream.cancel(),
      };

      logger.info(i18n.t('system', 'connected', { chain: 'Solana (Geyser gRPC)' }));
    } catch (error) {
      logger.warn(i18n.t('system', 'warning', { 
        message: `gRPC failed, falling back to WebSocket: ${error}` 
      }));
      await this.startWebSocketListener();
    }
  }

  /**
   * Process a transaction from the Geyser stream
   * معالجة معاملة من تدفق Geyser
   */
  private processGeyserTransaction(txData: any): void {
    try {
      const { transaction, meta } = txData;
      if (!transaction?.message?.instructions || meta?.err) return;

      const accountKeys = transaction.message.accountKeys.map((k: Buffer) => 
        new PublicKey(k).toBase58()
      );

      for (const ix of transaction.message.instructions) {
        const programId = accountKeys[ix.programIdIndex];
        const data = Buffer.from(ix.data);

        // Check Raydium AMM V4 initialize2
        if (programId === SOLANA.RAYDIUM_AMM_V4 && 
            data.slice(0, 8).equals(RAYDIUM_INIT_DISCRIMINATOR)) {
          this.handleRaydiumPoolCreation(ix, accountKeys, txData);
        }

        // Check Pump.fun migration (token graduating to Raydium)
        if ((programId === SOLANA.PUMPFUN_PROGRAM || programId === SOLANA.PUMPFUN_MIGRATION) &&
            data.slice(0, 8).equals(PUMPFUN_MIGRATE_DISCRIMINATOR)) {
          this.handlePumpfunMigration(ix, accountKeys, txData);
        }
      }
    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Failed to process Solana tx: ${error}` 
      }));
    }
  }

  /**
   * Handle Raydium pool initialization
   * معالجة إنشاء تجمع Raydium
   */
  private handleRaydiumPoolCreation(
    instruction: any, 
    accountKeys: string[], 
    txData: any
  ): void {
    // Raydium initialize2 account layout:
    // [0] = token_program, [1] = amm_id, [2] = amm_authority,
    // [3] = amm_open_orders, [4] = lp_mint, [5] = coin_mint,
    // [6] = pc_mint (quote), [7] = coin_vault, [8] = pc_vault...
    const accounts = instruction.accounts.map((idx: number) => accountKeys[idx]);
    
    const tokenMint = accounts[5];   // coin_mint (new token)
    const quoteMint = accounts[6];   // pc_mint (SOL/USDC)
    const poolAddress = accounts[1]; // amm_id
    const deployer = accountKeys[0]; // fee payer

    const token: TokenInfo = {
      address: tokenMint,
      chain: 'solana',
      dex: 'raydium',
      decimals: 9, // Will be verified in audit
      deployer,
      poolAddress,
      pairToken: quoteMint,
      liquidity: 0, // Calculated in audit
      createdAt: Date.now(),
      txHash: txData.signature ? Buffer.from(txData.signature).toString('base64') : '',
    };

    this.emitTokenDiscovered(token);
  }

  /**
   * Handle Pump.fun token migration to Raydium
   * معالجة هجرة عملة Pump.fun إلى Raydium
   */
  private handlePumpfunMigration(
    instruction: any, 
    accountKeys: string[], 
    txData: any
  ): void {
    const accounts = instruction.accounts.map((idx: number) => accountKeys[idx]);
    
    // Migration creates a Raydium pool - the token mint is typically accounts[1]
    const tokenMint = accounts[1];
    const deployer = accountKeys[0];

    const token: TokenInfo = {
      address: tokenMint,
      chain: 'solana',
      dex: 'pumpfun',
      decimals: 6, // Pump.fun tokens use 6 decimals
      deployer,
      poolAddress: accounts[2] || '',
      pairToken: 'So11111111111111111111111111111111111111112', // SOL
      liquidity: 0,
      createdAt: Date.now(),
      txHash: txData.signature ? Buffer.from(txData.signature).toString('base64') : '',
    };

    this.emitTokenDiscovered(token);
  }

  /**
   * Fallback: WebSocket subscription to Raydium logs
   * البديل: اشتراك WebSocket في سجلات Raydium
   */
  private async startWebSocketListener(): Promise<void> {
    try {
      this.wsSubscriptionId = this.connection.onLogs(
        new PublicKey(SOLANA.RAYDIUM_AMM_V4),
        (logs) => {
          // Filter for initialization logs
          if (logs.err) return;

          const hasInit = logs.logs.some(log => 
            log.includes('initialize2') || 
            log.includes('InitializeInstruction')
          );

          if (hasInit) {
            // Fetch full transaction to extract pool details
            this.fetchAndProcessTransaction(logs.signature);
          }
        },
        'confirmed'
      );

      logger.info(i18n.t('system', 'connected', { chain: 'Solana (WebSocket Logs)' }));
    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `WebSocket subscription failed: ${error}` 
      }));
      throw error;
    }
  }

  /**
   * Fetch full transaction details and process
   */
  private async fetchAndProcessTransaction(signature: string): Promise<void> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx?.meta || tx.meta.err) return;

      const accountKeys = tx.transaction.message.getAccountKeys().staticAccountKeys;
      
      // Find Raydium initialize instruction
      for (const ix of tx.transaction.message.compiledInstructions) {
        const programId = accountKeys[ix.programIdIndex]?.toBase58();
        
        if (programId === SOLANA.RAYDIUM_AMM_V4) {
          const data = Buffer.from(ix.data);
          if (data.slice(0, 8).equals(RAYDIUM_INIT_DISCRIMINATOR)) {
            const accounts = ix.accountKeyIndexes.map(idx => accountKeys[idx]?.toBase58());
            
            const token: TokenInfo = {
              address: accounts[5] || '',
              chain: 'solana',
              dex: 'raydium',
              decimals: 9,
              deployer: accountKeys[0]?.toBase58() || '',
              poolAddress: accounts[1] || '',
              pairToken: accounts[6] || '',
              liquidity: 0,
              createdAt: (tx.blockTime || Date.now() / 1000) * 1000,
              txHash: signature,
            };

            this.emitTokenDiscovered(token);
          }
        }
      }
    } catch (error) {
      logger.error(i18n.t('system', 'error', { 
        message: `Failed to fetch tx ${signature}: ${error}` 
      }));
    }
  }

  /**
   * Stop all subscriptions
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.geyserStream) {
      this.geyserStream.cancel();
      this.geyserStream = null;
    }

    if (this.wsSubscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.wsSubscriptionId);
      this.wsSubscriptionId = null;
    }

    logger.info(i18n.t('system', 'disconnected', { chain: 'Solana' }));
  }
}
