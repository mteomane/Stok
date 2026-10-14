import { Subscription, PlanId, SubscriptionStatus } from "../../types";

/**
 * Server-Side Subscription Administration Abstraction
 * 
 * Target Architecture:
 * ┌──────────────────────────┐
 * │ Payment Provider         │ (iyzico / PayTR / Stripe)
 * └────────────┬─────────────┘
 *              │ Webhook Notification
 *              ▼
 * ┌──────────────────────────┐
 * │ Webhook Endpoint         │ (/api/payment/webhook)
 * └────────────┬─────────────┘
 *              │ Signature Verification & Idempotency
 *              ▼
 * ┌──────────────────────────┐
 * │ Server / Cloud Function  │ (Privileged Backend Runtime)
 * └────────────┬─────────────┘
 *              │ Firebase Admin SDK (Bypasses Client firestore.rules)
 *              ▼
 * ┌──────────────────────────┐
 * │ Firestore Database       │ (/subscriptions/{tenantId} - READ-ONLY to Clients)
 * └──────────────────────────┘
 * 
 * CRITICAL SECURITY PRINCIPLE:
 * Clients can ONLY read their own tenant's subscription document.
 * Any update to `planId`, `status`, `endDate`, or `provider` is strictly rejected
 * if initiated by client-side credentials.
 */
export interface IServerSubscriptionAdminService {
  /**
   * Provision or activate a paid subscription following a verified payment webhook.
   */
  provisionPaidSubscription(params: {
    tenantId: string;
    planId: PlanId;
    billingPeriod: "monthly" | "yearly";
    provider: "iyzico" | "paytr" | "stripe" | "manual";
    providerCustomerId?: string;
    providerSubscriptionId?: string;
  }): Promise<Subscription>;

  /**
   * Transition subscription status (active, past_due, canceled, expired).
   */
  updateSubscriptionStatus(params: {
    tenantId: string;
    status: SubscriptionStatus;
    cancelAtPeriodEnd?: boolean;
    reason?: string;
  }): Promise<Subscription>;

  /**
   * Reset or extend trial periods (admin-only).
   */
  extendTrialPeriod(params: {
    tenantId: string;
    additionalDays: number;
    authorizedAdminUid: string;
  }): Promise<Subscription>;
}

/**
 * Stub / Reference implementation for server runtime.
 * When running in Node.js / Express backend with Firebase Admin SDK,
 * this class interacts with Firestore using admin credentials.
 */
export class ServerSubscriptionAdminService implements IServerSubscriptionAdminService {
  async provisionPaidSubscription(params: {
    tenantId: string;
    planId: PlanId;
    billingPeriod: "monthly" | "yearly";
    provider: "iyzico" | "paytr" | "stripe" | "manual";
    providerCustomerId?: string;
    providerSubscriptionId?: string;
  }): Promise<Subscription> {
    const now = new Date();
    const periodDays = params.billingPeriod === "yearly" ? 365 : 30;
    const endDate = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000).toISOString();

    const subscription: Subscription = {
      id: params.tenantId,
      tenantId: params.tenantId,
      planId: params.planId,
      status: "active",
      startDate: now.toISOString(),
      endDate,
      trialEndDate: now.toISOString(),
      provider: params.provider,
      providerCustomerId: params.providerCustomerId,
      providerSubscriptionId: params.providerSubscriptionId,
      cancelAtPeriodEnd: false,
      updatedAt: now.toISOString()
    };

    // Note: In Node.js backend with Firebase Admin SDK:
    // await adminDb.collection("subscriptions").doc(params.tenantId).set(subscription, { merge: true });
    // await adminDb.collection("tenants").doc(params.tenantId).update({ plan: params.planId });

    return subscription;
  }

  async updateSubscriptionStatus(params: {
    tenantId: string;
    status: SubscriptionStatus;
    cancelAtPeriodEnd?: boolean;
    reason?: string;
  }): Promise<Subscription> {
    const now = new Date().toISOString();
    return {
      tenantId: params.tenantId,
      planId: "free",
      status: params.status,
      startDate: now,
      endDate: now,
      trialEndDate: now,
      provider: "none",
      cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
      updatedAt: now
    };
  }

  async extendTrialPeriod(params: {
    tenantId: string;
    additionalDays: number;
    authorizedAdminUid: string;
  }): Promise<Subscription> {
    const now = new Date();
    const trialEndDate = new Date(now.getTime() + params.additionalDays * 24 * 60 * 60 * 1000).toISOString();
    return {
      tenantId: params.tenantId,
      planId: "pro",
      status: "trialing",
      startDate: now.toISOString(),
      endDate: trialEndDate,
      trialEndDate,
      provider: "none",
      updatedAt: now.toISOString()
    };
  }
}

export const serverSubscriptionAdmin = new ServerSubscriptionAdminService();
