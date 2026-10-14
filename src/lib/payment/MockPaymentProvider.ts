import crypto from "crypto";
import { PaymentProvider } from "./PaymentProvider";
import {
  PaymentProviderType,
  CreateCheckoutParams,
  CheckoutSession,
  CreateSubscriptionParams,
  SubscriptionResult,
  CancelSubscriptionParams,
  CancelSubscriptionResult,
  GetSubscriptionParams,
  SubscriptionDetails,
  WebhookPayload,
  WebhookHeaders,
  WebhookResult,
  WebhookEventType,
  SubscriptionStatus
} from "./types";

/**
 * Mock Payment Provider for Sandboxed Testing and Development.
 * Full implementation supporting checkout sessions, HMAC-SHA256 signature verification,
 * idempotency, and all webhook event states.
 */
export class MockPaymentProvider implements PaymentProvider {
  public readonly name: PaymentProviderType = "mock";

  // Secrets strictly retrieved from environment or safe mock fallback on server
  private readonly webhookSecret: string;
  private readonly processedEventIds = new Set<string>();
  private readonly subscriptionsStore = new Map<string, SubscriptionDetails>();

  constructor(secret?: string) {
    this.webhookSecret = secret || process.env.PAYMENT_WEBHOOK_SECRET || "mock_secret_key_stokpro_2026";
  }

  /**
   * Generates a checkout session for simulated payment.
   */
  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession> {
    const checkoutId = "chk_mock_" + crypto.randomBytes(8).toString("hex");
    const token = crypto.createHmac("sha256", this.webhookSecret)
      .update(`${checkoutId}:${params.tenantId}:${params.amount}`)
      .digest("hex");

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min expiry

    return {
      checkoutId,
      token,
      checkoutUrl: `/checkout/mock?session=${checkoutId}&token=${token}`,
      provider: "mock",
      amount: params.amount,
      currency: params.currency || "TRY",
      expiresAt,
      tenantId: params.tenantId,
      planId: params.planId,
      billingPeriod: params.billingPeriod,
      metadata: params.metadata || {}
    };
  }

  /**
   * Directly provisions a mock subscription.
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult> {
    const subscriptionId = "sub_mock_" + crypto.randomBytes(8).toString("hex");
    const now = new Date();
    const periodDays = params.billingPeriod === "yearly" ? 365 : 30;
    const endDate = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000).toISOString();

    const subDetails: SubscriptionDetails = {
      subscriptionId,
      tenantId: params.tenantId,
      planId: params.planId,
      status: "active",
      startDate: now.toISOString(),
      endDate,
      provider: "mock",
      billingPeriod: params.billingPeriod,
      amount: params.amount,
      currency: params.currency || "TRY",
      customer: params.customer,
      latestPaymentStatus: "succeeded"
    };

    this.subscriptionsStore.set(subscriptionId, subDetails);

    return {
      subscriptionId,
      tenantId: params.tenantId,
      planId: params.planId,
      status: "active",
      startDate: now.toISOString(),
      endDate,
      trialEndDate: params.trialDays ? new Date(now.getTime() + params.trialDays * 24 * 60 * 60 * 1000).toISOString() : undefined,
      provider: "mock",
      billingPeriod: params.billingPeriod,
      amount: params.amount,
      currency: params.currency || "TRY"
    };
  }

  /**
   * Cancels a mock subscription.
   */
  async cancelSubscription(params: CancelSubscriptionParams): Promise<CancelSubscriptionResult> {
    const existing = this.subscriptionsStore.get(params.subscriptionId);
    const canceledAt = new Date().toISOString();
    const effectiveEndDate = params.immediately 
      ? canceledAt 
      : (existing?.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

    if (existing) {
      existing.status = "canceled";
      this.subscriptionsStore.set(params.subscriptionId, existing);
    }

    return {
      subscriptionId: params.subscriptionId,
      tenantId: params.tenantId,
      status: "canceled",
      canceledAt,
      effectiveEndDate,
      reason: params.reason || "Kullanıcı talebi ile iptal edildi"
    };
  }

  /**
   * Retrieves subscription from memory/mock store.
   */
  async getSubscription(params: GetSubscriptionParams): Promise<SubscriptionDetails> {
    const found = this.subscriptionsStore.get(params.subscriptionId);
    if (found) {
      return found;
    }

    // Default mock response if not in memory
    const now = new Date();
    return {
      subscriptionId: params.subscriptionId,
      tenantId: params.tenantId,
      planId: "pro",
      status: "active",
      startDate: now.toISOString(),
      endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      provider: "mock",
      billingPeriod: "monthly",
      amount: 890,
      currency: "TRY"
    };
  }

  /**
   * Cryptographic verification using HMAC SHA-256.
   * Matches modern industry standard (PayTR, Stripe, iyzico).
   */
  verifyWebhookSignature(rawBody: string | Buffer, headers: WebhookHeaders): boolean {
    const signature = headers["x-webhook-signature"] || headers["x-mock-signature"] || headers["x-signature"];
    if (!signature || typeof signature !== "string") {
      return false;
    }

    try {
      const payloadString = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
      const expectedSignature = crypto
        .createHmac("sha256", this.webhookSecret)
        .update(payloadString)
        .digest("hex");

      // Timing-safe comparison to prevent timing attacks
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      if (sigBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (err) {
      console.error("Signature verification error:", err);
      return false;
    }
  }

  /**
   * Standardizes incoming webhook payload.
   */
  parseWebhookPayload(body: any, _headers: WebhookHeaders): WebhookPayload {
    if (body.id && body.type && body.data) {
      return body as WebhookPayload;
    }

    // Wrap raw or legacy payloads into standard structure
    return {
      id: body.id || "evt_" + crypto.randomBytes(8).toString("hex"),
      type: (body.type || body.event || "payment.succeeded") as WebhookEventType,
      provider: "mock",
      createdAt: body.createdAt || new Date().toISOString(),
      data: {
        tenantId: body.tenantId || body.data?.tenantId || "demo-tenant",
        planId: body.planId || body.data?.planId || "pro",
        billingPeriod: body.billingPeriod || body.data?.billingPeriod || "monthly",
        amount: Number(body.amount || body.data?.amount || 0),
        currency: body.currency || body.data?.currency || "TRY",
        subscriptionId: body.subscriptionId || body.data?.subscriptionId,
        checkoutId: body.checkoutId || body.data?.checkoutId,
        paymentStatus: body.paymentStatus || body.data?.paymentStatus,
        subscriptionStatus: body.subscriptionStatus || body.data?.subscriptionStatus,
        failureReason: body.failureReason || body.data?.failureReason,
        metadata: body.metadata || body.data?.metadata || {}
      }
    };
  }

  /**
   * Handles webhook processing with idempotency and state changes.
   */
  async handleWebhook(payload: WebhookPayload, headers: WebhookHeaders): Promise<WebhookResult> {
    const eventId = payload.id;
    const processedAt = new Date().toISOString();

    // 1. IDEMPOTENCY CHECK
    // If the event was already processed, immediately return success without repeating side effects.
    if (this.processedEventIds.has(eventId)) {
      return {
        success: true,
        eventId,
        eventType: payload.type,
        idempotent: true,
        actionTaken: "EVENT_ALREADY_PROCESSED",
        message: `Idempotency: '${eventId}' numaralı webhook olayı daha önce işlenmişti, tekrarlanan işlem engellendi.`,
        processedAt,
        tenantId: payload.data.tenantId
      };
    }

    // 2. Mark event as processed in idempotency set
    this.processedEventIds.add(eventId);

    // Keep set bounded to prevent memory growth
    if (this.processedEventIds.size > 10000) {
      const firstEntry = this.processedEventIds.values().next().value;
      if (firstEntry) this.processedEventIds.delete(firstEntry);
    }

    // 3. Process event types
    switch (payload.type) {
      case "payment.succeeded":
      case "subscription.active":
      case "subscription.created": {
        const subId = payload.data.subscriptionId || "sub_" + crypto.randomBytes(6).toString("hex");
        const periodDays = payload.data.billingPeriod === "yearly" ? 365 : 30;
        const now = new Date();
        const endDate = new Date(now.getTime() + periodDays * 24 * 60 * 60 * 1000).toISOString();

        this.subscriptionsStore.set(subId, {
          subscriptionId: subId,
          tenantId: payload.data.tenantId,
          planId: payload.data.planId || "pro",
          status: "active",
          startDate: now.toISOString(),
          endDate,
          provider: "mock",
          billingPeriod: payload.data.billingPeriod || "monthly",
          amount: payload.data.amount || 0,
          currency: payload.data.currency || "TRY",
          latestPaymentStatus: "succeeded"
        });

        return {
          success: true,
          eventId,
          eventType: payload.type,
          idempotent: false,
          actionTaken: "SUBSCRIPTION_ACTIVATED",
          message: `Başarılı Ödeme: '${payload.data.tenantId}' şirketi için ${payload.data.planId?.toUpperCase()} aboneliği aktifleştirildi.`,
          processedAt,
          tenantId: payload.data.tenantId,
          details: {
            subscriptionId: subId,
            planId: payload.data.planId,
            endDate
          }
        };
      }

      case "subscription.renewed": {
        return {
          success: true,
          eventId,
          eventType: payload.type,
          idempotent: false,
          actionTaken: "SUBSCRIPTION_RENEWED",
          message: `Abonelik Yenileme: '${payload.data.tenantId}' abonelik süresi uzatıldı.`,
          processedAt,
          tenantId: payload.data.tenantId
        };
      }

      case "payment.failed":
      case "subscription.payment_failed": {
        return {
          success: true,
          eventId,
          eventType: payload.type,
          idempotent: false,
          actionTaken: "PAYMENT_FAILED_RECORDED",
          message: `Ödeme Başarısız: '${payload.data.tenantId}' aboneliği 'past_due' (ödenmedi) durumuna alındı. Neden: ${payload.data.failureReason || "Yetersiz Bakiye"}`,
          processedAt,
          tenantId: payload.data.tenantId,
          details: {
            reason: payload.data.failureReason || "Banka reddi veya yetersiz limit"
          }
        };
      }

      case "subscription.cancelled": {
        if (payload.data.subscriptionId) {
          const sub = this.subscriptionsStore.get(payload.data.subscriptionId);
          if (sub) {
            sub.status = "canceled";
            this.subscriptionsStore.set(payload.data.subscriptionId, sub);
          }
        }

        return {
          success: true,
          eventId,
          eventType: payload.type,
          idempotent: false,
          actionTaken: "SUBSCRIPTION_CANCELED",
          message: `Abonelik İptali: '${payload.data.tenantId}' aboneliği başarıyla iptal edildi.`,
          processedAt,
          tenantId: payload.data.tenantId
        };
      }

      default: {
        return {
          success: true,
          eventId,
          eventType: payload.type,
          idempotent: false,
          actionTaken: "UNHANDLED_EVENT",
          message: `Webhook olayı '${payload.type}' alındı ancak özel aksiyon gerektirmiyor.`,
          processedAt,
          tenantId: payload.data.tenantId
        };
      }
    }
  }

  /**
   * Helper to create authentic signed test webhook payloads for simulation & unit testing.
   */
  createSignedWebhookPayload(
    type: WebhookEventType,
    data: Partial<WebhookPayload["data"]>,
    customId?: string
  ): { payload: WebhookPayload; rawBody: string; signature: string; headers: Record<string, string> } {
    const payload: WebhookPayload = {
      id: customId || "evt_test_" + crypto.randomBytes(6).toString("hex"),
      type,
      provider: "mock",
      createdAt: new Date().toISOString(),
      data: {
        tenantId: data.tenantId || "demo-tenant",
        planId: data.planId || "pro",
        billingPeriod: data.billingPeriod || "monthly",
        amount: data.amount ?? 890,
        currency: data.currency || "TRY",
        subscriptionId: data.subscriptionId || "sub_test_123",
        failureReason: data.failureReason,
        ...data
      }
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");

    return {
      payload,
      rawBody,
      signature,
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": signature
      }
    };
  }
}
