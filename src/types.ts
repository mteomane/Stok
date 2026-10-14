export interface FabricRoll {
  id: string;
  rollNumber: string; // e.g. "Top #1", "Top #2"
  length: number;    // current length in meters
  initialLength: number; // original length in meters
  soldLength?: number;   // total cut/sold amount in meters
  status: 'available' | 'sold' | 'reserved';
}

export type TenantRole = 'owner' | 'admin' | 'staff' | 'cashier';

// ==========================================
// SAAS SUBSCRIPTION & PLANS DOMAIN
// ==========================================

export type PlanId = 'free' | 'starter' | 'pro' | 'business';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export interface PlanPrice {
  monthly: number;
  yearly: number;
  currency: string;
}

export interface SubscriptionPlan {
  planId: PlanId;
  name: string;
  badge?: string;
  description: string;
  price: PlanPrice;
  billingPeriod: 'monthly' | 'yearly';
  maxUsers: number;       // -1 = sınırsız
  maxProducts: number;    // -1 = sınırsız
  maxWarehouses: number;  // -1 = sınırsız
  maxStorage: number;     // MB cinsinden (-1 = sınırsız)
  features: string[];
  recommended?: boolean;
}

export interface Subscription {
  id?: string;
  tenantId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  startDate: string;      // ISO string
  endDate: string;        // ISO string
  trialEndDate: string;   // ISO string (14 günlük deneme)
  provider: 'none' | 'stripe' | 'iyzico' | 'paytr' | 'manual';
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  cancelAtPeriodEnd?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubscriptionEntitlement {
  hasAccess: boolean;           // Aktif veya geçerli deneme süresinde
  isTrial: boolean;             // Şu an deneme süresinde mi
  trialDaysLeft: number;        // Deneme süresinin bitimine kalan gün
  plan: SubscriptionPlan;       // Mevcut plan konfigürasyonu
  subscription: Subscription;   // Abonelik dokümanı
  limits: {
    maxProducts: number;
    maxWarehouses: number;
    maxUsers: number;
    maxStorage: number;
  };
  usage: {
    currentProducts: number;
    currentWarehouses: number;
    currentUsers: number;
  };
  canAddProduct: boolean;
  canAddWarehouse: boolean;
  canAddUser: boolean;
  canUseAdvancedReports: boolean;
  canUseMultiWarehouse: boolean;
  canUseAuditLogs: boolean;
  isOverLimit: boolean;
  reason?: string;
}

export interface Tenant {
  id: string; // tenant / company unique ID
  name: string; // Company trade name
  ownerUid: string;
  plan?: PlanId | string;
  createdAt: string;
  taxNumber?: string;
  taxOffice?: string;
  phone?: string;
  address?: string;
}

export interface TenantUser {
  uid: string;
  tenantId: string;
  role: TenantRole;
  email: string;
  displayName?: string;
  createdAt: string;
  isActive: boolean;
}

export interface TenantContext {
  tenantId: string;
  role: TenantRole;
  tenant?: Tenant;
  userProfile?: TenantUser;
}

// ==========================================
// SECTOR METADATA & PROFILE DEFINITIONS
// ==========================================

export type SectorKey = 'tekstil' | 'gida' | 'yedek_parca' | 'genel' | string;

export interface TextileMetadata {
  fabricType?: string;      // Kumaş tipi: Viskon, Pamuk, Poplin, Şifon vb.
  color?: string;           // Renk / Varyasyon
  width?: string;           // Kumaş Eni (örn: 140cm, 150cm)
  pattern?: string;         // Desen / Baskı
  rollNumber?: string;      // Rulo / Top Numarası
  length?: number;          // Rulo Metrajı
}

export interface FoodMetadata {
  expiryDate?: string;      // Son Tüketim Tarihi (SKT) - YYYY-MM-DD
  batchNumber?: string;     // Parti / Lot Numarası
  storageCondition?: string;// Saklama Koşulu (+4°C Soğuk Hava, Kuru Serin vb.)
  producerBrand?: string;   // Üretici / Marka
  netWeight?: string;       // Gramaj / Hacim
}

export interface SparePartsMetadata {
  partNumber?: string;          // Parça / OEM Kodu
  vehicleCompatibility?: string;// Uyumlu Araç / Model / Motor
  oemNumber?: string;           // Orijinal Ekipman No
  shelfLocation?: string;       // Depo Raf / Göz Konumu (örn: A-04-12)
  brand?: string;               // Marka / Üretici
}

export interface GeneralMetadata {
  brand?: string;           // Marka
  barcode?: string;         // Barkod (EAN-13, UPC)
  model?: string;           // Model
  shelfLocation?: string;   // Raf / Reyon
}

// Genel Sektör Metadata Tipi (Extensible Record)
export type ProductMetadata = TextileMetadata & FoodMetadata & SparePartsMetadata & GeneralMetadata & Record<string, any>;

// ==========================================
// CORE DOMAIN ENTITY: PRODUCT
// ==========================================

export interface Product {
  id: string;
  tenantId?: string; // Multi-tenant company ID
  name: string;
  sku: string;
  barcode?: string;
  brand?: string;
  category: string;
  unit?: string;     // 'adet' | 'metre' | 'kg' | 'paket' | 'koli' | 'litre' (Varsayılan: 'adet' veya sektöre göre)
  price: number;
  costPrice?: number; // Alış Fiyatı (Opsiyonel)
  stock: number;
  minStock: number;
  description?: string; // Ürün Açıklaması
  warehouseId?: string; // İlgili depo referansı

  // Soft Delete & Status
  isActive?: boolean;
  deletedAt?: string;

  // Sektör Bağımsız Opsiyonel Metadata
  metadata?: ProductMetadata;

  // Geriye Dönük Uyumluluk (Existing Attributes Record)
  attributes?: Record<string, string>;

  // Kısmi Stok / Paket İçi Eksiltme (Opsiyonel koli/paket özelliği)
  isPackaged?: boolean;
  packageUnitsCount?: number;
  packageUnitName?: string;
  subUnitStock?: number;

  // Kumaş topları takibi (Tekstil sektöründe veya rulo takibinde opsiyonel)
  rolls?: FabricRoll[];
}

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface Sale {
  id: string;
  tenantId?: string; // Multi-tenant company ID
  items: SaleItem[];
  totalAmount: number;
  timestamp: string;
  paymentMethod?: string;
  customerName?: string;
  customerId?: string;
  status?: 'Tamamlandı' | 'İptal Edildi' | 'İade Edildi';
  stockDeducted?: boolean;
  stockRestored?: boolean;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  idempotencyKey?: string;
  cancelIdempotencyKey?: string;
  manualReconciliationRequired?: boolean;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedRollId?: string; // Optional specific fabric roll selected for sale
  cutLength?: number;       // Optional length cut from the roll
}

export interface CustomerTransaction {
  id: string;
  type: 'sale' | 'payment';
  amount: number;
  description: string;
  timestamp: string;
}

export interface Customer {
  id: string;
  tenantId?: string; // Multi-tenant company ID
  name: string;
  phone: string;
  instagram: string;
  totalDebt: number; // Ödenmemiş miktar (Borç)
  totalPaid: number; // Ödenen miktar
  notes?: string;
  transactions: CustomerTransaction[];
  address?: string;
  taxOffice?: string;
  taxNumber?: string;
}

// ==========================================
// CORE DOMAIN ENTITY: SUPPLIER (Tedarikçi)
// ==========================================
export interface Supplier {
  id: string;
  tenantId?: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  address?: string;
  taxOffice?: string;
  taxNumber?: string;
  category?: string; // Kumaş İplik, Gıda Toptancısı, Yedek Parça vb.
  balance: number;   // Borç/Alacak bakiyesi (₺)
  notes?: string;
  createdAt: string;
}

// ==========================================
// CORE DOMAIN ENTITY: WAREHOUSE (Depo)
// ==========================================
export interface Warehouse {
  id: string;
  tenantId?: string;
  name: string;      // örn: "Ana Depo", "Kumaş Kesim Deposu", "Soğuk Hava Deposu"
  code?: string;      // "DEP-01"
  location?: string;  // Kat/Bina/Adres
  isDefault?: boolean;
  createdAt: string;
}

// ==========================================
// CORE DOMAIN ENTITY: PAYMENT (Tahsilat / Ödeme)
// ==========================================
export interface Payment {
  id: string;
  tenantId?: string;
  userId?: string;
  customerId?: string;
  customerName?: string;
  supplierId?: string;
  supplierName?: string;
  type: 'incoming' | 'outgoing'; // Tahsilat (incoming) | Tediye/Ödeme (outgoing)
  amount: number;
  paymentMethod: 'nakit' | 'kredi_karti' | 'havale' | 'cek' | 'diger';
  timestamp: string;
  description?: string;
  receiptNo?: string;
}

// ==========================================
// CORE DOMAIN ENTITY: STOCK MOVEMENT (Stok Hareketi)
// ==========================================
export interface StockMovement {
  id: string;
  tenantId?: string;
  productId: string;
  productName: string;
  warehouseId?: string;
  type: 'in' | 'out' | 'transfer' | 'adjustment' | 'roll_cut';
  quantity: number;
  previousStock?: number;
  newStock?: number;
  unit?: string;
  referenceType?: 'sale' | 'order' | 'purchase' | 'manual';
  referenceId?: string;
  timestamp: string;
  userId?: string;
  notes?: string;
}

export interface SectorField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  required: boolean;
  options?: string[];
  unit?: string;
}

export interface SectorSettings {
  activeSector: string;
  customFields: SectorField[];
}

export interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxOffice: string;
  taxNumber: string;
  logo: string; // Base64 representation or url
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  rollId?: string; // If specific fabric roll was sold
  rollNumber?: string; // If specific fabric roll
  cutLength?: number; // If cut length
}

export interface Order {
  id: string;
  tenantId?: string; // Multi-tenant company ID
  orderNo: string; // e.g. "SIP-1001"
  customerId?: string;
  customerName?: string; // text backup or anonymous
  customerDetails?: {
    name: string;
    address: string;
    phone: string;
    taxOffice?: string;
    taxNumber?: string;
  };
  items: OrderItem[];
  totalAmount: number;
  amountPaid: number;
  status: 'Sipariş Alındı' | 'Hazırlanıyor' | 'Sevk Edildi' | 'Teslim Edildi' | 'İptal Edildi';
  orderDate: string; // ISO string
  waybillNo?: string; // İrsaliye No
  waybillDate?: string; // İrsaliye Tarihi
  shipDate?: string; // Fiili Sevk Tarihi
  notes?: string;
  // FAZ 13-A9-6-B: Atomic tracking and cancellation fields
  stockDeducted?: boolean;
  stockRestored?: boolean;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  idempotencyKey?: string;
  cancelIdempotencyKey?: string;
  manualReconciliationRequired?: boolean;
}

export type AuditAction = 
  | 'PRODUCT_CREATED'
  | 'BATCH_PRODUCTS_CREATED'
  | 'PRODUCT_UPDATED'
  | 'PRODUCT_DELETED'
  | 'PRODUCT_RESTORED'
  | 'STOCK_IN'
  | 'STOCK_OUT'
  | 'SALE_CREATED'
  | 'SALE_CANCELLED'
  | 'ORDER_CREATED'
  | 'ORDER_CANCELLED'
  | 'PAYMENT_RECEIVED'
  | 'ROLL_CREATED'
  | 'ROLL_UPDATED'
  | 'ROLL_DELETED'
  | 'EXPORT_CREATED'
  | 'IMPORT_PROCESSED';

export interface AuditLog {
  id?: string;
  userId: string;
  companyId?: string;
  action: AuditAction;
  entityType: 'product' | 'sale' | 'customer' | 'roll' | 'order' | 'export' | 'import' | 'backup';
  entityId: string;
  timestamp: string;
  details?: {
    summary?: string;
    previousValue?: any;
    newValue?: any;
    [key: string]: any;
  };
}

