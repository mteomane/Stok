import { SubscriptionRepository } from "../interfaces";
import { Subscription, PlanId, SubscriptionEntitlement } from "../../../types";
import { db } from "../../firebase";
import { Firestore, doc, getDoc } from "firebase/firestore";
import { 
  TRIAL_DAYS_DEFAULT, 
  computeSubscriptionEntitlement 
} from "../../subscriptionConfig";
import { getLocal, setLocal, SEED_SUBSCRIPTION } from "./helpers";
import { FirebaseUserRepository } from "./FirebaseUserRepository";
import { assertAuthenticated, isDemoUser, isDemoAllowed } from "../../authGuard";

export class FirebaseSubscriptionRepository implements SubscriptionRepository {
  private userRepo: FirebaseUserRepository;
  private db: Firestore;

  constructor(userRepo?: FirebaseUserRepository, customDb?: Firestore) {
    this.userRepo = userRepo || new FirebaseUserRepository(customDb);
    this.db = customDb || db;
  }

  /**
   * Retrieves tenant subscription state.
   * NOTE: Subscriptions are strictly READ-ONLY for client SDKs.
   * If a subscription document does not exist yet in Firestore, a default 14-day Pro trial
   * object is provided in memory without performing an unauthorized client-side write.
   */
  async getByTenantId(tenantId: string): Promise<Subscription> {
    if (isDemoUser(tenantId) || (!tenantId && isDemoAllowed())) {
      return getLocal<Subscription>("stokpro_demo_subscription", SEED_SUBSCRIPTION);
    }

    if (!tenantId) {
      throw new Error("Unauthorized: [SubscriptionRepository.getByTenantId] tenantId parametresi eksik.");
    }

    try {
      const subRef = doc(this.db, "subscriptions", tenantId);
      const subSnap = await getDoc(subRef);

      if (subSnap.exists()) {
        return { id: subSnap.id, ...subSnap.data() } as Subscription;
      }

      // Default safe in-memory trial for new tenants without client-side setDoc
      const initialSub: Subscription = {
        id: tenantId,
        tenantId,
        planId: "pro",
        status: "trialing",
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        trialEndDate: new Date(Date.now() + TRIAL_DAYS_DEFAULT * 24 * 60 * 60 * 1000).toISOString(),
        provider: "none",
        createdAt: new Date().toISOString()
      };

      return initialSub;
    } catch (err) {
      console.warn("FirebaseSubscriptionRepository fetch notice:", err);
      if (isDemoAllowed()) {
        return getLocal<Subscription>("stokpro_demo_subscription", SEED_SUBSCRIPTION);
      }
      throw err;
    }
  }

  /**
   * CRITICAL SECURITY BARRIER:
   * Client-side plan updates are strictly forbidden in production.
   * Plan upgrades and mutations MUST originate from verified server-side webhooks
   * (iyzico / PayTR / Stripe) using Firebase Admin SDK privileges.
   */
  async updatePlan(
    tenantId: string, 
    planId: PlanId, 
    billingPeriod: "monthly" | "yearly" = "monthly"
  ): Promise<Subscription> {
    if (isDemoUser(tenantId) && isDemoAllowed()) {
      const current = await this.getByTenantId(tenantId);
      const now = new Date();
      const periodDays = billingPeriod === "yearly" ? 365 : 30;
      const endDate = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000).toISOString();

      const updatedSub: Subscription = {
        ...current,
        planId,
        status: "active",
        startDate: now.toISOString(),
        endDate,
        updatedAt: now.toISOString()
      };
      setLocal("stokpro_demo_subscription", updatedSub);
      return updatedSub;
    }

    // PRODUCTION SECURITY ENFORCEMENT:
    // Block client-side privilege escalation (e.g. Free -> Enterprise)
    throw new Error(
      "GÜVENLİK ENGELİ: Abonelik planı istemci (client) tarafından doğrudan değiştirilemez. " +
      "Plan güncellemeleri yalnızca doğrulanmış sunucu tarafı ödeme webhook/checkout akışı üzerinden gerçekleştirilebilir."
    );
  }

  /**
   * CRITICAL SECURITY BARRIER:
   * Client-side subscription cancellation writes are forbidden in production.
   */
  async cancel(tenantId: string): Promise<Subscription> {
    if (isDemoUser(tenantId) && isDemoAllowed()) {
      const current = await this.getByTenantId(tenantId);
      const updated: Subscription = {
        ...current,
        cancelAtPeriodEnd: true,
        updatedAt: new Date().toISOString()
      };
      setLocal("stokpro_demo_subscription", updated);
      return updated;
    }

    // PRODUCTION SECURITY ENFORCEMENT:
    throw new Error(
      "GÜVENLİK ENGELİ: Abonelik iptali veya durum değişikliği istemci tarafından doğrudan veritabanına yazılamaz. " +
      "Lütfen hesap ayarları veya müşteri hizmetleri üzerinden iptal talebi oluşturun."
    );
  }

  async getEntitlement(uid: string): Promise<SubscriptionEntitlement> {
    const validUid = assertAuthenticated(uid, "SubscriptionRepository.getEntitlement");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const subscription = await this.getByTenantId(context.tenantId);

    // Fallback counts for decoupling
    let productCount = 0;
    let warehouseCount = 1;

    if (isDemoUser(validUid)) {
      const demoProducts = getLocal<any[]>("stokpro_demo_products", []);
      productCount = demoProducts.filter(p => p.isActive !== false).length;
    }

    return computeSubscriptionEntitlement({
      subscription,
      productCount,
      warehouseCount,
      userCount: 1
    });
  }
}
