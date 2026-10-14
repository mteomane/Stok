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
 * Provider-Agnostic Payment Adapter Interface
 * Decouples the application core from any specific payment gateway (PayTR, iyzico, Stripe, Mock).
 */
export interface PaymentProvider {
  /**
   * Unique identifier of the provider ('mock' | 'iyzico' | 'paytr' | 'stripe')
   */
  readonly name: PaymentProviderType;

  /**
   * Initializes a checkout session for one-time or subscription checkout.
   * Returns a session object with redirect URL / iframe token.
   */
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession>;

  /**
   * Directly creates or registers a subscription with recurring billing.
   */
  createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult>;

  /**
   * Cancels an active subscription on the provider.
   */
  cancelSubscription(params: CancelSubscriptionParams): Promise<CancelSubscriptionResult>;

  /**
   * Retrieves the current subscription state from the provider.
   */
  getSubscription(params: GetSubscriptionParams): Promise<SubscriptionDetails>;

  /**
   * Cryptographically verifies the incoming webhook request signature.
   * Returns true if authentic, false if forged or tampered.
   */
  verifyWebhookSignature(rawBody: string | Buffer, headers: WebhookHeaders): boolean;

  /**
   * Parses the provider-specific payload into standard WebhookPayload format.
   */
  parseWebhookPayload(body: any, headers: WebhookHeaders): WebhookPayload;

  /**
   * Processes the parsed webhook event and returns standardized WebhookResult.
   */
  handleWebhook(payload: WebhookPayload, headers: WebhookHeaders): Promise<WebhookResult>;
}
