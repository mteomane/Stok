/**
 * SaaS Payment Provider Agnostic Types & Interfaces
 * Compatible with PayTR, iyzico, Stripe, and Mock Sandbox.
 */

export type PaymentProviderType = "mock" | "iyzico" | "paytr" | "stripe";

export type PaymentStatus = "pending" | "succeeded" | "failed" | "canceled" | "refunded";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "expired";

export type WebhookEventType = 
  | "payment.succeeded"
  | "payment.failed"
  | "subscription.created"
  | "subscription.active"
  | "subscription.renewed"
  | "subscription.cancelled"
  | "subscription.payment_failed";

export interface CustomerBillingInfo {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  taxOffice?: string;
  taxNumber?: string;
  identityNumber?: string; // TCKN / VKN for TR payment gateways
  city?: string;
  country?: string;
}

export interface CreateCheckoutParams {
  tenantId: string;
  planId: string;
  billingPeriod: "monthly" | "yearly";
  amount: number;
  currency: string;
  customer: CustomerBillingInfo;
  returnUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, any>;
}

export interface CheckoutSession {
  checkoutId: string;
  token: string;
  checkoutUrl: string;
  provider: PaymentProviderType;
  amount: number;
  currency: string;
  expiresAt: string; // ISO String
  tenantId: string;
  planId: string;
  billingPeriod: "monthly" | "yearly";
  metadata?: Record<string, any>;
}

export interface CreateSubscriptionParams {
  tenantId: string;
  planId: string;
  billingPeriod: "monthly" | "yearly";
  amount: number;
  currency: string;
  customer: CustomerBillingInfo;
  paymentMethodToken?: string;
  trialDays?: number;
  metadata?: Record<string, any>;
}

export interface SubscriptionResult {
  subscriptionId: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  startDate: string;
  endDate: string;
  trialEndDate?: string;
  provider: PaymentProviderType;
  billingPeriod: "monthly" | "yearly";
  amount: number;
  currency: string;
  rawResponse?: any;
}

export interface CancelSubscriptionParams {
  subscriptionId: string;
  tenantId: string;
  immediately?: boolean;
  reason?: string;
}

export interface CancelSubscriptionResult {
  subscriptionId: string;
  tenantId: string;
  status: "canceled";
  canceledAt: string;
  effectiveEndDate: string;
  reason?: string;
}

export interface GetSubscriptionParams {
  subscriptionId: string;
  tenantId: string;
}

export interface SubscriptionDetails {
  subscriptionId: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  startDate: string;
  endDate: string;
  provider: PaymentProviderType;
  billingPeriod: "monthly" | "yearly";
  amount: number;
  currency: string;
  customer?: CustomerBillingInfo;
  latestPaymentStatus?: PaymentStatus;
}

export interface WebhookHeaders {
  [key: string]: string | string[] | undefined;
}

export interface WebhookEventData {
  checkoutId?: string;
  subscriptionId?: string;
  tenantId: string;
  planId?: string;
  billingPeriod?: "monthly" | "yearly";
  amount?: number;
  currency?: string;
  paymentStatus?: PaymentStatus;
  subscriptionStatus?: SubscriptionStatus;
  paymentMethod?: string;
  transactionId?: string;
  failureReason?: string;
  periodEnd?: string;
  metadata?: Record<string, any>;
}

export interface WebhookPayload {
  id: string; // Unique event ID for idempotency verification
  type: WebhookEventType;
  provider: PaymentProviderType;
  createdAt: string; // ISO String
  data: WebhookEventData;
  signature?: string; // Optional embedded signature
}

export type WebhookActionTaken = 
  | "SUBSCRIPTION_ACTIVATED"
  | "SUBSCRIPTION_RENEWED"
  | "SUBSCRIPTION_CANCELED"
  | "PAYMENT_FAILED_RECORDED"
  | "EVENT_ALREADY_PROCESSED"
  | "SIGNATURE_INVALID"
  | "UNHANDLED_EVENT";

export interface WebhookResult {
  success: boolean;
  eventId: string;
  eventType: WebhookEventType;
  idempotent: boolean; // True if duplicate event suppressed
  actionTaken: WebhookActionTaken;
  message: string;
  processedAt: string;
  tenantId?: string;
  details?: Record<string, any>;
}

export interface PaymentProviderConfig {
  provider: PaymentProviderType;
  isSandbox: boolean;
  currency: string;
  hasWebhookConfigured: boolean;
}
