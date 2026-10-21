import { 
  Product, 
  Sale, 
  Customer, 
  Supplier, 
  Subscription, 
  PlanId, 
  SubscriptionEntitlement, 
  TenantContext, 
  TenantUser,
  Payment,
  Order
} from "../../types";

/**
 * Common Result and Parameter types for Order Domain
 */
export interface ProcessOrderItemInput {
  productId: string;
  quantity: number;
  price?: number;
  selectedRollId?: string;
  cutLength?: number;
}

export interface CreateOrderParams {
  items: ProcessOrderItemInput[];
  customerId?: string;
  customerDetails?: {
    name: string;
    address: string;
    phone: string;
    taxOffice?: string;
    taxNumber?: string;
  };
  amountPaid?: number;
  waybillNo?: string;
  waybillDate?: string;
  shipDate?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface CancelOrderParams {
  orderId: string;
  reason?: string;
  idempotencyKey?: string;
}

export interface OrderRepository {
  getAll(uid: string): Promise<Order[]>;
  getById(id: string): Promise<Order | null>;
  createAtomic(uid: string, params: CreateOrderParams): Promise<Order>;
  cancelAtomic(uid: string, params: CancelOrderParams): Promise<Order>;
  update(orderId: string, updates: Partial<Order>): Promise<void>;
  delete(orderId: string): Promise<void>;
}

/**
 * Common Result and Parameter types for Business Domain Repositories
 */
export interface ProcessSaleItemInput {
  productId: string;
  quantity: number;
  selectedRollId?: string;
  cutLength?: number;
}

export interface ProcessSaleParams {
  items: ProcessSaleItemInput[];
  customerId?: string;
  amountPaid?: number;
  idempotencyKey?: string;
  paymentMethod?: string;
}

export interface CancelSaleParams {
  saleId: string;
  reason?: string;
  idempotencyKey?: string;
}

export interface BarcodeConflictResult {
  hasConflict: boolean;
  conflictingProduct?: Product;
}

export interface ReplenishStockParams {
  quantityToAdd: number;
  costPrice?: number;
  note?: string;
  supplierId?: string;
}

/**
 * Product Domain Repository Interface
 * Decouples product inventory and catalog logic from database technology.
 */
export interface ProductRepository {
  getAll(uid: string, includeArchived?: boolean): Promise<Product[]>;
  getById(id: string, uidParam?: string): Promise<Product | null>;
  getByBarcode?(barcode: string, uidParam?: string): Promise<Product | null>;
  checkBarcodeConflict?(barcode: string, excludeProductId?: string, uidParam?: string): Promise<BarcodeConflictResult>;
  replenishStock?(productId: string, params: ReplenishStockParams, uidParam?: string): Promise<Product>;
  create(uid: string, product: Omit<Product, "id">): Promise<Product>;
  batchCreate?(uid: string, products: Omit<Product, "id">[], onProgress?: (processed: number, total: number) => void): Promise<Product[]>;
  update(productId: string, updates: Partial<Product>, uid?: string): Promise<void>;
  delete(productId: string, uid?: string): Promise<void>;
  restore(productId: string, uid?: string): Promise<void>;
  subscribe?(uid: string, onUpdate: (products: Product[]) => void, onError?: (err: Error) => void, includeArchived?: boolean): () => void;
}

/**
 * Sales Domain Repository Interface
 * Handles POS checkout, transaction journals, and stock adjustments.
 */
export interface SalesRepository {
  getAll(uid: string): Promise<Sale[]>;
  create(uid: string, sale: Omit<Sale, "id">): Promise<Sale>;
  processTransaction(uid: string, params: ProcessSaleParams): Promise<Sale>;
  cancelAtomic(uid: string, params: CancelSaleParams): Promise<Sale>;
  subscribe?(uid: string, onUpdate: (sales: Sale[]) => void, onError?: (err: Error) => void): () => void;
}

export interface ProcessCustomerPaymentParams {
  customerId: string;
  amount: number;
  type: 'payment' | 'sale';
  description?: string;
  paymentMethod?: 'nakit' | 'kredi_karti' | 'havale' | 'cek' | 'diger';
  idempotencyKey?: string;
}

export interface ProcessCustomerPaymentResult {
  customer: Customer;
  payment?: Payment;
  isDuplicate?: boolean;
}

/**
 * Customer Domain Repository Interface
 * Manages customer ledgers, debt/payment balances, and CRM data.
 */
export interface CustomerRepository {
  getAll(uid: string): Promise<Customer[]>;
  getById(id: string): Promise<Customer | null>;
  create(uid: string, customer: Omit<Customer, "id">): Promise<Customer>;
  update(customerId: string, updates: Partial<Customer>): Promise<Customer | void>;
  delete(customerId: string): Promise<void>;
  processPaymentTransaction(uid: string, params: ProcessCustomerPaymentParams): Promise<ProcessCustomerPaymentResult>;
}

/**
 * Supplier Domain Repository Interface
 * Manages wholesale suppliers, vendor details, and balances.
 */
export interface SupplierRepository {
  getAll(uid: string): Promise<Supplier[]>;
  getById(id: string): Promise<Supplier | null>;
  create(uid: string, supplier: Omit<Supplier, "id" | "createdAt">): Promise<Supplier>;
  update(id: string, updates: Partial<Supplier>): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * SaaS Subscription & Entitlements Repository Interface
 * Handles tenant plans, quota calculation, trial periods, and feature gates.
 */
export interface SubscriptionRepository {
  getByTenantId(tenantId: string): Promise<Subscription>;
  updatePlan(tenantId: string, planId: PlanId, billingPeriod?: "monthly" | "yearly"): Promise<Subscription>;
  cancel(tenantId: string): Promise<Subscription>;
  getEntitlement(uid: string): Promise<SubscriptionEntitlement>;
}

/**
 * User & Multi-Tenant Context Repository Interface
 * Manages tenant isolation, workspace memberships, and user roles.
 */
export interface UserRepository {
  getOrCreateContext(uid: string, email?: string, displayName?: string): Promise<TenantContext>;
  getUserProfile(uid: string): Promise<TenantUser | null>;
}
