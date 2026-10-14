import { PlanId, Subscription, SubscriptionPlan, SubscriptionEntitlement } from "../types";

export const TRIAL_DAYS_DEFAULT = 14;

/**
 * Dinamik SaaS Plan Tanımları.
 * Fiyatlar ve limitler hard-code sabitler yerine konfigüre edilebilir yapıdadır.
 */
export const DEFAULT_PLANS: Record<PlanId, SubscriptionPlan> = {
  free: {
    planId: "free",
    name: "Ücretsiz Başlangıç",
    badge: "Free",
    description: "Yeni başlayan küçük işletmeler ve sistemi denemek isteyenler için.",
    price: {
      monthly: 0,
      yearly: 0,
      currency: "₺"
    },
    billingPeriod: "monthly",
    maxUsers: 1,
    maxProducts: 50,
    maxWarehouses: 1,
    maxStorage: 50, // 50 MB
    features: [
      "50 Adet Ürün / Kumaş Takibi",
      "1 Kullanıcı Erişimi",
      "1 Adet Depo",
      "Temel Satış & Fiş Oluşturma",
      "QR / Barkod Üretimi"
    ]
  },
  starter: {
    planId: "starter",
    name: "Starter (Gelişen İşletme)",
    badge: "Popüler Başlangıç",
    description: "Büyüyen atölye, mağaza ve perakendeciler için ideal paket.",
    price: {
      monthly: 390,
      yearly: 3900,
      currency: "₺"
    },
    billingPeriod: "monthly",
    maxUsers: 3,
    maxProducts: 500,
    maxWarehouses: 2,
    maxStorage: 500, // 500 MB
    features: [
      "500 Adet Ürün & Kumaş Rulosu",
      "3 Kullanıcı (Yetki Rolleri)",
      "2 Adet Depo Yönetimi",
      "Top & Metraj Kesim Takibi",
      "Toplu QR / Barkod Etiket Basımı",
      "Müşteri & Tedarikçi Cari Hesapları"
    ]
  },
  pro: {
    planId: "pro",
    name: "Profesyonel (Pro)",
    badge: "En Çok Tercih Edilen",
    description: "Orta ölçekli tekstil, gıda veya teknik işletmeler için tam teşekküllü ERP çözümü.",
    price: {
      monthly: 890,
      yearly: 8900,
      currency: "₺"
    },
    billingPeriod: "monthly",
    recommended: true,
    maxUsers: 10,
    maxProducts: 5000,
    maxWarehouses: 5,
    maxStorage: 5000, // 5 GB
    features: [
      "5.000 Adet Ürün & Sınırsız Top Takibi",
      "10 Kullanıcı & Gelişmiş RBAC Rolleri",
      "5 Adet Depo & Depolar Arası Transfer",
      "İrsaliye & Sevk Yönetimi",
      "Gelişmiş Satış & Kar/Zarar Raporları",
      "Değiştirilemez Denetim İzleri (Audit Logs)",
      "Öncelikli WhatsApp / Telefon Desteği"
    ]
  },
  business: {
    planId: "business",
    name: "Kurumsal (Business Enterprise)",
    badge: "Limitsiz Güç",
    description: "Büyük ölçekli fabrikalar, zincir şubeler ve yüksek hacimli toptancılar için.",
    price: {
      monthly: 1890,
      yearly: 18900,
      currency: "₺"
    },
    billingPeriod: "monthly",
    maxUsers: -1, // Sınırsız
    maxProducts: -1, // Sınırsız
    maxWarehouses: -1, // Sınırsız
    maxStorage: 50000, // 50 GB
    features: [
      "Sınırsız Ürün & Stok Hareketi",
      "Sınırsız Kullanıcı & Çoklu Şirket/Şube",
      "Sınırsız Depo & Gelişmiş Lojistik",
      "Özel API & Webhook Entegrasyonları",
      "Özel SLA & 7/24 Özel Müşteri Temsilcisi",
      "Otomatik Bulut Yedekleme & Özel Sunucu"
    ]
  }
};

/**
 * Returns plan details for a planId or defaults to free.
 */
export function getPlanConfig(planId?: string): SubscriptionPlan {
  if (!planId) return DEFAULT_PLANS.free;
  const normalized = planId.toLowerCase() as PlanId;
  return DEFAULT_PLANS[normalized] || DEFAULT_PLANS.free;
}

/**
 * Calculates remaining trial days.
 */
export function getTrialDaysRemaining(subscription?: Subscription | null): number {
  if (!subscription || !subscription.trialEndDate) return 0;
  const trialEnd = new Date(subscription.trialEndDate).getTime();
  const now = Date.now();
  if (trialEnd <= now) return 0;
  return Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
}

/**
 * Checks whether the subscription currently grants access.
 * Returns true if active, or if currently in a valid trial period.
 */
export function isSubscriptionActive(subscription?: Subscription | null): boolean {
  if (!subscription) return true; // Legacy/demo safety fallback

  if (subscription.status === "active") {
    // If end date passed and not renewed, handle grace period or expired
    if (subscription.endDate) {
      const end = new Date(subscription.endDate).getTime();
      return end > Date.now();
    }
    return true;
  }

  if (subscription.status === "trialing") {
    return getTrialDaysRemaining(subscription) > 0;
  }

  return false;
}

/**
 * Computes complete entitlement report for a tenant.
 */
export function computeSubscriptionEntitlement(params: {
  subscription?: Subscription | null;
  productCount: number;
  warehouseCount: number;
  userCount: number;
}): SubscriptionEntitlement {
  const { subscription, productCount, warehouseCount, userCount } = params;

  // Sane default subscription if not created yet (e.g. newly provisioned tenant or legacy)
  const effectiveSub: Subscription = subscription || {
    tenantId: "current",
    planId: "pro", // Default legacy / demo tenants to Pro so nothing breaks
    status: "trialing",
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    trialEndDate: new Date(Date.now() + TRIAL_DAYS_DEFAULT * 24 * 60 * 60 * 1000).toISOString(),
    provider: "none"
  };

  const plan = getPlanConfig(effectiveSub.planId);
  const trialDaysLeft = getTrialDaysRemaining(effectiveSub);
  const isTrial = effectiveSub.status === "trialing" && trialDaysLeft > 0;
  const hasAccess = isSubscriptionActive(effectiveSub);

  const maxProducts = plan.maxProducts;
  const maxWarehouses = plan.maxWarehouses;
  const maxUsers = plan.maxUsers;
  const maxStorage = plan.maxStorage;

  const canAddProduct = hasAccess && (maxProducts === -1 || productCount < maxProducts);
  const canAddWarehouse = hasAccess && (maxWarehouses === -1 || warehouseCount < maxWarehouses);
  const canAddUser = hasAccess && (maxUsers === -1 || userCount < maxUsers);

  // Feature gates based on plan tier
  const isPaidOrTrial = effectiveSub.planId !== "free" || isTrial;
  const canUseAdvancedReports = hasAccess && (isPaidOrTrial || effectiveSub.planId === "pro" || effectiveSub.planId === "business");
  const canUseMultiWarehouse = hasAccess && (maxWarehouses === -1 || maxWarehouses > 1);
  const canUseAuditLogs = hasAccess && (effectiveSub.planId === "pro" || effectiveSub.planId === "business" || isTrial);

  const isOverLimit = (maxProducts !== -1 && productCount >= maxProducts);

  let reason: string | undefined = undefined;
  if (!hasAccess) {
    reason = isTrial 
      ? "Deneme süreniz sona erdi. Kullanmaya devam etmek için lütfen bir plan seçin." 
      : "Aboneliğiniz aktif değil. Lütfen aboneliğinizi yenileyin.";
  } else if (isOverLimit) {
    reason = `Mevcut planınızın (${plan.name}) ürün sınırı (${maxProducts}) dolmuştur. Yeni ürün eklemek için paketinizi yükseltin.`;
  }

  return {
    hasAccess,
    isTrial,
    trialDaysLeft,
    plan,
    subscription: effectiveSub,
    limits: {
      maxProducts,
      maxWarehouses,
      maxUsers,
      maxStorage
    },
    usage: {
      currentProducts: productCount,
      currentWarehouses: warehouseCount,
      currentUsers: userCount
    },
    canAddProduct,
    canAddWarehouse,
    canAddUser,
    canUseAdvancedReports,
    canUseMultiWarehouse,
    canUseAuditLogs,
    isOverLimit,
    reason
  };
}
