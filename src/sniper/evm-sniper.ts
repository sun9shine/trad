/**
 * ============================================
 * EVM Sniper - Flashbots/Private RPC Execution
 * قناص EVM - تنفيذ Flashbots/RPC خاص
 * ============================================
 * 
 * Implements ultra-fast token sniping on Base/BNB via:
 * - Private RPC mempool submission (bypass public mempool)
 * - Dynamic gas pricing with priority fee bribes
 * - Flashbots-style bundle submission for MEV protection
 * - Anti-rug mempool monitoring for front-running liquidations
 * 
 * Flow:
 * 1. Detect new liquidity addition in mempool
 * 2. Construct buy tx with competitive gas
 * 3. Submit via private RPC to land in same block
 */

import { 
  ethers, 
  Wallet, 
  JsonRpcProvider, 
  Contract, 
  parseEther, 
  formatEther,
  parseUnits,
  TransactionRequest,
  TransactionResponse,
} from 'ethers';
import { config } from '../config';
import { EVM } from '../utils/constants';
import { TokenInfo, ExecutionResult, TradeSignal } from '../utils/types';
import { i18n } from '../i18n';
import { logger } from '../utils/logger';
import axios from 'axios';

// Uniswap V2 Router ABI (swap functions)
const ROUTER_V2_ABI = [
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) returns (uint[] memory amounts)',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)',
  'function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)',
];

// Uniswap V3 Router ABI
const ROUTER_V3_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
  'function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) payable returns (uint256 amountOut)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export class EVMSniper {
  private baseProvider: JsonRpcProvider;
  private bnbProvider: JsonRpcProvider;
  private baseWallet: Wallet;
  private bnbWallet: Wallet;
  private flashbotsProvider: JsonRpcProvider;

  constructor() {
    this.baseProvider = new JsonRpcProvider(config.base.rpcUrl);
    this.bnbProvider = new JsonRpcProvider(config.bnb.rpcUrl);
    this.baseWallet = new Wallet(config.base.privateKey || '', this.baseProvider);
    this.bnbWallet = new Wallet(config.bnb.privateKey || '', this.bnbProvider);
    this.flashbotsProvider = new JsonRpcProvider(config.base.flashbotsRpc);
  }

  /**
   * Execute a snipe buy on EVM chain
   * تنفيذ شراء قنص على سلسلة EVM
   */
  async snipeBuy(signal: TradeSignal): Promise<ExecutionResult> {
    const token = signal.token;
    const isBase = token.chain === 'base';
    const wallet = isBase ? this.baseWallet : this.bnbWallet;
    const provider = isBase ? this.baseProvider : this.bnbProvider;

    try {
      // Determine router based on DEX
      const routerAddress = this.getRouterAddress(token.dex, token.chain);
      const wethAddress = this.getWETHAddress(token.chain);
      
      // Calculate amount with slippage
      const amountInWei = parseEther(signal.amount.toString());
      const minAmountOut = await this.calculateMinOutput(
        routerAddress, wethAddress, token.address, 
        amountInWei, signal.maxSlippage, provider
      );

      // Build swap transaction
      const router = new Contract(routerAddress, ROUTER_V2_ABI, wallet);
      const deadline = Math.floor(Date.now() / 1000) + 60; // 60 second deadline

      // Get optimal gas parameters
      const gasParams = await this.getOptimalGasParams(provider, signal.priority);

      // Execute swap
      const tx: TransactionResponse = await router.swapExactETHForTokens(
        minAmountOut,
        [wethAddress, token.address],
        wallet.address,
        deadline,
        {
          value: amountInWei,
          ...gasParams,
        }
      );

      logger.info(i18n.t('sniper', 'buyExecuted', {
        amount: signal.amount.toString(),
        token: token.address.slice(0, 12) + '...',
        price: 'pending',
        tx: tx.hash,
      }));

      // Wait for confirmation
      const receipt = await tx.wait(1);

      if (receipt && receipt.status === 1) {
        logger.info(i18n.t('sniper', 'sniped', { tx: tx.hash }));
        return {
          success: true,
          txHash: tx.hash,
          gasUsed: Number(receipt.gasUsed),
          chain: token.chain,
          timestamp: Date.now(),
        };
      }

      return {
        success: false,
        txHash: tx.hash,
        error: 'Transaction reverted',
        chain: token.chain,
        timestamp: Date.now(),
      };

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(i18n.t('sniper', 'transactionFailed', { 
        reason: errMsg, 
        chain: token.chain 
      }));
      
      return {
        success: false,
        error: errMsg,
        chain: token.chain,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute emergency sell via private RPC (anti-rug)
   * تنفيذ بيع طارئ عبر RPC خاص (مضاد لسحب البساط)
   */
  async emergencySell(
    tokenAddress: string, 
    chain: 'base' | 'bnb',
    amount?: bigint
  ): Promise<ExecutionResult> {
    const wallet = chain === 'base' ? this.baseWallet : this.bnbWallet;
    const provider = chain === 'base' ? this.baseProvider : this.bnbProvider;

    try {
      const tokenContract = new Contract(tokenAddress, ERC20_ABI, wallet);
      const balance = amount || await tokenContract.balanceOf(wallet.address);

      if (balance === 0n) {
        return { success: false, error: 'Zero balance', chain, timestamp: Date.now() };
      }

      const routerAddress = this.getRouterAddress('uniswap_v3', chain);
      const wethAddress = this.getWETHAddress(chain);

      // Approve router if needed
      const allowance = await tokenContract.allowance(wallet.address, routerAddress);
      if (allowance < balance) {
        const approveTx = await tokenContract.approve(
          routerAddress, 
          ethers.MaxUint256,
          { ...await this.getOptimalGasParams(provider, 'high') }
        );
        await approveTx.wait(1);
      }

      // Execute sell with high gas to front-run the rug
      const router = new Contract(routerAddress, ROUTER_V2_ABI, wallet);
      const deadline = Math.floor(Date.now() / 1000) + 30;

      // Use supportingFeeOnTransferTokens for safety
      const gasParams = await this.getOptimalGasParams(provider, 'high');
      
      const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
        balance,
        0n, // Accept any output (emergency exit)
        [tokenAddress, wethAddress],
        wallet.address,
        deadline,
        {
          ...gasParams,
          // Double the max fee for emergency
          maxFeePerGas: gasParams.maxFeePerGas ? gasParams.maxFeePerGas * 2n : undefined,
        }
      );

      logger.info(i18n.t('antiRug', 'emergencySell', { 
        token: tokenAddress.slice(0, 12) + '...', 
        tx: tx.hash 
      }));

      const receipt = await tx.wait(1);

      if (receipt && receipt.status === 1) {
        logger.info(i18n.t('antiRug', 'rugPrevented', { 
          amount: formatEther(balance) 
        }));
      }

      return {
        success: receipt?.status === 1,
        txHash: tx.hash,
        gasUsed: receipt ? Number(receipt.gasUsed) : 0,
        chain,
        timestamp: Date.now(),
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        chain,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Submit transaction via Flashbots (MEV-protected)
   * إرسال معاملة عبر Flashbots (محمية من MEV)
   */
  async submitViaFlashbots(signedTx: string): Promise<ExecutionResult> {
    try {
      const response = await axios.post(config.base.flashbotsRpc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendRawTransaction',
        params: [signedTx],
      }, { timeout: 5000 });

      return {
        success: !response.data?.error,
        txHash: response.data?.result,
        error: response.data?.error?.message,
        chain: 'base',
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        chain: 'base',
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Calculate minimum output with slippage
   */
  private async calculateMinOutput(
    routerAddress: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    maxSlippagePercent: number,
    provider: JsonRpcProvider
  ): Promise<bigint> {
    try {
      const router = new Contract(routerAddress, ROUTER_V2_ABI, provider);
      const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      const expectedOut = amounts[1];
      
      // Apply slippage
      const slippageFactor = BigInt(Math.floor((100 - maxSlippagePercent) * 100));
      return (expectedOut * slippageFactor) / 10000n;
    } catch {
      // If we can't estimate, use 0 (accept any output)
      return 0n;
    }
  }

  /**
   * Get optimal gas parameters based on priority
   * الحصول على معلمات الغاز المثلى
   */
  private async getOptimalGasParams(
    provider: JsonRpcProvider, 
    priority: 'high' | 'medium' | 'low'
  ): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasLimit: bigint }> {
    const feeData = await provider.getFeeData();
    
    const priorityMultiplier = {
      high: 3n,
      medium: 2n,
      low: 1n,
    };

    const mult = priorityMultiplier[priority];
    const basePriorityFee = feeData.maxPriorityFeePerGas || parseUnits('1', 'gwei');
    
    return {
      maxFeePerGas: (feeData.maxFeePerGas || parseUnits('50', 'gwei')) * mult,
      maxPriorityFeePerGas: basePriorityFee * mult,
      gasLimit: 500000n,
    };
  }

  /**
   * Get router address for a given DEX
   */
  private getRouterAddress(dex: string, chain: string): string {
    if (chain === 'base') {
      if (dex === 'aerodrome') return EVM.AERODROME_ROUTER;
      return EVM.UNISWAP_V3_ROUTER;
    }
    // BNB
    return '0x10ED43C718714eb63d5aA57B78B54704E256024E'; // PancakeSwap Router
  }

  /**
   * Get wrapped native token address
   */
  private getWETHAddress(chain: string): string {
    if (chain === 'base') return '0x4200000000000000000000000000000000000006';
    return '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'; // WBNB
  }

  /**
   * Get wallet ETH/BNB balance
   */
  async getBalance(chain: 'base' | 'bnb'): Promise<number> {
    const provider = chain === 'base' ? this.baseProvider : this.bnbProvider;
    const wallet = chain === 'base' ? this.baseWallet : this.bnbWallet;
    const balance = await provider.getBalance(wallet.address);
    return Number(formatEther(balance));
  }
}
