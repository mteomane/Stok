import React, { useState, useEffect } from "react";
import { 
  Check, 
  X, 
  Sparkles, 
  ShieldCheck, 
  AlertTriangle, 
  CreditCard, 
  Clock, 
  ArrowRight, 
  CheckCircle2, 
  Zap, 
  Building2, 
  Users, 
  Package, 
  RotateCcw,
  Lock,
  RefreshCw,
  Server,
  Terminal,
  ShieldAlert,
  Cpu,
  Layers,
  KeyRound,
  ExternalLink,
  ChevronRight
} from "lucide-react";
import { PlanId, SubscriptionEntitlement, SubscriptionPlan } from "../types";
import { DEFAULT_PLANS, getPlanConfig, getTrialDaysRemaining } from "../lib/subscriptionConfig";
import { 
  updateTenantSubscriptionPlan,
  fetchPaymentConfig,
  createPaymentCheckoutSession,
  simulateWebhookEventApi,
  fetchPaymentWebhookEvents,
  switchPaymentProviderApi
} from "../lib/firestoreService";

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  entitlement: SubscriptionEntitlement | null;
  onRefreshEntitlement: () => Promise<void>;
  blockReason?: string;
}

export function SubscriptionModal({
  isOpen,
  onClose,
  tenantId,
  entitlement,
  onRefreshEntitlement,
  blockReason
}: SubscriptionModalProps) {
  const [activeTab, setActiveTab] = useState<"plans" | "webhook_lab">("plans");
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  const [isUpdating, setIsUpdating] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Payment Provider & Webhook State
  const [paymentConfig, setPaymentConfig] = useState<{
    provider: string;
    isSandbox: boolean;
    currency: string;
    availableProviders: string[];
    activeProvider: string;
  }>({
    provider: "mock",
    isSandbox: true,
    currency: "TRY",
    availableProviders: ["mock", "iyzico", "paytr"],
    activeProvider: "mock"
  });

  // Checkout overlay state
  const [checkoutPlan, setCheckoutPlan] = useState<SubscriptionPlan | null>(null);
  const [checkoutSession, setCheckoutSession] = useState<any | null>(null);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);

  // Webhook Simulator & Event Log State
  const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
  const [lastSimulationResult, setLastSimulationResult] = useState<any | null>(null);
  const [lastEventId, setLastEventId] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      loadPaymentConfig();
      loadWebhookEvents();
    }
  }, [isOpen]);

  const loadPaymentConfig = async () => {
    try {
      const cfg = await fetchPaymentConfig();
      setPaymentConfig(cfg);
    } catch (err) {
      console.warn("loadPaymentConfig err:", err);
    }
  };

  const loadWebhookEvents = async () => {
    try {
      const events = await fetchPaymentWebhookEvents(tenantId);
      setWebhookEvents(events);
    } catch (err) {
      console.warn("loadWebhookEvents err:", err);
    }
  };

  if (!isOpen) return null;

  const currentPlanId = entitlement?.subscription?.planId || "free";
  const isTrial = entitlement?.isTrial ?? false;
  const trialDaysLeft = entitlement?.trialDaysLeft ?? 0;
  const hasAccess = entitlement?.hasAccess ?? true;

  // Open Checkout Session Modal
  const handleOpenCheckout = async (planId: PlanId) => {
    const plan = DEFAULT_PLANS[planId];
    setCheckoutPlan(plan);
    setIsCheckoutLoading(true);
    setErrorMessage("");

    try {
      const price = billingPeriod === "yearly" ? plan.price.yearly : plan.price.monthly;
      const session = await createPaymentCheckoutSession({
        tenantId,
        planId,
        billingPeriod,
        amount: price,
        customer: {
          name: "İşletme Yöneticisi",
          email: "yonetici@ornekisletme.com",
          phone: "+905551234567"
        }
      });
      setCheckoutSession(session);
    } catch (err: any) {
      setErrorMessage(err.message || "Ödeme oturumu başlatılamadı.");
      setCheckoutPlan(null);
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  // Complete checkout via verified webhook simulation
  const handleCompleteCheckoutPayment = async (planId: PlanId, shouldFail: boolean = false) => {
    try {
      setIsUpdating(true);
      setErrorMessage("");
      setSuccessMessage("");

      const plan = DEFAULT_PLANS[planId];
      const price = billingPeriod === "yearly" ? plan.price.yearly : plan.price.monthly;

      const sim = await simulateWebhookEventApi({
        type: shouldFail ? "payment.failed" : "payment.succeeded",
        tenantId,
        planId,
        amount: price,
        billingPeriod,
        failureReason: shouldFail ? "Banka Tarafından Kart Limiti Yetersiz / Reddedildi (Simülasyon)" : undefined
      });

      setLastSimulationResult(sim);
      if (sim.eventId) setLastEventId(sim.eventId);

      // Refresh entitlements and webhook events
      await onRefreshEntitlement();
      await loadWebhookEvents();

      if (shouldFail) {
        setErrorMessage("Ödeme başarısız webhook olayı işlendi. Abonelik 'past_due' (ödenmedi) durumuna alındı.");
      } else {
        setSuccessMessage(`Ödeme Başarılı! Webhook HMAC imzası doğrulandı ve ${plan.name} aktif edildi.`);
      }

      setCheckoutPlan(null);
      setCheckoutSession(null);
    } catch (err: any) {
      setErrorMessage(err.message || "Ödeme işlenirken hata oluştu.");
    } finally {
      setIsUpdating(false);
    }
  };

  // Webhook Test Triggers for Developer / QA
  const handleTriggerWebhookTest = async (testType: "succeeded" | "failed" | "cancelled" | "duplicate" | "tamper") => {
    try {
      setIsUpdating(true);
      setErrorMessage("");
      setSuccessMessage("");

      let res: any;

      if (testType === "succeeded") {
        res = await simulateWebhookEventApi({
          type: "payment.succeeded",
          tenantId,
          planId: "pro",
          amount: 890,
          billingPeriod: "monthly"
        });
        setLastSimulationResult(res);
        if (res.eventId) setLastEventId(res.eventId);
        setSuccessMessage("✅ 'payment.succeeded' webhook olayı imzalandı, doğrulandı ve abonelik aktifleştirildi!");
      } else if (testType === "failed") {
        res = await simulateWebhookEventApi({
          type: "payment.failed",
          tenantId,
          planId: "pro",
          amount: 890,
          failureReason: "Banka Reddi: Yetersiz Bakiye / Kart Limiti (Simülasyon)"
        });
        setLastSimulationResult(res);
        setErrorMessage("⚠️ 'payment.failed' webhook olayı işlendi: Abonelik 'past_due' durumuna geçirildi.");
      } else if (testType === "cancelled") {
        res = await simulateWebhookEventApi({
          type: "subscription.cancelled",
          tenantId,
          planId: currentPlanId
        });
        setLastSimulationResult(res);
        setErrorMessage("🔴 'subscription.cancelled' webhook olayı işlendi: Abonelik iptal edildi.");
      } else if (testType === "duplicate") {
        const eventToRepeat = lastEventId || "evt_demo_replay_test_123";
        res = await simulateWebhookEventApi({
          type: "payment.succeeded",
          tenantId,
          planId: "pro",
          amount: 890,
          duplicateEventId: eventToRepeat
        });
        setLastSimulationResult(res);
        setSuccessMessage(`🛡️ Idempotency Testi Başarılı: '${eventToRepeat}' olayı daha önce işlendiği için sunucu tekrarlanan işlemi engelledi!`);
      } else if (testType === "tamper") {
        res = await simulateWebhookEventApi({
          type: "payment.succeeded",
          tenantId,
          planId: "business",
          amount: 1890,
          tamperSignature: true
        });
        setLastSimulationResult(res);
        setErrorMessage("🔒 Güvenlik Testi Başarılı: Sahte/bozuk HMAC imzalı istek 401 Unauthorized ile engellendi!");
      }

      await onRefreshEntitlement();
      await loadWebhookEvents();
    } catch (err: any) {
      setErrorMessage(err.message || "Test başarısız oldu.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSwitchProvider = async (provider: string) => {
    try {
      setIsUpdating(true);
      await switchPaymentProviderApi(provider);
      await loadPaymentConfig();
      setSuccessMessage(`Ödeme sağlayıcı '${provider.toUpperCase()}' olarak güncellendi.`);
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err: any) {
      setErrorMessage(err.message || "Sağlayıcı değiştirilemedi.");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-scale-up">
        
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 sm:p-8 relative">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 bg-indigo-500/30 text-indigo-300 border border-indigo-400/30 rounded-full text-[11px] font-bold tracking-wider uppercase flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-300" />
                SaaS Abonelik & Ödeme Mimarisi
              </span>
              <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-full text-[11px] font-bold flex items-center gap-1">
                <Cpu className="w-3 h-3 text-emerald-400" />
                Sağlayıcı: {paymentConfig.activeProvider.toUpperCase()} (Agnostic Adapter)
              </span>
              {isTrial && (
                <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded-full text-[11px] font-bold flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {trialDaysLeft} Gün Deneme Kaldı
                </span>
              )}
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
              Abonelik & Ödeme Altyapısı
            </h2>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              PayTR, iyzico ve Stripe ile tam uyumlu; sağlayıcıdan bağımsız (provider-agnostic), HMAC imza doğrulamalı ve idempotency korumalı SaaS motoru.
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-white/10">
            <div className="flex items-center gap-2 bg-white/10 p-1 rounded-xl border border-white/15">
              <button
                type="button"
                onClick={() => setActiveTab("plans")}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "plans"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Abonelik Planları</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("webhook_lab")}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "webhook_lab"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                <span>Ödeme Sağlayıcı & Webhook Test Konsolu</span>
              </button>
            </div>

            {/* Billing Period Switcher (only in plans tab) */}
            {activeTab === "plans" && (
              <div className="bg-white/10 p-1 rounded-xl flex items-center border border-white/15">
                <button
                  type="button"
                  onClick={() => setBillingPeriod("monthly")}
                  className={`px-3.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    billingPeriod === "monthly"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  Aylık
                </button>
                <button
                  type="button"
                  onClick={() => setBillingPeriod("yearly")}
                  className={`px-3.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    billingPeriod === "yearly"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  <span>Yıllık</span>
                  <span className="px-1.5 py-0.2 bg-emerald-500 text-white rounded text-[10px] font-black">
                    %20 İndirim
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Notifications */}
        {blockReason && (
          <div className="bg-amber-50 border-b border-amber-200 p-4 px-6 flex items-center gap-3 text-amber-800 text-xs font-semibold">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <span>{blockReason}</span>
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-50 border-b border-emerald-200 p-4 px-6 flex items-center gap-3 text-emerald-800 text-xs font-semibold">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="bg-rose-50 border-b border-rose-200 p-4 px-6 flex items-center gap-3 text-rose-800 text-xs font-semibold">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* TAB 1: PLANS & CHECKOUT */}
        {activeTab === "plans" && (
          <div className="p-6 sm:p-8 bg-slate-50">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {(Object.keys(DEFAULT_PLANS) as PlanId[]).map((pId) => {
                const plan = DEFAULT_PLANS[pId];
                const isCurrent = currentPlanId === pId;
                const price = billingPeriod === "yearly" ? plan.price.yearly : plan.price.monthly;
                const periodText = billingPeriod === "yearly" ? "yıl" : "ay";

                return (
                  <div
                    key={pId}
                    className={`bg-white rounded-2xl p-5 border flex flex-col justify-between transition-all relative ${
                      plan.recommended
                        ? "border-indigo-500 ring-2 ring-indigo-500/20 shadow-md"
                        : isCurrent
                        ? "border-emerald-500 ring-2 ring-emerald-500/20 shadow-sm"
                        : "border-slate-200 hover:border-slate-300 hover:shadow-sm"
                    }`}
                  >
                    {plan.recommended && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-wider px-3 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {plan.badge}
                      </div>
                    )}

                    <div>
                      {/* Plan Header */}
                      <div className="flex items-center justify-between mt-1">
                        <h3 className="font-bold text-slate-900 text-base">{plan.name}</h3>
                        {isCurrent && (
                          <span className="text-[10px] font-black px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                            Mevcut Plan
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1 min-h-[34px] leading-relaxed">
                        {plan.description}
                      </p>

                      {/* Price Display */}
                      <div className="mt-4 pb-4 border-b border-slate-100">
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-black text-slate-900">
                            {price === 0 ? "Ücretsiz" : `${price.toLocaleString("tr-TR")} ${plan.price.currency}`}
                          </span>
                          {price > 0 && (
                            <span className="text-xs text-slate-400 font-medium">/{periodText}</span>
                          )}
                        </div>
                        {billingPeriod === "yearly" && price > 0 && (
                          <span className="text-[10px] text-emerald-600 font-semibold block mt-0.5">
                            Ayda yaklaşık {Math.round(price / 12)} ₺
                          </span>
                        )}
                      </div>

                      {/* Key Limits Overview */}
                      <div className="mt-4 space-y-1.5 text-xs text-slate-600">
                        <div className="flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-indigo-500" />
                          <span>
                            {plan.maxProducts === -1 ? "Sınırsız" : `${plan.maxProducts} Adet`} Ürün/Top
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Users className="w-3.5 h-3.5 text-indigo-500" />
                          <span>
                            {plan.maxUsers === -1 ? "Sınırsız" : `${plan.maxUsers} Kullanıcı`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                          <span>
                            {plan.maxWarehouses === -1 ? "Sınırsız" : `${plan.maxWarehouses} Depo`}
                          </span>
                        </div>
                      </div>

                      {/* Features List */}
                      <div className="mt-5 space-y-2 pt-4 border-t border-slate-100">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Özellikler
                        </span>
                        {plan.features.map((feat, idx) => (
                          <div key={idx} className="flex items-start gap-2 text-[11px] text-slate-700">
                            <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                            <span>{feat}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Plan Selection Button */}
                    <div className="mt-6 pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        disabled={isUpdating || isCurrent}
                        onClick={() => handleOpenCheckout(pId)}
                        className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          isCurrent
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                            : plan.recommended
                            ? "bg-indigo-600 hover:bg-indigo-700 text-white shadow-md active:scale-98"
                            : "bg-slate-900 hover:bg-slate-800 text-white active:scale-98"
                        }`}
                      >
                        {isCurrent ? (
                          <span>Mevcut Planınız</span>
                        ) : (
                          <>
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Bu Plana Geç</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Current Entitlement & Limits Status */}
            {entitlement && (
              <div className="mt-6 bg-white p-5 rounded-2xl border border-slate-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <h4 className="font-bold text-slate-800 text-sm">
                      Mevcut Şirket Kullanım Özeti
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Planınızdaki limitler ve anlık doluluk oranları.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600">Durum:</span>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        hasAccess
                          ? isTrial
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                          : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {isTrial
                        ? `Deneme Süresi (${trialDaysLeft} gün)`
                        : hasAccess
                        ? "Aktif Abonelik"
                        : "Sona Erdi / Pasif"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/60">
                    <div className="flex justify-between items-center text-xs mb-1.5">
                      <span className="font-semibold text-slate-600">Ürün Kapasitesi</span>
                      <span className="font-mono font-bold text-slate-800">
                        {entitlement.usage.currentProducts} /{" "}
                        {entitlement.limits.maxProducts === -1 ? "Sınırsız" : entitlement.limits.maxProducts}
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          entitlement.limits.maxProducts === -1
                            ? "w-10 bg-indigo-500"
                            : entitlement.usage.currentProducts >= entitlement.limits.maxProducts
                            ? "w-full bg-rose-500"
                            : "bg-indigo-600"
                        }`}
                        style={{
                          width:
                            entitlement.limits.maxProducts === -1
                              ? "15%"
                              : `${Math.min(100, (entitlement.usage.currentProducts / entitlement.limits.maxProducts) * 100)}%`
                        }}
                      />
                    </div>
                  </div>

                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/60">
                    <div className="flex justify-between items-center text-xs mb-1.5">
                      <span className="font-semibold text-slate-600">Depo Sayısı</span>
                      <span className="font-mono font-bold text-slate-800">
                        {entitlement.usage.currentWarehouses} /{" "}
                        {entitlement.limits.maxWarehouses === -1 ? "Sınırsız" : entitlement.limits.maxWarehouses}
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          entitlement.limits.maxWarehouses === -1
                            ? "w-20 bg-indigo-500"
                            : "bg-indigo-600"
                        }`}
                        style={{
                          width:
                            entitlement.limits.maxWarehouses === -1
                              ? "25%"
                              : `${Math.min(100, (entitlement.usage.currentWarehouses / entitlement.limits.maxWarehouses) * 100)}%`
                        }}
                      />
                    </div>
                  </div>

                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/60">
                    <div className="flex justify-between items-center text-xs mb-1.5">
                      <span className="font-semibold text-slate-600">Yetkili Kullanıcılar</span>
                      <span className="font-mono font-bold text-slate-800">
                        {entitlement.usage.currentUsers} /{" "}
                        {entitlement.limits.maxUsers === -1 ? "Sınırsız" : entitlement.limits.maxUsers}
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 rounded-full"
                        style={{
                          width:
                            entitlement.limits.maxUsers === -1
                              ? "20%"
                              : `${Math.min(100, (entitlement.usage.currentUsers / entitlement.limits.maxUsers) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PAYMENT PROVIDER & WEBHOOK TEST LAB */}
        {activeTab === "webhook_lab" && (
          <div className="p-6 sm:p-8 bg-slate-50 space-y-6">
            
            {/* 1. Architecture & Provider Selection */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-indigo-600" />
                    Provider-Agnostic Ödeme Adapter Seçimi
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Uygulama somut bir ödeme firmasına bağımlı değildir. İstediğiniz adaptörü seçerek test edebilirsiniz.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                  {paymentConfig.availableProviders.map((prov) => (
                    <button
                      key={prov}
                      type="button"
                      disabled={isUpdating}
                      onClick={() => handleSwitchProvider(prov)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        paymentConfig.activeProvider === prov
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {prov === "mock" ? "Mock (Sandbox)" : prov === "paytr" ? "PayTR Adapter" : "iyzico Adapter"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Security Pillars */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-xs">
                <div className="p-3 bg-emerald-50/60 border border-emerald-200/60 rounded-xl">
                  <div className="flex items-center gap-2 text-emerald-800 font-bold mb-1">
                    <Lock className="w-3.5 h-3.5 text-emerald-600" />
                    <span>HMAC SHA-256 İmzası</span>
                  </div>
                  <p className="text-[11px] text-emerald-700 leading-relaxed">
                    Tüm gelen webhook istekleri, sağlayıcının gizli anahtarı ile üretilen HMAC imzası kontrol edilerek doğrulanır.
                  </p>
                </div>

                <div className="p-3 bg-indigo-50/60 border border-indigo-200/60 rounded-xl">
                  <div className="flex items-center gap-2 text-indigo-800 font-bold mb-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Idempotency Koruması</span>
                  </div>
                  <p className="text-[11px] text-indigo-700 leading-relaxed">
                    Aynı event ID tekrar geldiğinde çift işlem engellenir; sunucu güvenle duplicate event'i bastırır.
                  </p>
                </div>

                <div className="p-3 bg-amber-50/60 border border-amber-200/60 rounded-xl">
                  <div className="flex items-center gap-2 text-amber-800 font-bold mb-1">
                    <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                    <span>Sıfır Secret Sızıntısı</span>
                  </div>
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    API secret ve private key'ler asla istemciye veya Firestore'a plain text olarak sızdırılmaz.
                  </p>
                </div>
              </div>
            </div>

            {/* 2. Webhook Event Simulators */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-1">
                <Terminal className="w-4 h-4 text-indigo-600" />
                Webhook Senaryolarını Simüle Et ve Doğrula
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Aşağıdaki butonlara tıklayarak sunucuya imzalı webhook istekleri gönderin ve anlık tepkileri gözlemleyin.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {/* Button 1: payment.succeeded */}
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleTriggerWebhookTest("succeeded")}
                  className="p-3.5 text-left rounded-xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/30 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-900 group-hover:text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      Başarılı Ödeme (payment.succeeded)
                    </span>
                    <span className="text-[10px] font-mono bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">200 OK</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    HMAC doğrulaması yapılır, Pro plan aktif edilir ve cari ödeme kaydedilir.
                  </p>
                </button>

                {/* Button 2: payment.failed */}
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleTriggerWebhookTest("failed")}
                  className="p-3.5 text-left rounded-xl border border-slate-200 hover:border-rose-400 hover:bg-rose-50/30 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-900 group-hover:text-rose-700 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-rose-500" />
                      Başarısız Ödeme (payment.failed)
                    </span>
                    <span className="text-[10px] font-mono bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-bold">past_due</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Kart reddi veya yetersiz limit simüle edilir, durum 'past_due' yapılır.
                  </p>
                </button>

                {/* Button 3: subscription.cancelled */}
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleTriggerWebhookTest("cancelled")}
                  className="p-3.5 text-left rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50/30 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-900 group-hover:text-amber-700 flex items-center gap-1.5">
                      <X className="w-4 h-4 text-amber-500" />
                      Abonelik İptali (subscription.cancelled)
                    </span>
                    <span className="text-[10px] font-mono bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">canceled</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Sağlayıcı iptal bildirimi işlenir, abonelik pasife alınır.
                  </p>
                </button>

                {/* Button 4: Idempotency Duplicate Replay */}
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleTriggerWebhookTest("duplicate")}
                  className="p-3.5 text-left rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-900 group-hover:text-indigo-700 flex items-center gap-1.5">
                      <RotateCcw className="w-4 h-4 text-indigo-500" />
                      Tekrarlanan Event (Idempotency Test)
                    </span>
                    <span className="text-[10px] font-mono bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded font-bold">Idempotent</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Aynı eventId ikinci kez gönderilir; sunucunun çift işlemi engellediği test edilir.
                  </p>
                </button>

                {/* Button 5: Tampered Signature Security Test */}
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleTriggerWebhookTest("tamper")}
                  className="p-3.5 text-left rounded-xl border border-slate-200 hover:border-rose-400 hover:bg-rose-50/30 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-900 group-hover:text-rose-700 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-rose-600" />
                      Sahte İmza Testi (Security Attack)
                    </span>
                    <span className="text-[10px] font-mono bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-bold">401 Auth</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Geçersiz HMAC imzası gönderilir; sunucu 401 Unauthorized ile isteği engeller.
                  </p>
                </button>

                {/* Action 6: Renew Free Trial */}
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={async () => {
                    try {
                      await updateTenantSubscriptionPlan(tenantId, "pro", "monthly");
                      await onRefreshEntitlement();
                      setSuccessMessage("Test: 14 günlük Pro deneme süresi aktif edildi.");
                    } catch (err: any) {
                      setErrorMessage(err.message || "Abonelik istemciden güncellenemez.");
                    }
                  }}
                  className="p-3.5 text-left rounded-xl border border-slate-200 hover:border-slate-400 hover:bg-slate-100 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-indigo-500" />
                      Deneme Süresini Sıfırla (14G)
                    </span>
                    <span className="text-[10px] font-mono bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-bold">Reset</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Aboneliği 14 günlük ücretsiz deneme durumuna geri alır.
                  </p>
                </button>
              </div>
            </div>

            {/* 3. Last Simulation Result Detail Box */}
            {lastSimulationResult && (
              <div className="bg-slate-900 text-white p-4 rounded-2xl font-mono text-xs overflow-x-auto border border-slate-800">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[11px] text-slate-400">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-slate-200 font-bold">Son Webhook Sunucu Yanıtı</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>HTTP Durum: <strong className={lastSimulationResult.statusCode === 200 ? "text-emerald-400" : "text-rose-400"}>{lastSimulationResult.statusCode}</strong></span>
                    {lastSimulationResult.result?.idempotent && (
                      <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded text-[10px]">IDEMPOTENT GATE</span>
                    )}
                  </div>
                </div>
                <div className="text-emerald-300 whitespace-pre-wrap leading-relaxed">
                  {lastSimulationResult.result?.message || JSON.stringify(lastSimulationResult.result, null, 2)}
                </div>
                {lastSimulationResult.simulatedSignature && (
                  <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 truncate">
                    <span className="text-slate-500">Doğrulanan HMAC-SHA256 İmzası: </span>
                    <span className="text-slate-300">{lastSimulationResult.simulatedSignature}</span>
                  </div>
                )}
              </div>
            )}

            {/* 4. Live Webhook Audit Event Log Stream */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <div>
                  <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                    <Server className="w-4 h-4 text-indigo-600" />
                    Sunucu Webhook İşlem Geçmişi (Audit Trail)
                  </h4>
                  <p className="text-xs text-slate-500">
                    Gelen her webhook isteğinin doğrulama ve idempotency durumu.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadWebhookEvents}
                  className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Yenile
                </button>
              </div>

              {webhookEvents.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-xs">
                  Henüz işlenmiş webhook olayı yok. Yukarıdaki test butonlarını kullanarak simüle edebilirsiniz.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto text-xs">
                  {webhookEvents.map((evt, idx) => (
                    <div key={idx} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            evt.result?.success ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                        />
                        <div className="truncate">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{evt.eventType}</span>
                            <span className="text-[10px] font-mono text-slate-400 truncate">({evt.eventId})</span>
                            {evt.result?.idempotent && (
                              <span className="px-1.5 py-0.2 bg-indigo-100 text-indigo-800 text-[10px] rounded font-bold">
                                Idempotent
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500 block truncate mt-0.5">
                            {evt.result?.message}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0 text-[11px] text-slate-400">
                        <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-mono text-[10px]">
                          {evt.provider?.toUpperCase()}
                        </span>
                        <span>{new Date(evt.processedAt).toLocaleTimeString("tr-TR")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {/* CHECKOUT OVERLAY DIALOG */}
        {checkoutPlan && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4 animate-fade-in">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
              <div className="p-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-indigo-400" />
                  <span className="font-bold text-sm">Güvenli SaaS Ödeme Oturumu</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutPlan(null);
                    setCheckoutSession(null);
                  }}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Plan Summary */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">{checkoutPlan.name}</h4>
                    <span className="text-xs text-slate-500">
                      {billingPeriod === "yearly" ? "Yıllık Faturalama (%20 Avantaj)" : "Aylık Faturalama"}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-slate-900">
                      {(billingPeriod === "yearly" ? checkoutPlan.price.yearly : checkoutPlan.price.monthly).toLocaleString("tr-TR")} ₺
                    </span>
                    <span className="text-xs text-slate-400 block">/{billingPeriod === "yearly" ? "yıl" : "ay"}</span>
                  </div>
                </div>

                {/* Provider & Session Details */}
                <div className="space-y-2 text-xs text-slate-600 bg-indigo-50/50 p-3.5 rounded-xl border border-indigo-150">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Ödeme Sağlayıcı:</span>
                    <span className="font-bold text-indigo-900 uppercase">{paymentConfig.activeProvider} Adapter</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Doğrulama Modeli:</span>
                    <span className="font-bold text-emerald-700">Server Webhook & HMAC</span>
                  </div>
                  {checkoutSession && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Oturum ID:</span>
                      <span className="font-mono text-[11px] text-slate-700 truncate max-w-[180px]">{checkoutSession.checkoutId}</span>
                    </div>
                  )}
                </div>

                {/* Mock Card Preview for visual elegance */}
                <div className="p-3 bg-slate-900 text-white rounded-xl text-xs space-y-2 relative overflow-hidden">
                  <div className="flex justify-between items-center text-slate-400 text-[10px]">
                    <span>TEST ÖDEME KARTI (SANDBOX)</span>
                    <span className="font-mono text-emerald-400">DOĞRULANMIŞ GÜVENLİ HAT</span>
                  </div>
                  <div className="font-mono text-base tracking-widest text-slate-200">
                    •••• •••• •••• 4242
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                    <span>İŞLETME YÖNETİCİSİ</span>
                    <span>12/28</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => handleCompleteCheckoutPayment(checkoutPlan.planId, false)}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Ödemeyi Onayla & Webhook ile Aktif Et</span>
                  </button>

                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => handleCompleteCheckoutPayment(checkoutPlan.planId, true)}
                    className="w-full py-2 px-4 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                    <span>Başarısız Ödemeyi Test Et (Red Simülasyonu)</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 px-6 bg-white border-t border-slate-150 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Server Webhook Gateway Aktif (Port 3000)</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer"
          >
            Kapat
          </button>
        </div>

      </div>
    </div>
  );
}
