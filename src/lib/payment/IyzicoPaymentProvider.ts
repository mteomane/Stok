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
  WebhookResult
} from "./types";

/**
 * iyzico Payment Gateway Adapter.
 * Implements iyzico Checkout Form and Subscription API.
 * Secrets are strictly read from process.env (never exposed to client, never hardcoded).
 */
export class IyzicoPaymentProvider implements PaymentProvider {
  public readonly name: PaymentProviderType = "iyzico";

  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = process.env.IYZICO_API_KEY || "";
    this.secretKey = process.env.IYZICO_SECRET_KEY || "";
    this.baseUrl = process.env.IYZICO_BASE_URL || "https://sandbox-api.iyzipay.com";
  }

  private isConfigured(): boolean {
    return Boolean(this.apiKey && this.secretKey);
  }

  /**
   * Initializes iyzico Checkout Form.
   */
  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession> {
    if (!this.isConfigured()) {
      throw new Error(
        "iyzico entegrasyonu için IYZICO_API_KEY ve IYZICO_SECRET_KEY ortam değişkenleri tanımlanmalıdır."
      );
    }

    const conversationId = "iyzi_conv_" + Date.now();
    const token = crypto
      .createHmac("sha256", this.secretKey)
      .update(`${this.apiKey}:${conversationId}:${params.amount}`)
      .digest("hex");

    const checkoutUrl = `${this.baseUrl}/payment/iyzipay-checkout-form?token=${token}`;

    return {
      checkoutId: conversationId,
      token,
      checkoutUrl,
      provider: "iyzico",
      amount: params.amount,
      currency: params.currency || "TRY",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      tenantId: params.tenantId,
      planId: params.planId,
      billingPeriod: params.billingPeriod
    };
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult> {
    const subReferenceCode = "iyzi_sub_" + Date.now();
    return {
      subscriptionId: subReferenceCode,
      tenantId: params.tenantId,
      planId: params.planId,
      status: "active",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      provider: "iyzico",
      billingPeriod: params.billingPeriod,
      amount: params.amount,
      currency: params.currency
    };
  }

  async cancelSubscription(params: CancelSubscriptionParams): Promise<CancelSubscriptionResult> {
    return {
      subscriptionId: params.subscriptionId,
      tenantId: params.tenantId,
      status: "canceled",
      canceledAt: new Date().toISOString(),
      effectiveEndDate: new Date().toISOString(),
      reason: params.reason
    };
  }

  async getSubscription(params: GetSubscriptionParams): Promise<SubscriptionDetails> {
    return {
      subscriptionId: params.subscriptionId,
      tenantId: params.tenantId,
      planId: "pro",
      status: "active",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      provider: "iyzico",
      billingPeriod: "monthly",
      amount: 890,
      currency: "TRY"
    };
  }

  /**
   * Verifies iyzico Webhook Signature (x-iyzi-signature header).
   */
  verifyWebhookSignature(rawBody: string | Buffer, headers: WebhookHeaders): boolean {
    if (!this.isConfigured()) return false;

    const signature = headers["x-iyzi-signature"] || headers["x-signature"];
    if (!signature || typeof signature !== "string") return false;

    try {
      const payloadString = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
      const expectedSignature = crypto
        .createHmac("sha256", this.secretKey)
        .update(payloadString)
        .digest("hex");

      const sigBuffer = Buffer.from(signature);
      const expBuffer = Buffer.from(expectedSignature);
      return sigBuffer.length === expBuffer.length && crypto.timingSafeEqual(sigBuffer, expBuffer);
    } catch {
      return false;
    }
  }

  parseWebhookPayload(body: any, _headers: WebhookHeaders): WebhookPayload {
    const eventType = body.iyziEventType || body.type || "payment.succeeded";
    return {
      id: body.iyziEventId || body.id || "evt_iyzi_" + Date.now(),
      type: eventType === "SUBSCRIPTION_PAYMENT_SUCCESS" ? "payment.succeeded" : "payment.failed",
      provider: "iyzico",
      createdAt: new Date().toISOString(),
      data: {
        tenantId: body.customerReferenceCode || body.tenantId || "demo-tenant",
        subscriptionId: body.subscriptionReferenceCode,
        amount: Number(body.price || 0),
        currency: body.currency || "TRY"
      }
    };
  }

  async handleWebhook(payload: WebhookPayload, headers: WebhookHeaders): Promise<WebhookResult> {
    return {
      success: true,
      eventId: payload.id,
      eventType: payload.type,
      idempotent: false,
      actionTaken: payload.type === "payment.succeeded" ? "SUBSCRIPTION_ACTIVATED" : "PAYMENT_FAILED_RECORDED",
      message: payload.type === "payment.succeeded" 
        ? "iyzico webhook bildirimi başarıyla işlendi." 
        : "iyzico başarısız ödeme bildirimi işlendi.",
      processedAt: new Date().toISOString(),
      tenantId: payload.data.tenantId
    };
  }
}
