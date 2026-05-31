# 🤖 TRAD - Multi-Chain Memecoin Sniper & Anti-Rug Bot
# تراد - بوت قنص العملات الميمية متعدد السلاسل ومضاد لسحب البساط

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📋 جدول المحتويات

- [نظرة عامة](#نظرة-عامة)
- [المعمارية](#المعمارية)
- [السلاسل والمنصات المدعومة](#السلاسل-والمنصات-المدعومة)
- [خطوات التشغيل الكاملة](#خطوات-التشغيل-الكاملة)
- [الإعدادات](#الإعدادات)
- [تشغيل البوت](#تشغيل-البوت)
- [كيف تتحول الأرباح إليك](#كيف-تتحول-الأرباح-إليك)
- [أوامر تيليجرام](#أوامر-تيليجرام)
- [تحذيرات أمنية](#تحذيرات-أمنية)

---

## نظرة عامة

**TRAD** بوت قنص عملات ميمية يعمل على 4 سلاسل بلوكتشين، يكتشف العملات الجديدة ويشتريها خلال ملي ثوانٍ، ثم يبيعها تلقائياً عند تحقق الربح أو لحمايتك من سحب البساط.

**كيف يربح؟** يشتري العملة لحظة إنشاء السيولة (قبل الجميع)، ثم يبيعها عندما يرتفع السعر. الأرباح تبقى **في محفظتك مباشرة** كعملة أصلية (SOL/ETH/BNB/SUI).

---

## المعمارية

```
┌─────────────────────────────────────────────────────────────────┐
│                    المنسق الرئيسي (Orchestrator v2)               │
└───────┬─────────────┬─────────────┬─────────────┬───────────────┘
        │             │             │             │
   ┌────▼────┐  ┌─────▼─────┐ ┌────▼────┐  ┌────▼────┐
   │ الماسح  │  │ المدقق    │ │ القناص  │  │تيليجرام │
   │Scanner │  │ Auditor   │ │ Sniper  │  │  Bot    │
   │         │  │           │ │         │  │         │
   │• gRPC   │  │• Mint     │ │• Jito   │  │• تنبيهات│
   │• WS     │  │• LP Lock  │ │• V3 Route│ │• أوامر │
   │• Events │  │• Honeypot │ │• Cetus  │  │• تقارير │
   └────┬────┘  └─────┬─────┘ └────┬────┘  └─────────┘
        │             │             │
        ▼             ▼             ▼
┌─────────────────────────────────────────┐
│         إدارة المخاطر + مراقب Mempool    │
│  • Trailing Stop    • Anti-Rug          │
│  • Take Profit      • Emergency Exit    │
│  • Paper Trading    • Auto-Blacklist    │
└───────────────────────┬─────────────────┘
                        │
                        ▼
              💰 أرباحك في محفظتك
```

---

## السلاسل والمنصات المدعومة

| السلسلة | المنصات | طريقة الاتصال | عملة الأرباح |
|---------|---------|---------------|-------------|
| **Solana** | Raydium, Pump.fun | gRPC Geyser | SOL |
| **Base** | Uniswap V3, Aerodrome, Virtuals.io | WebSocket | ETH |
| **Sui** | Cetus, BlueMove, DeepBook | Event Sub | SUI |
| **BNB** | PancakeSwap | WebSocket | BNB |
| **Hyperliquid** | Native DEX | REST API | USDC |

---

## 💰 كيف تتحول الأرباح إليك

### آلية الربح:

```
1. البوت يكتشف عملة جديدة          ← خلال 100ms من إنشائها
2. يفحصها أمنياً (هل هي آمنة؟)     ← خلال 5ms
3. يشتريها من محفظتك               ← يدفع SOL/ETH/BNB/SUI من رصيدك
4. يراقب السعر لحظياً              ← كل ثانية
5. يبيعها تلقائياً عند:
   • ارتفاع 100% (Take Profit)     ← مثلاً: دفعت 0.5 SOL ← رجع 1 SOL
   • أو هبوط 20% (Trailing Stop)   ← يحمي من الخسارة الكبيرة
   • أو كشف rug pull              ← يبيع قبل سحب السيولة
6. الناتج (SOL/ETH/...) يرجع لمحفظتك مباشرة ✅
```

### أين تذهب الأرباح؟

| السلسلة | ماذا يحدث عند البيع | أين ينتهي الربح |
|---------|---------------------|-----------------|
| **Solana** | Swap Token → SOL | **محفظتك نفسها** (نفس Private Key) |
| **Base** | Swap Token → WETH → ETH | **محفظتك على Base** |
| **BNB** | Swap Token → WBNB → BNB | **محفظتك على BNB Chain** |
| **Sui** | Swap Token → SUI | **محفظتك على Sui** |

### ⚡ مهم: لا يوجد "تحويل" خارجي!

**الأرباح لا تنتقل لمكان آخر** — البوت يستخدم **محفظتك أنت** (Private Key في `.env`).
- كل عملية شراء = سحب من رصيدك
- كل عملية بيع = إيداع في رصيدك
- **أنت المالك الوحيد** — لا أحد آخر يملك وصولاً

### 📊 مثال عملي:

```
رصيد البداية:     2.0 SOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
صفقة 1: اشترى PEPE بـ 0.5 SOL → باع بـ 1.2 SOL  (ربح +0.7 SOL) ✅
صفقة 2: اشترى DOGE بـ 0.5 SOL → باع بـ 0.4 SOL  (خسارة -0.1 SOL) ❌
صفقة 3: اشترى MEME بـ 0.5 SOL → rug detected → باع بـ 0.45 SOL (إنقاذ!) 🛡️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
رصيد النهاية:     2.55 SOL  (ربح صافي +0.55 SOL)
الرصيد يبقى في نفس المحفظة!
```

### 💸 سحب الأرباح لحسابك:

عندما تريد سحب أرباحك:
- **SOL** → حوّل من Phantom/Solflare لمنصة (Binance/OKX) → اسحب لحسابك البنكي
- **ETH (Base)** → Bridge لـ Ethereum mainnet → بيع في منصة
- **BNB** → أرسل مباشرة لـ Binance → سحب
- **SUI** → أرسل لمنصة تدعم SUI → سحب

---

## خطوات التشغيل الكاملة

### المتطلبات:
- Node.js 18+ (مُثبت)
- خادم VPS (موصى: US-East لقرب Jito)
- محفظة مموّلة
- حساب RPC (Helius/Alchemy)

---

### الخطوة 1: تحميل المشروع

```bash
git clone https://github.com/sun9shine/trad.git
cd trad
npm install
```

---

### الخطوة 2: إنشاء ملف الإعدادات

```bash
cp .env.example .env
nano .env   # أو أي محرر نصوص
```

---

### الخطوة 3: تعبئة الإعدادات الأساسية

```env
# ═══════════════════════════════════════
# الإعدادات الأساسية (مطلوبة)
# ═══════════════════════════════════════

# اللغة: ar (عربي) أو en (إنجليزي)
LANGUAGE=ar

# الوضع: paper (محاكاة) أو live (حقيقي)
# ⚠️ ابدأ دائماً بـ paper!
TRADING_MODE=paper

# ═══════════════════════════════════════
# سولانا (الأهم - أكثر العملات الميمية)
# ═══════════════════════════════════════

# من https://helius.dev (سجّل واحصل على مفتاح مجاني)
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# gRPC (اشتراك Helius مدفوع ~$100/شهر - يعطي سرعة أعلى)
SOLANA_GRPC_URL=mainnet.helius-rpc.com:2053
SOLANA_GRPC_TOKEN=your-token

# مفتاح محفظتك (Base58 من Phantom: Settings → Export Private Key)
SOLANA_PRIVATE_KEY=your-base58-private-key-here

# Jito (مجاني - لا يحتاج تسجيل)
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_DEFAULT_TIP_LAMPORTS=10000

# ═══════════════════════════════════════
# Base Chain (عملات ميمية على Layer 2)
# ═══════════════════════════════════════

# من https://alchemy.com (خطة مجانية)
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
BASE_WS_URL=wss://base-mainnet.g.alchemy.com/v2/YOUR_KEY
BASE_PRIVATE_KEY=0xYOUR_EVM_PRIVATE_KEY
BASE_FLASHBOTS_RPC=https://rpc.flashbots.net

# ═══════════════════════════════════════
# Sui
# ═══════════════════════════════════════
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443
SUI_WS_URL=wss://fullnode.mainnet.sui.io
SUI_PRIVATE_KEY=your-hex-private-key

# ═══════════════════════════════════════
# BNB Chain
# ═══════════════════════════════════════
BNB_RPC_URL=https://bsc-dataseed1.binance.org
BNB_WS_URL=wss://bsc-ws-node.nariox.org
BNB_PRIVATE_KEY=0xYOUR_PRIVATE_KEY

# ═══════════════════════════════════════
# تيليجرام (للإشعارات)
# ═══════════════════════════════════════

# أنشئ بوت عبر @BotFather في تيليجرام
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNO
# احصل على ID من @userinfobot
TELEGRAM_CHAT_ID=your-chat-id

# ═══════════════════════════════════════
# إدارة المخاطر
# ═══════════════════════════════════════

# حد الشراء لكل صفقة
MAX_BUY_AMOUNT_SOL=0.5
MAX_BUY_AMOUNT_ETH=0.1
MAX_BUY_AMOUNT_SUI=50

# متى يبيع تلقائياً
TRAILING_STOP_PERCENT=20       # يبيع إذا هبط 20% من أعلى سعر
TAKE_PROFIT_PERCENT=100        # يبيع عند ربح 100% (2x)
MAX_SLIPPAGE_PERCENT=15        # أقصى انزلاق مقبول

# فلتر الأمان
MAX_TOP10_HOLDER_PERCENT=15    # رفض إذا أكبر 10 حاملين > 15%
REQUIRE_MINT_REVOKED=true      # رفض إذا السك لم يُلغَ
REQUIRE_LP_LOCKED=true         # رفض إذا السيولة غير مقفلة
```

---

### الخطوة 4: تمويل المحافظ

| السلسلة | الحد الأدنى | الموصى | من أين؟ |
|---------|-------------|--------|---------|
| **SOL** | 0.5 SOL | 2+ SOL | Phantom → إيداع من منصة |
| **ETH (Base)** | 0.05 ETH | 0.3+ ETH | Bridge من Ethereum أو منصة تدعم Base |
| **SUI** | 10 SUI | 100+ SUI | Sui Wallet → إيداع |
| **BNB** | 0.2 BNB | 1+ BNB | MetaMask → إيداع |

---

### الخطوة 5: التشغيل (وضع المحاكاة أولاً!)

```bash
# ━━━ المرحلة 1: محاكاة (3-7 أيام) ━━━
# لا يخاطر بأموال حقيقية - يرسل إشعارات كأنه يتداول
npm run paper

# ━━━ المرحلة 2: مبالغ صغيرة ━━━
# عدّل .env:
# TRADING_MODE=live
# MAX_BUY_AMOUNT_SOL=0.05
npm start

# ━━━ المرحلة 3: تشغيل كامل ━━━
# بعد التأكد من الأداء:
# MAX_BUY_AMOUNT_SOL=0.5
npm start
```

---

### الخطوة 6: المراقبة

```bash
# مراقبة السجلات
tail -f logs/combined.log

# لوحة المعلومات (متصفح)
# افتح: http://your-server:3848

# فحص الصحة
curl http://localhost:3847/health

# مقاييس Prometheus
curl http://localhost:3847/metrics
```

---

### الخطوة 7: النشر الدائم (VPS)

```bash
# باستخدام PM2 (موصى)
npm install -g pm2
npm run build
pm2 start dist/index.js --name trad-bot
pm2 save
pm2 startup   # يعيد التشغيل بعد إعادة تشغيل الخادم

# أو باستخدام Docker
docker-compose up -d
docker logs -f trad-sniper-bot
```

---

## الإعدادات

### إعدادات إدارة المخاطر (مهمة!)

| الإعداد | الوصف | القيمة الافتراضية | نصيحة |
|---------|-------|-------------------|-------|
| `MAX_BUY_AMOUNT_SOL` | حد الشراء لكل صفقة | 0.5 SOL | ابدأ بـ 0.05 |
| `TRAILING_STOP_PERCENT` | نسبة وقف الخسارة المتحرك | 20% | 15-30% |
| `TAKE_PROFIT_PERCENT` | نسبة جني الأرباح | 100% | 50-200% |
| `MAX_SLIPPAGE_PERCENT` | أقصى انزلاق | 15% | 10-20% |
| `REQUIRE_MINT_REVOKED` | رفض إذا السك لم يُلغَ | true | أبقِه true |
| `REQUIRE_LP_LOCKED` | رفض إذا السيولة غير مقفلة | true | أبقِه true |

### كيف يعمل Trailing Stop (الوقف المتحرك):

```
اشتريت بسعر: 1.0
━━━━━━━━━━━━━━━━━━━━
السعر يرتفع → 1.5 → وقف الخسارة يصعد لـ 1.2 (20% تحت)
السعر يرتفع → 2.0 → وقف الخسارة يصعد لـ 1.6
السعر يرتفع → 3.0 → وقف الخسارة يصعد لـ 2.4
السعر يهبط → 2.4 → يبيع! ← ربح 140%

بدون Trailing Stop: كان ممكن يرجع لـ 0.5 وتخسر 50%
```

---

## أوامر تيليجرام

| الأمر | الوصف |
|-------|-------|
| `/start` | عرض قائمة الأوامر |
| `/status` | حالة البوت + الربح اليومي |
| `/positions` | المراكز المفتوحة حالياً |
| `/pnl` | تقرير الأرباح والخسائر |
| `/pause` | إيقاف مؤقت (يتوقف عن الشراء) |
| `/resume` | استئناف (يعود للعمل) |
| `/lang` | تبديل اللغة عربي/إنجليزي |

---

## تحذيرات أمنية

### ⚠️ مهم جداً:

1. **لا تشارك `.env` أبداً** — يحتوي مفاتيحك الخاصة
2. **ابدأ بوضع Paper** — تأكد البوت يعمل قبل المخاطرة
3. **استخدم محفظة منفصلة** — لا تستخدم محفظتك الرئيسية
4. **ابدأ بمبالغ صغيرة** — 0.05 SOL كحد أقصى في البداية
5. **VPS آمن** — استخدم خادم بحماية SSH key
6. **لا تضع أكثر مما تتحمل خسارته** — سوق العملات الميمية خطير

### 🔒 أين تكون محفظتك آمنة؟

```
✅ المفتاح في .env على خادمك فقط
✅ .env مضاف في .gitignore (لن يُرفع لـ GitHub)
✅ يمكنك تشفيره عبر Key Vault المدمج:
   VAULT_MASTER_PASSWORD=your-strong-password
```

### 📍 موقع VPS الأمثل:

| السلسلة | أفضل موقع | السبب |
|---------|-----------|-------|
| Solana | US-East (Virginia) | قريب من Jito Block Engines |
| Base/ETH | US-East أو EU-West | قريب من Alchemy/Infura |
| BNB | Singapore | قريب من خوادم Binance |

---

## هيكل المشروع

```
trad/
├── src/
│   ├── index.ts                 # المنسق الرئيسي v2
│   ├── config/                  # إدارة الإعدادات
│   ├── i18n/                    # نظام الترجمة (عربي/إنجليزي)
│   ├── scanner/                 # اكتشاف العملات الجديدة
│   │   ├── solana-scanner.ts    # Geyser gRPC
│   │   ├── evm-scanner.ts       # Base/BNB WebSocket
│   │   ├── sui-scanner.ts       # Sui Events
│   │   └── virtuals-scanner.ts  # Virtuals.io
│   ├── security/                # التدقيق الأمني (<5ms)
│   ├── sniper/                  # محركات التنفيذ
│   │   ├── solana-sniper.ts     # Jito Bundles
│   │   ├── evm-sniper.ts        # V3 Router + Tenderly + Tax
│   │   ├── sui-sniper.ts        # Cetus SDK + DeepBook
│   │   ├── hyperliquid-sniper.ts
│   │   ├── tenderly-sim.ts      # محاكاة قبل التنفيذ
│   │   ├── uniswap-router.ts    # توجيه متعدد القفزات
│   │   ├── tax-simulator.ts     # كشف الضرائب
│   │   ├── cetus-sdk.ts         # تكامل Cetus
│   │   └── deepbook-v2.ts       # دفتر أوامر Sui
│   ├── risk/                    # إدارة المخاطر
│   ├── price-feed/              # أسعار حية
│   ├── database/                # تخزين الصفقات
│   ├── telegram/                # بوت تيليجرام
│   ├── dashboard/               # لوحة معلومات WebSocket
│   ├── health/                  # فحص الصحة + Prometheus
│   └── utils/                   # أدوات مساعدة
├── tests/                       # اختبارات
├── .env.example                 # قالب الإعدادات
├── Dockerfile                   # حاوية Docker
├── docker-compose.yml           # نشر مع Redis
└── .github/workflows/ci.yml     # CI/CD
```

---

## الرخصة والإخلاء

MIT License - استخدام على مسؤوليتك الخاصة.

**تحذير:** تداول العملات المشفرة ينطوي على مخاطر مالية كبيرة. هذا البرنامج لأغراض تعليمية. لا تستثمر أكثر مما يمكنك تحمل خسارته.

---

## الدعم

- **تيليجرام:** أوامر `/help` داخل البوت
- **السجلات:** `logs/combined.log`
- **لوحة المعلومات:** `http://server:3848`
- **الصحة:** `http://server:3847/health`
