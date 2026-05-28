# 🤖 TRAD - Multi-Chain Memecoin Sniper & Anti-Rug Bot
# تراد - بوت قنص العملات الميمية متعدد السلاسل ومضاد لسحب البساط

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📋 Table of Contents / جدول المحتويات

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Supported Chains & DEXs](#supported-chains--dexs)
- [Features](#features)
- [Setup Guide](#setup-guide)
- [Configuration](#configuration)
- [Running the Bot](#running-the-bot)
- [Telegram Commands](#telegram-commands)
- [Security Considerations](#security-considerations)

---

## Overview

**TRAD** is a high-performance, multi-chain memecoin sniper bot with built-in anti-rug protection, bilingual interface (Arabic/English), and advanced risk management. It operates across Solana, Base, Sui, and BNB Chain with ultra-low latency execution.

**تراد** هو بوت عالي الأداء لقنص العملات الميمية متعدد السلاسل مع حماية مدمجة من سحب البساط، وواجهة ثنائية اللغة (عربي/إنجليزي)، وإدارة مخاطر متقدمة.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      MAIN ORCHESTRATOR                           │
│                    (Event-Driven Pipeline)                       │
└───────┬────────────────────┬────────────────────┬───────────────┘
        │                    │                    │
┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
│   SCANNER     │   │   SECURITY    │   │   TELEGRAM    │
│ (Discovery)   │   │   (Auditor)   │   │   (Notify)    │
│               │   │               │   │               │
│ • Solana gRPC │   │ • Mint Check  │   │ • Alerts      │
│ • Base WS     │   │ • LP Lock     │   │ • Commands    │
│ • Sui Events  │   │ • Honeypot    │   │ • Reports     │
│ • BNB WS      │   │ • Holders     │   │               │
└───────┬───────┘   └───────┬───────┘   └───────────────┘
        │                    │
        ▼                    ▼
┌─────────────────────────────────────────┐
│             EXECUTION ENGINE            │
│                                         │
│  ┌──────────┐  ┌──────────┐  ┌───────┐ │
│  │ Solana   │  │  EVM     │  │Mempool│ │
│  │ Sniper   │  │  Sniper  │  │Monitor│ │
│  │(Jito)    │  │(Flashbot)│  │(Anti) │ │
│  └──────────┘  └──────────┘  └───────┘ │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│          RISK MANAGEMENT                │
│                                         │
│  • Position Manager (Trailing Stop)     │
│  • Paper Trading (Simulation)           │
│  • Daily Limits & PnL Tracking          │
└─────────────────────────────────────────┘
```

**Data Flow:** `RPC/gRPC → Scanner → Auditor (<5ms) → Sniper → Position Manager ↔ Mempool Monitor`

---

## Supported Chains & DEXs

| Chain | DEXs | Connection Method |
|-------|------|-------------------|
| **Solana** | Raydium AMM V4/CPMM/CLMM, Pump.fun | gRPC Geyser (Helius/Triton) + WebSocket |
| **Base** | Uniswap V3, Aerodrome, Virtuals.io | WebSocket event subscription |
| **Sui** | Cetus CLMM, BlueMove | SuiEvent subscription + polling |
| **BNB Chain** | PancakeSwap V2/V3 | WebSocket event subscription |

---

## Features

### 🎯 Token Discovery (Scanner)
- Real-time new pool detection within milliseconds of creation
- Solana: gRPC Geyser plugin for `initialize2` instruction detection
- EVM: WebSocket subscription to `PairCreated` / `PoolCreated` events
- Sui: Move event filtering by Cetus/BlueMove package IDs

### 🛡️ Security Auditing (Anti-Rug)
- **<5ms** parallel security checks:
  - Mint/Freeze Authority revocation (Solana)
  - Contract ownership renouncement (EVM)
  - LP token burn/lock verification
  - Top 10 holder concentration analysis (max 15%)
  - Bundled wallet detection
  - Honeypot simulation (via Honeypot.is / GoPlus APIs)

### ⚡ Ultra-Fast Execution (Sniper)
- **Solana:** Jito Bundle API with dynamic tip calculation
- **Base/BNB:** Private RPC / Flashbots with priority fee bribes
- Front-running capability for both buy opportunities and rug protection

### 🚨 Anti-Rug Mempool Monitor
- Real-time mempool scanning for deployer `removeLiquidity` transactions
- Automatic emergency sell BEFORE the rug pull executes
- Monitors deployer wallet activity across all positions

### 📊 Risk Management
- Dynamic trailing stop-loss (adjusts with price growth)
- Configurable take-profit targets
- Daily loss limits with automatic trading pause
- Full PnL tracking and win rate statistics

### 📝 Paper Trading
- Full simulation engine with realistic slippage modeling
- Virtual execution matching real-time conditions
- Sharpe ratio calculation and performance analytics

### 🌐 Bilingual Interface (AR/EN)
- Complete Arabic and English translation system
- Toggle language via Telegram `/lang` command
- RTL support for Arabic log output

---

## Setup Guide

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** or **yarn**
- RPC endpoints for target chains
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))

### Step 1: Clone & Install

```bash
git clone https://github.com/sun9shine/trad.git
cd trad
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see [Configuration](#configuration) below).

### Step 3: Setup RPC Endpoints

#### Solana (Recommended: Helius gRPC)

1. Sign up at [Helius](https://helius.dev) or [Triton](https://triton.one)
2. Get a dedicated gRPC endpoint with Geyser plugin access
3. Set `SOLANA_GRPC_URL` and `SOLANA_GRPC_TOKEN` in `.env`
4. For standard RPC, use a dedicated node (Helius/QuickNode/Alchemy)

```env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_GRPC_URL=mainnet.helius-rpc.com:2053
SOLANA_GRPC_TOKEN=YOUR_GRPC_TOKEN
```

#### Base (Recommended: Alchemy WebSocket)

1. Sign up at [Alchemy](https://alchemy.com) or [QuickNode](https://quicknode.com)
2. Create a Base Mainnet app
3. Get WebSocket URL

```env
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
BASE_WS_URL=wss://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

#### Sui

1. Use the public fullnode or a dedicated provider
2. For production, use [Shinami](https://shinami.com) or [BlockVision](https://blockvision.org)

```env
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
SUI_WS_URL=wss://fullnode.mainnet.sui.io
```

#### BNB Chain

1. Use [NodeReal](https://nodereal.io) or [Ankr](https://ankr.com) for dedicated nodes

```env
BNB_RPC_URL=https://bsc-dataseed1.binance.org
BNB_WS_URL=wss://bsc-ws-node.nariox.org
```

### Step 4: Setup Jito (Solana MEV)

1. No API key needed for bundle submission
2. Configure tip amount based on network congestion:

```env
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_DEFAULT_TIP_LAMPORTS=10000
```

### Step 5: Setup Telegram Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Create a new bot: `/newbot`
3. Copy the token
4. Get your Chat ID from [@userinfobot](https://t.me/userinfobot)

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=your-chat-id
```

### Step 6: Fund Wallets

Ensure your trading wallets have sufficient balance:
- **Solana:** At least 1 SOL (for buys + Jito tips + rent)
- **Base:** At least 0.5 ETH (for buys + gas)
- **Sui:** At least 100 SUI (for buys + gas)
- **BNB:** At least 1 BNB (for buys + gas)

---

## Configuration

### Key Parameters in `.env`

| Parameter | Description | Default |
|-----------|-------------|---------|
| `LANGUAGE` | Interface language (`en` / `ar`) | `en` |
| `TRADING_MODE` | `paper` (simulation) or `live` | `paper` |
| `MAX_BUY_AMOUNT_SOL` | Max SOL per trade | `0.5` |
| `MAX_BUY_AMOUNT_ETH` | Max ETH per trade | `0.1` |
| `TRAILING_STOP_PERCENT` | Trailing stop-loss percentage | `20` |
| `TAKE_PROFIT_PERCENT` | Take profit percentage | `100` |
| `MAX_SLIPPAGE_PERCENT` | Maximum allowed slippage | `15` |
| `MAX_TOP10_HOLDER_PERCENT` | Max top-10 holder concentration | `15` |
| `REQUIRE_MINT_REVOKED` | Require mint authority revoked | `true` |
| `REQUIRE_LP_LOCKED` | Require LP locked/burned | `true` |

---

## Running the Bot

### Paper Trading Mode (Recommended First)

```bash
# Start in paper trading (simulation)
npm run paper
```

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

### Using PM2 (Production)

```bash
npm install -g pm2
pm2 start dist/index.js --name trad-bot
pm2 logs trad-bot
```

---

## Telegram Commands

| Command | Description | الوصف |
|---------|-------------|-------|
| `/start` | Show help menu | عرض قائمة المساعدة |
| `/status` | Bot status & daily PnL | حالة البوت والربح اليومي |
| `/positions` | List active positions | عرض المراكز النشطة |
| `/pnl` | Detailed PnL report | تقرير الأرباح المفصل |
| `/pause` | Pause scanning | إيقاف المسح مؤقتاً |
| `/resume` | Resume scanning | استئناف المسح |
| `/lang` | Toggle AR/EN language | تبديل اللغة عربي/إنجليزي |

---

## Project Structure

```
trad/
├── src/
│   ├── index.ts              # Main orchestrator & entry point
│   ├── config/
│   │   └── index.ts          # Environment & configuration management
│   ├── i18n/
│   │   ├── index.ts          # Translation engine
│   │   ├── types.ts          # Translation type definitions
│   │   ├── en.ts             # English dictionary
│   │   └── ar.ts             # Arabic dictionary
│   ├── scanner/
│   │   ├── index.ts          # Scanner orchestrator
│   │   ├── base-scanner.ts   # Abstract base scanner class
│   │   ├── solana-scanner.ts # Solana gRPC/WebSocket scanner
│   │   ├── evm-scanner.ts    # Base/BNB WebSocket scanner
│   │   └── sui-scanner.ts    # Sui event scanner
│   ├── security/
│   │   ├── index.ts          # Security module exports
│   │   ├── auditor.ts        # Main audit orchestrator
│   │   ├── solana-auditor.ts # SPL token security checks
│   │   ├── evm-auditor.ts    # ERC-20 contract checks
│   │   └── sui-auditor.ts    # Move module checks
│   ├── sniper/
│   │   ├── index.ts          # Sniper module exports
│   │   ├── solana-sniper.ts  # Jito bundle execution
│   │   ├── evm-sniper.ts     # Flashbots/private RPC execution
│   │   └── mempool-monitor.ts# Anti-rug mempool scanning
│   ├── risk/
│   │   ├── index.ts          # Risk module exports
│   │   ├── position-manager.ts # Trailing stop & position tracking
│   │   └── paper-trading.ts  # Simulation engine
│   ├── telegram/
│   │   └── bot.ts            # Telegram bot interface
│   └── utils/
│       ├── types.ts          # Shared type definitions
│       ├── constants.ts      # Known addresses & program IDs
│       └── logger.ts         # Winston logger with i18n
├── .env.example              # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

---

## Security Considerations

⚠️ **CRITICAL WARNINGS:**

1. **Private Keys:** NEVER commit `.env` to version control. It contains your private keys.
2. **Paper Trading First:** Always test with `TRADING_MODE=paper` before using real funds.
3. **Start Small:** Begin with minimal amounts (`MAX_BUY_AMOUNT_SOL=0.1`).
4. **Dedicated Wallets:** Use separate wallets for trading - never your main wallet.
5. **VPS Deployment:** Run on a low-latency VPS close to RPC endpoints for speed.
6. **Rate Limits:** Be aware of RPC rate limits; use dedicated/paid endpoints.

### Recommended VPS Locations
- **Solana:** US East (close to Jito block engines)
- **Base/BNB:** US East or EU West (close to Alchemy/Infura nodes)

---

## License

MIT License - Use at your own risk. This software is for educational purposes.
Trading cryptocurrency involves substantial risk of financial loss.

---

## Disclaimer

This bot is provided as-is for educational and research purposes. The authors are not responsible for any financial losses incurred from using this software. Always do your own research and never invest more than you can afford to lose.

هذا البوت مقدم كما هو لأغراض تعليمية وبحثية. المؤلفون غير مسؤولين عن أي خسائر مالية ناتجة عن استخدام هذا البرنامج. قم دائماً بإجراء بحثك الخاص ولا تستثمر أكثر مما يمكنك تحمل خسارته.
