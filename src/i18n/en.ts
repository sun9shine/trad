/**
 * ============================================
 * English Translation Dictionary
 * ============================================
 */

import { TranslationStrings } from './types';

export const en: TranslationStrings = {
  system: {
    startup: '[SYSTEM] Bot starting up... Mode: {mode}',
    shutdown: '[SYSTEM] Bot shutting down gracefully...',
    connected: '[CONNECTED] {chain} RPC connection established',
    disconnected: '[DISCONNECTED] {chain} connection lost',
    reconnecting: '[RECONNECTING] Attempting to reconnect to {chain}...',
    error: '[ERROR] {message}',
    warning: '[WARNING] {message}',
    info: '[INFO] {message}',
    paperMode: '[PAPER] Running in simulation mode - no real funds at risk',
    liveMode: '[LIVE] Running with REAL funds - exercise caution',
  },

  scanner: {
    newPoolDetected: '[SCANNER] New pool detected on {chain} | DEX: {dex} | Token: {token}',
    scanningToken: '[SCANNER] Auditing token {token} on {chain}...',
    tokenApproved: '[APPROVED] Token {token} passed all security checks',
    tokenRejected: '[REJECTED] Token {token} failed: {reason}',
    listeningChain: '[SCANNER] Listening for new pools on {chain} via {method}',
    blockReceived: '[BLOCK] New block #{number} on {chain}',
  },

  security: {
    auditPassed: '[AUDIT] All checks PASSED for {token} in {time}ms',
    auditFailed: '[AUDIT] FAILED for {token}: {reason}',
    mintRevoked: '[SAFE] Mint authority revoked for {token}',
    mintNotRevoked: '[DANGER] Mint authority NOT revoked for {token}',
    lpLocked: '[SAFE] Liquidity locked/burned for {token} | Amount: {amount}',
    lpNotLocked: '[DANGER] Liquidity NOT locked for {token}',
    honeypotDetected: '[HONEYPOT] Token {token} is a honeypot - cannot sell',
    topHoldersRisk: '[RISK] Top 10 holders own {percent}% of {token} supply',
    bundledWalletsDetected: '[RISK] {count} bundled/connected wallets detected for {token}',
    ownershipRenounced: '[SAFE] Contract ownership renounced for {token}',
    ownershipNotRenounced: '[DANGER] Contract ownership NOT renounced for {token}',
  },

  sniper: {
    sniped: '[SUCCESS] Token Sniped! Hash: {tx} | Anti-Rug Active',
    buyExecuted: '[BUY] Purchased {amount} of {token} @ {price} | TX: {tx}',
    sellExecuted: '[SELL] Sold {amount} of {token} @ {price} | PnL: {pnl} | TX: {tx}',
    bundleSent: '[JITO] Bundle sent to Block Engine | Tip: {tip} SOL | Slot: {slot}',
    frontRunDetected: '[ALERT] Front-run opportunity detected on {chain}',
    frontRunExecuted: '[FRONT-RUN] Successfully front-ran transaction on {chain} | TX: {tx}',
    transactionFailed: '[FAILED] Transaction failed: {reason} | Chain: {chain}',
    slippageExceeded: '[SLIPPAGE] Slippage exceeded {max}% - transaction aborted',
    insufficientBalance: '[BALANCE] Insufficient balance: need {needed}, have {available}',
  },

  antiRug: {
    rugDetected: '[RUG ALERT] Potential rug pull detected for {token}!',
    emergencySell: '[EMERGENCY] Executing emergency sell for {token} | TX: {tx}',
    rugPrevented: '[SAVED] Rug pull prevented! Sold before liquidity removal | Saved: {amount}',
    liquidityRemovalDetected: '[ALERT] Deployer removing liquidity for {token}!',
    massiveSellDetected: '[ALERT] Massive sell ({percent}% of supply) detected for {token}',
    deployerActivity: '[WATCH] Deployer wallet {wallet} showing suspicious activity',
  },

  risk: {
    trailingStopHit: '[STOP] Trailing stop triggered for {token} @ {price} | PnL: {pnl}',
    takeProfitHit: '[PROFIT] Take profit triggered for {token} @ {price} | Gain: {pnl}',
    stopLossUpdated: '[TRAIL] Stop loss updated for {token}: {oldStop} -> {newStop}',
    positionOpened: '[POSITION] Opened position: {token} | Entry: {price} | Size: {size}',
    positionClosed: '[POSITION] Closed position: {token} | Exit: {price} | PnL: {pnl}',
    pnlReport: '[PNL] Daily PnL: {pnl} | Win Rate: {winRate}% | Trades: {trades}',
    dailyLimitReached: '[LIMIT] Daily loss limit reached - pausing trading',
  },

  telegram: {
    botStarted: '🤖 Sniper Bot Online\nMode: {mode}\nChains: {chains}',
    newSnipe: '🎯 New Snipe!\nToken: {token}\nChain: {chain}\nAmount: {amount}\nTX: {tx}',
    rugAlert: '🚨 RUG ALERT!\nToken: {token}\nAction: Emergency Sell\nSaved: {amount}',
    profitAlert: '💰 Profit!\nToken: {token}\nPnL: +{pnl}\nHold Time: {time}',
    lossAlert: '📉 Loss\nToken: {token}\nPnL: {pnl}\nReason: {reason}',
    statusReport: '📊 Status Report\nActive Positions: {positions}\nDaily PnL: {pnl}\nWin Rate: {winRate}%',
    commandHelp: '📋 Commands:\n/status - Bot status\n/positions - Active positions\n/pnl - PnL report\n/pause - Pause bot\n/resume - Resume bot\n/settings - View settings',
  },
};
