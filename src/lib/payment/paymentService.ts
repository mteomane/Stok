import { PaymentProvider } from "./PaymentProvider";
import { MockPaymentProvider } from "./MockPaymentProvider";
import { PayTRPaymentProvider } from "./PayTRPaymentProvider";
import { IyzicoPaymentProvider } from "./IyzicoPaymentProvider";
import {
  PaymentProviderType,
  CreateCheckoutParams,
  CheckoutSession,
  WebhookPayload,
  WebhookHeaders,
  WebhookResult,
  PaymentProviderConfig,
  WebhookEventType
} from "./types";

/**
 * In-memory / Server Idempotency Log Store
 * Holds processed webhook events with timestamps, payload hash, and results.
 */
interface ProcessedEventRecord {
  eventId: string;
  eventType: WebhookEventType;
  tenantId: string;
  provider: PaymentProviderType;
  processedAt: string;
  result: WebhookResult;
}

class PaymentService {
  private activeProvider: PaymentProvider;
  private mockProviderInstance: MockPaymentProvider;
  private processedEventsStore = new Map<string, ProcessedEventRecord>();
  private recentEventsList: ProcessedEventRecord[] = [];

  constructor() {
    this.mockProviderInstance = new MockPaymentProvider();
    this.activeProvider = this.resolveProvider();
  }

  /**
   * Resolves the configured payment provider based on environment variables.
   * Default: MockPaymentProvider (sandboxed testing).
   */
  private resolveProvider(): PaymentProvider {
    const providerName = (process.env.PAYMENT_PROVIDER || "mock").toLowerCase();

    switch (providerName) {
      case "paytr":
        return new PayTRPaymentProvider();
      case "iyzico":
        return new IyzicoPaymentProvider();
      case "mock":
      default:
        return this.mockProviderInstance;
    }
  }

  /**
   * Returns current active provider.
   */
  public getProvider(): PaymentProvider {
    return this.activeProvider;
  }

  /**
   * Dynamically switch provider at runtime (useful for testing or multi-provider routing).
   */
  public setProvider(providerName: PaymentProviderType): void {
    switch (providerName) {
      case "paytr":
        this.activeProvider = new PayTRPaymentProvider();
        break;
      case "iyzico":
        this.activeProvider = new IyzicoPaymentProvider();
        break;
      case "mock":
      default:
        this.activeProvider = this.mockProviderInstance;
        break;
    }
  }

  /**
   * Safe public configuration without leaking API keys or secrets.
   */
  public getSafeConfig(): PaymentProviderConfig {
    return {
      provider: this.activeProvider.name,
      isSandbox: this.activeProvider.name === "mock" || process.env.NODE_ENV !== "production",
      currency: "TRY",
      hasWebhookConfigured: true
    };
  }

  /**
   * Initiates checkout session via the active provider.
   */
  public async createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession> {
    return this.activeProvider.createCheckout(params);
  }

  /**
   * Complete webhook verification, idempotency gate, and event dispatcher.
   */
  public async processWebhook(
    rawBody: string | Buffer,
    headers: WebhookHeaders,
    body?: any
  ): Promise<{ statusCode: number; result: WebhookResult }> {
    const provider = this.activeProvider;

    // 1. SIGNATURE VERIFICATION
    const isSignatureValid = provider.verifyWebhookSignature(rawBody, headers);
    if (!isSignatureValid) {
      const invalidResult: WebhookResult = {
        success: false,
        eventId: "unknown",
        eventType: "payment.failed",
        idempotent: false,
        actionTaken: "SIGNATURE_INVALID",
        message: "Güvenlik Uyarısı: Webhook imzası (HMAC) doğrulanamadı. İstek reddedildi.",
        processedAt: new Date().toISOString()
      };
      return { statusCode: 401, result: invalidResult };
    }

    // 2. PARSE PAYLOAD
    const parsedPayload = provider.parseWebhookPayload(
      body || (typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf8"))),
      headers
    );

    const eventId = parsedPayload.id;

    // 3. IDEMPOTENCY CHECK
    // If we have already processed this exact eventId, suppress duplicate effects.
    const existingRecord = this.processedEventsStore.get(eventId);
    if (existingRecord) {
      const idempotentResult: WebhookResult = {
        success: true,
        eventId,
        eventType: parsedPayload.type,
        idempotent: true,
        actionTaken: "EVENT_ALREADY_PROCESSED",
        message: `Idempotency Gate: '${eventId}' numaralı olay daha önce ${existingRecord.processedAt} tarihinde işlenmişti. Tekrarlanan işlem engellendi.`,
        processedAt: new Date().toISOString(),
        tenantId: parsedPayload.data.tenantId,
        details: existingRecord.result.details
      };
      return { statusCode: 200, result: idempotentResult };
    }

    // 4. DELEGATE TO PROVIDER ADAPTER
    const result = await provider.handleWebhook(parsedPayload, headers);

    // 5. RECORD IN IDEMPOTENCY REGISTRY & AUDIT LIST
    const record: ProcessedEventRecord = {
      eventId,
      eventType: parsedPayload.type,
      tenantId: parsedPayload.data.tenantId,
      provider: provider.name,
      processedAt: new Date().toISOString(),
      result
    };

    this.processedEventsStore.set(eventId, record);
    this.recentEventsList.unshift(record);

    // Limit log history to recent 100 items
    if (this.recentEventsList.length > 100) {
      this.recentEventsList.pop();
    }

    return { statusCode: 200, result };
  }

  /**
   * Helper to retrieve recent webhook events for UI audit display.
   */
  public getRecentEvents(tenantId?: string): ProcessedEventRecord[] {
    if (!tenantId) return this.recentEventsList;
    return this.recentEventsList.filter((e) => !e.tenantId || e.tenantId === tenantId || e.tenantId === "demo-tenant");
  }

  /**
   * Simulation helper: Dispatches a signed mock webhook for developer testing.
   */
  public async simulateWebhookEvent(
    type: WebhookEventType,
    data: Partial<WebhookPayload["data"]>,
    options?: { tamperSignature?: boolean; duplicateEventId?: string }
  ): Promise<{ statusCode: number; result: WebhookResult; simulatedSignature: string; eventId: string }> {
    const mock = this.mockProviderInstance;
    const { payload, rawBody, signature, headers } = mock.createSignedWebhookPayload(
      type,
      data,
      options?.duplicateEventId
    );

    const headersToSend: WebhookHeaders = {
      ...headers,
      "x-webhook-signature": options?.tamperSignature ? "invalid_tampered_signature_hex_123" : signature
    };

    const { statusCode, result } = await this.processWebhook(rawBody, headersToSend, payload);

    return {
      statusCode,
      result,
      simulatedSignature: headersToSend["x-webhook-signature"] as string,
      eventId: payload.id
    };
  }
}

// Global Singleton Instance
export const paymentService = new PaymentService();
