/**
 * ============================================
 * Arabic Translation Dictionary
 * قاموس الترجمة العربية
 * ============================================
 */

import { TranslationStrings } from './types';

export const ar: TranslationStrings = {
  system: {
    startup: '[النظام] جاري تشغيل البوت... الوضع: {mode}',
    shutdown: '[النظام] جاري إيقاف البوت بأمان...',
    connected: '[متصل] تم إنشاء اتصال RPC مع {chain}',
    disconnected: '[انقطاع] فُقد الاتصال مع {chain}',
    reconnecting: '[إعادة الاتصال] محاولة إعادة الاتصال بـ {chain}...',
    error: '[خطأ] {message}',
    warning: '[تحذير] {message}',
    info: '[معلومة] {message}',
    paperMode: '[محاكاة] يعمل في وضع المحاكاة - لا مخاطرة بأموال حقيقية',
    liveMode: '[حقيقي] يعمل بأموال حقيقية - توخَّ الحذر',
  },

  scanner: {
    newPoolDetected: '[الماسح] تم اكتشاف تجمع سيولة جديد على {chain} | المنصة: {dex} | العملة: {token}',
    scanningToken: '[الماسح] جاري فحص العملة {token} على {chain}...',
    tokenApproved: '[مقبول] العملة {token} اجتازت جميع فحوصات الأمان',
    tokenRejected: '[مرفوض] العملة {token} فشلت: {reason}',
    listeningChain: '[الماسح] جاري الاستماع لتجمعات جديدة على {chain} عبر {method}',
    blockReceived: '[بلوك] بلوك جديد #{number} على {chain}',
  },

  security: {
    auditPassed: '[التدقيق] جميع الفحوصات نجحت لـ {token} خلال {time}مللي ثانية',
    auditFailed: '[التدقيق] فشل لـ {token}: {reason}',
    mintRevoked: '[آمن] تم إلغاء صلاحية السك لـ {token}',
    mintNotRevoked: '[خطر] صلاحية السك لم تُلغَ لـ {token}',
    lpLocked: '[آمن] السيولة مقفلة/محروقة لـ {token} | المبلغ: {amount}',
    lpNotLocked: '[خطر] السيولة غير مقفلة لـ {token}',
    honeypotDetected: '[فخ عسل] العملة {token} هي فخ عسل - لا يمكن البيع',
    topHoldersRisk: '[خطر] أكبر 10 حاملين يملكون {percent}% من عرض {token}',
    bundledWalletsDetected: '[خطر] تم اكتشاف {count} محفظة مرتبطة/مجمعة لـ {token}',
    ownershipRenounced: '[آمن] تم التنازل عن ملكية العقد لـ {token}',
    ownershipNotRenounced: '[خطر] لم يتم التنازل عن ملكية العقد لـ {token}',
  },

  sniper: {
    sniped: '[نجاح] تم قنص العملة! الهاش: {tx} | نظام الحماية من السحب نشط',
    buyExecuted: '[شراء] تم شراء {amount} من {token} بسعر {price} | TX: {tx}',
    sellExecuted: '[بيع] تم بيع {amount} من {token} بسعر {price} | الربح/الخسارة: {pnl} | TX: {tx}',
    bundleSent: '[جيتو] تم إرسال الحزمة لمحرك البلوك | الإكرامية: {tip} SOL | الفتحة: {slot}',
    frontRunDetected: '[تنبيه] تم اكتشاف فرصة استباق على {chain}',
    frontRunExecuted: '[استباق] تم الاستباق بنجاح على {chain} | TX: {tx}',
    transactionFailed: '[فشل] فشلت المعاملة: {reason} | السلسلة: {chain}',
    slippageExceeded: '[انزلاق] تجاوز الانزلاق {max}% - تم إلغاء المعاملة',
    insufficientBalance: '[الرصيد] رصيد غير كافٍ: المطلوب {needed}، المتاح {available}',
  },

  antiRug: {
    rugDetected: '[تنبيه سحب] احتمال سحب بساط لعملة {token}!',
    emergencySell: '[طوارئ] جاري تنفيذ بيع طارئ لـ {token} | TX: {tx}',
    rugPrevented: '[إنقاذ] تم منع سحب البساط! تم البيع قبل سحب السيولة | تم إنقاذ: {amount}',
    liquidityRemovalDetected: '[تنبيه] المطور يسحب السيولة من {token}!',
    massiveSellDetected: '[تنبيه] عملية بيع ضخمة ({percent}% من العرض) لعملة {token}',
    deployerActivity: '[مراقبة] محفظة المطور {wallet} تظهر نشاط مشبوه',
  },

  risk: {
    trailingStopHit: '[وقف] تم تفعيل الوقف المتحرك لـ {token} عند {price} | الربح/الخسارة: {pnl}',
    takeProfitHit: '[ربح] تم تفعيل جني الأرباح لـ {token} عند {price} | المكسب: {pnl}',
    stopLossUpdated: '[متحرك] تم تحديث وقف الخسارة لـ {token}: {oldStop} -> {newStop}',
    positionOpened: '[مركز] تم فتح مركز: {token} | الدخول: {price} | الحجم: {size}',
    positionClosed: '[مركز] تم إغلاق مركز: {token} | الخروج: {price} | الربح/الخسارة: {pnl}',
    pnlReport: '[PNL] الربح/الخسارة اليومي: {pnl} | نسبة الفوز: {winRate}% | الصفقات: {trades}',
    dailyLimitReached: '[حد] تم الوصول لحد الخسارة اليومي - إيقاف التداول مؤقتاً',
  },

  telegram: {
    botStarted: '🤖 بوت القنص يعمل\nالوضع: {mode}\nالسلاسل: {chains}',
    newSnipe: '🎯 قنص جديد!\nالعملة: {token}\nالسلسلة: {chain}\nالمبلغ: {amount}\nTX: {tx}',
    rugAlert: '🚨 تنبيه سحب بساط!\nالعملة: {token}\nالإجراء: بيع طارئ\nتم الإنقاذ: {amount}',
    profitAlert: '💰 ربح!\nالعملة: {token}\nالربح/الخسارة: +{pnl}\nمدة الاحتفاظ: {time}',
    lossAlert: '📉 خسارة\nالعملة: {token}\nالربح/الخسارة: {pnl}\nالسبب: {reason}',
    statusReport: '📊 تقرير الحالة\nالمراكز النشطة: {positions}\nالربح/الخسارة اليومي: {pnl}\nنسبة الفوز: {winRate}%',
    commandHelp: '📋 الأوامر:\n/status - حالة البوت\n/positions - المراكز النشطة\n/pnl - تقرير الأرباح\n/pause - إيقاف مؤقت\n/resume - استئناف\n/settings - عرض الإعدادات',
  },
};
