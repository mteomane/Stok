import { 
  db,
  auth
} from "./firebase";
import { assertAuthenticated, isDemoUser, getAuthenticatedUid, isDemoAllowed } from "./authGuard";
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  orderBy,
  runTransaction,
  writeBatch,
  limit
} from "firebase/firestore";
import { 
  Product, 
  Sale, 
  Customer, 
  SectorSettings, 
  CompanyInfo, 
  Order,
  FabricRoll,
  AuditLog,
  AuditAction,
  Tenant,
  TenantUser,
  TenantContext,
  TenantRole,
  Supplier,
  Warehouse,
  Payment,
  StockMovement,
  ProductMetadata,
  Subscription,
  PlanId,
  SubscriptionStatus,
  SubscriptionPlan,
  SubscriptionEntitlement
} from "../types";
import { syncSectorMetadata } from "./sectorConfig";
export { syncSectorMetadata };
import { 
  DEFAULT_PLANS, 
  getPlanConfig, 
  isSubscriptionActive, 
  getTrialDaysRemaining, 
  computeSubscriptionEntitlement, 
  TRIAL_DAYS_DEFAULT 
} from "./subscriptionConfig";
import { 
  repositories, 
  ProcessCustomerPaymentParams, 
  ProcessCustomerPaymentResult,
  CreateOrderParams,
  CancelOrderParams,
  ProcessOrderItemInput,
  CancelSaleParams
} from "./repositories";

export { repositories };
export * from "./repositories/interfaces";

// ==========================================
// OFFLINE / DEMO STORAGE FALLBACK UTILS
// ==========================================

const SEED_PRODUCTS: Product[] = [
  {
    id: "P1",
    name: "Premium Pamuk Kumaş",
    sku: "PROD_P1",
    category: "Kumaş",
    price: 250,
    stock: 45,
    minStock: 10,
    isPackaged: true,
    packageUnitsCount: 50,
    packageUnitName: "Metre",
    subUnitStock: 35,
    attributes: {
      Renk: "Mavi",
      En: "150cm"
    },
    rolls: [
      {
        id: "R-P1-1",
        rollNumber: "Top #1 (Mavi)",
        length: 25,
        initialLength: 25,
        status: "available"
      },
      {
        id: "R-P1-2",
        rollNumber: "Top #2 (Mavi)",
        length: 20,
        initialLength: 20,
        status: "available"
      }
    ]
  },
  {
    id: "P2",
    name: "Saten İpek Kumaş",
    sku: "PROD_P2",
    category: "Kumaş",
    price: 450,
    stock: 20,
    minStock: 5,
    isPackaged: true,
    packageUnitsCount: 30,
    packageUnitName: "Metre",
    subUnitStock: 30,
    attributes: {
      Renk: "Kırmızı",
      En: "120cm"
    },
    rolls: [
      {
        id: "R-P2-1",
        rollNumber: "Top #1 (Kırmızı)",
        length: 20,
        initialLength: 20,
        status: "available"
      }
    ]
  },
  {
    id: "P3",
    name: "Düğme Seti (Metal)",
    sku: "PROD_P3",
    category: "Aksesuar",
    price: 25,
    stock: 150,
    minStock: 25,
    attributes: {
      Malzeme: "Pirinç"
    }
  },
  {
    id: "P4",
    name: "İplik Seti (12 Renk)",
    sku: "PROD_P4",
    category: "Aksesuar",
    price: 75,
    stock: 8,
    minStock: 15
  }
];

const SEED_SALES: Sale[] = [
  {
    id: "S1",
    items: [
      {
        productId: "P1",
        productName: "Premium Pamuk Kumaş",
        quantity: 2,
        price: 250
      }
    ],
    totalAmount: 500,
    timestamp: "2026-07-18T11:55:06.265Z"
  }
];

const SEED_CUSTOMERS: Customer[] = [
  {
    id: "C1",
    name: "Ahmet Yılmaz (Yılmaz Tekstil)",
    phone: "+905321234567",
    instagram: "yilmaz_tekstil",
    totalDebt: 500,
    totalPaid: 1200,
    notes: "Güvenilir toptancı müşteri",
    transactions: [
      {
        id: "T1",
        type: "sale",
        amount: 1700,
        description: "Kumaş Alımı (Fiş: #S1)",
        timestamp: "2026-07-17T13:55:06.266Z"
      },
      {
        id: "T2",
        type: "payment",
        amount: 1200,
        description: "Banka Havalesi Ödemesi",
        timestamp: "2026-07-18T01:55:06.266Z"
      }
    ]
  },
  {
    id: "C2",
    name: "Zeynep Kaya",
    phone: "+905059876543",
    instagram: "zeynepkaya_tasarim",
    totalDebt: 0,
    totalPaid: 450,
    notes: "Instagram üzerinden butik tasarımcı",
    transactions: [
      {
        id: "T3",
        type: "sale",
        amount: 450,
        description: "Butik Sipariş",
        timestamp: "2026-07-16T13:55:06.266Z"
      },
      {
        id: "T4",
        type: "payment",
        amount: 450,
        description: "Elden Nakit Ödeme",
        timestamp: "2026-07-16T13:55:06.266Z"
      }
    ]
  }
];

const SEED_SECTOR_SETTINGS: SectorSettings = {
  activeSector: "tekstil",
  customFields: [
    {
      key: "Renk",
      label: "Renk",
      type: "text",
      required: false
    },
    {
      key: "En",
      label: "Kumaş Eni (cm)",
      type: "text",
      required: false
    },
    {
      key: "Malzeme",
      label: "Malzeme Tipi",
      type: "text",
      required: false
    }
  ]
};

const SEED_COMPANY_INFO: CompanyInfo = {
  name: "Örnek Tekstil ve Sanayi Tic. Ltd. Şti.",
  address: "Merkez Mahallesi, Şair Nigar Sokak No: 45, Şişli, İstanbul",
  phone: "+90 212 555 44 33",
  email: "info@ornektekstil.com",
  taxOffice: "Şişli",
  taxNumber: "1234567890",
  logo: ""
};

function getLocal<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return defaultValue;
  }
  const stored = localStorage.getItem(key);
  if (!stored) {
    localStorage.setItem(key, JSON.stringify(defaultValue));
    return defaultValue;
  }
  try {
    return JSON.parse(stored) as T;
  } catch {
    return defaultValue;
  }
}

function setLocal<T>(key: string, value: T): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

// ==========================================
// AUDIT LOG SERVICE
// ==========================================
export async function logAuditEvent(uid: string, event: {
  action: AuditAction;
  entityType: 'product' | 'sale' | 'customer' | 'roll' | 'order' | 'export' | 'import' | 'backup';
  entityId: string;
  companyId?: string;
  details?: Record<string, any>;
}): Promise<void> {
  const timestamp = new Date().toISOString();
  const context = await getOrCreateTenantContext(uid);
  const logEntry: AuditLog = {
    userId: uid,
    companyId: event.companyId || context.tenantId || uid,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    timestamp,
    details: event.details || {}
  };

  if (isDemoUser(uid)) {
    const list = getLocal<AuditLog[]>("stokpro_demo_audit_logs", []);
    list.unshift({ id: "LOG_" + Math.random().toString(36).substring(2, 9), ...logEntry });
    if (list.length > 100) list.length = 100;
    setLocal("stokpro_demo_audit_logs", list);
    return;
  }

  try {
    await addDoc(collection(db, "audit_logs"), logEntry);
  } catch (err) {
    // Non-blocking: Audit log failure should never abort the main business transaction
    console.warn("Audit log creation warning:", err);
  }
}

export async function getAuditLogs(uid: string, limitCount = 50): Promise<AuditLog[]> {
  const validUid = assertAuthenticated(uid, "getAuditLogs");
  const context = await getOrCreateTenantContext(validUid);
  if (isDemoUser(validUid)) {
    return getLocal<AuditLog[]>("stokpro_demo_audit_logs", []);
  }
  try {
    const q = query(
      collection(db, "audit_logs"),
      where("companyId", "==", context.tenantId)
    );
    const snap = await getDocs(q);
    const logs: AuditLog[] = [];
    snap.forEach((d) => logs.push({ id: d.id, ...d.data() } as AuditLog));
    const sorted = logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return sorted.slice(0, limitCount);
  } catch (err) {
    console.warn("Audit logs fetch warning:", err);
    return [];
  }
}

// ==========================================
// MULTI-TENANT SAAS CONTEXT & MIGRATION SERVICE
// ==========================================
const tenantContextCache = new Map<string, TenantContext>();

/**
 * Resolves the authenticated user's Tenant context.
 * Delegates to UserRepository abstraction to isolate business logic from Firebase.
 */
export async function getOrCreateTenantContext(
  uid: string,
  email?: string,
  displayName?: string
): Promise<TenantContext> {
  return repositories.users.getOrCreateContext(uid, email, displayName);
}

/**
 * AUTOMATIC IDEMPOTENT MIGRATION SCRIPT:
 * Safely iterates through existing legacy collections (where tenantId is missing)
 * and tags them with the verified tenantId in batches.
 * Guaranteed zero data loss, fully non-destructive.
 */
export async function runAutoTenantMigration(
  uid: string,
  tenantId: string
): Promise<{ migratedCount: number; collections: string[] }> {
  let migratedCount = 0;
  const migratedCollections: string[] = [];

  const collectionsToMigrate = [
    "products",
    "sales",
    "customers",
    "orders",
    "audit_logs",
    "payments",
    "stock_movements",
    "suppliers",
    "warehouses"
  ];

  for (const collName of collectionsToMigrate) {
    try {
      const q = query(
        collection(db, collName),
        where("userId", "==", uid),
        limit(200)
      );
      const snap = await getDocs(q);
      const docsToUpdate = snap.docs.filter((d) => !d.data().tenantId);

      if (docsToUpdate.length > 0) {
        const batch = writeBatch(db);
        docsToUpdate.forEach((d) => {
          batch.update(d.ref, { tenantId });
          migratedCount++;
        });
        await batch.commit();
        migratedCollections.push(`${collName} (${docsToUpdate.length})`);
      }
    } catch (err) {
      console.warn(`Auto migration for ${collName} notice:`, err);
    }
  }

  return { migratedCount, collections: migratedCollections };
}

// ==========================================
// PRODUCTS SERVICE (Delegated to ProductRepository)
// ==========================================
export async function getProducts(uid: string, includeDeleted = false): Promise<Product[]> {
  return repositories.products.getAll(uid, includeDeleted);
}

export async function addProduct(uid: string, product: Omit<Product, "id">): Promise<Product> {
  return repositories.products.create(uid, product);
}

export async function updateProduct(productId: string, updates: Partial<Product>): Promise<void> {
  return repositories.products.update(productId, updates);
}

export async function deleteProduct(productId: string): Promise<void> {
  return repositories.products.delete(productId);
}

export async function getProductByBarcode(barcode: string, uid?: string): Promise<Product | null> {
  const currentUid = uid || auth.currentUser?.uid || "demo-user";
  if (repositories.products.getByBarcode) {
    return repositories.products.getByBarcode(barcode, currentUid);
  }
  const all = await repositories.products.getAll(currentUid);
  const clean = barcode.trim().toLowerCase();
  return all.find(p => (p.barcode && p.barcode.toLowerCase() === clean) || (p.sku && p.sku.toLowerCase() === clean)) || null;
}

export async function checkBarcodeConflict(barcode: string, excludeProductId?: string, uid?: string) {
  const currentUid = uid || auth.currentUser?.uid || "demo-user";
  if (repositories.products.checkBarcodeConflict) {
    return repositories.products.checkBarcodeConflict(barcode, excludeProductId, currentUid);
  }
  const found = await getProductByBarcode(barcode, currentUid);
  if (found && found.id !== excludeProductId) {
    return { hasConflict: true, conflictingProduct: found };
  }
  return { hasConflict: false };
}

export async function replenishStock(productId: string, params: { quantityToAdd: number; costPrice?: number; note?: string; supplierId?: string }, uid?: string): Promise<Product> {
  const currentUid = uid || auth.currentUser?.uid || "demo-user";
  if (repositories.products.replenishStock) {
    return repositories.products.replenishStock(productId, params, currentUid);
  }
  const product = await repositories.products.getById(productId, currentUid);
  if (!product) throw new Error("Ürün bulunamadı.");
  const newStock = roundQty((product.stock || 0) + params.quantityToAdd);
  await repositories.products.update(productId, { stock: newStock }, currentUid);
  return { ...product, stock: newStock };
}

export async function restoreProduct(productId: string): Promise<void> {
  return repositories.products.restore(productId);
}


// ==========================================
// SALES SERVICE (Delegated to SalesRepository)
// ==========================================
export async function getSales(uid: string): Promise<Sale[]> {
  return repositories.sales.getAll(uid);
}

export async function addSale(uid: string, sale: Omit<Sale, "id">): Promise<Sale> {
  return repositories.sales.create(uid, sale);
}

export function round2(val: number): number {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

export function roundQty(val: number): number {
  return Math.round((Number(val) + Number.EPSILON) * 1000) / 1000;
}

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

/**
 * ATOMIC SALES TRANSACTION:
 * Executes stock decrement (including fabric roll lengths), sale record creation,
 * and customer ledger updates within an atomic Firestore runTransaction.
 * Guarantees zero race conditions, prevents negative stock, prevents floating point drift,
 * and ensures product total stock strictly mirrors roll sums.
 */
export async function processSaleTransaction(uid: string, params: ProcessSaleParams): Promise<Sale> {
  return repositories.sales.processTransaction(uid, params);
}

export async function cancelSaleAtomic(uid: string, params: CancelSaleParams): Promise<Sale> {
  return repositories.sales.cancelAtomic(uid, params);
}

// Internal legacy implementation (superseded by SalesRepository)
async function _legacyProcessSaleTransaction(uid: string, params: ProcessSaleParams): Promise<Sale> {
  const { items, customerId, amountPaid, idempotencyKey } = params;
  if (!items || items.length === 0) {
    throw new Error("Sepette satılacak ürün bulunamadı.");
  }

  // -------------------------------------------------------------
  // DEMO / OFFLINE FALLBACK MODE
  // -------------------------------------------------------------
  if (uid === "demo-user" || uid.startsWith("local-")) {
    const productsList = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
    const salesList = getLocal<Sale[]>("stokpro_demo_sales", SEED_SALES);
    const customersList = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);

    const saleItems: any[] = [];
    let totalAmount = 0;

    // Validate and simulate deductions atomically
    for (const item of items) {
      const prod = productsList.find(p => p.id === item.productId);
      if (!prod) throw new Error(`Ürün bulunamadı: ${item.productId}`);

      const qty = roundQty(Number(item.quantity));
      const lineQty = item.cutLength !== undefined ? roundQty(Number(item.cutLength)) : qty;
      const qtyToDeduct = lineQty;
      if (isNaN(qtyToDeduct) || qtyToDeduct <= 0) {
        throw new Error(`Geçersiz satış miktarı: ${prod.name}`);
      }

      if (item.selectedRollId && prod.rolls) {
        const roll = prod.rolls.find(r => r.id === item.selectedRollId);
        if (!roll) throw new Error(`Kumaş topu bulunamadı: ID ${item.selectedRollId}`);
        const currentLen = Number(roll.length);
        if (currentLen < qtyToDeduct) {
          throw new Error(`Seçilen kumaş topunda (${roll.rollNumber}) yeterli kumaş kalmadı! Kalan: ${currentLen}m (Talep edilen: ${qtyToDeduct}m)`);
        }
        const initLen = roll.initialLength !== undefined ? Number(roll.initialLength) : currentLen;
        roll.initialLength = initLen;
        const updatedLen = roundQty(Math.max(0, currentLen - qtyToDeduct));
        roll.length = updatedLen;
        roll.soldLength = roundQty(Math.max(0, initLen - updatedLen));
        roll.status = updatedLen <= 0 ? "sold" : (roll.status === "reserved" ? "reserved" : "available");
        prod.stock = roundQty(prod.rolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));
      } else {
        if (prod.stock < qtyToDeduct) {
          throw new Error(`Stok Yetersiz! "${prod.name}" için mevcut stok: ${prod.stock}`);
        }
        prod.stock = roundQty(Math.max(0, prod.stock - qtyToDeduct));
        if (prod.rolls && prod.rolls.length > 0) {
          let rem = qtyToDeduct;
          for (const roll of prod.rolls) {
            const rLen = Number(roll.length);
            if (roll.status === "available" && rLen > 0 && rem > 0) {
              const dec = roundQty(Math.min(rLen, rem));
              rem = roundQty(rem - dec);
              const initLen = roll.initialLength !== undefined ? Number(roll.initialLength) : rLen;
              roll.initialLength = initLen;
              const updatedLen = roundQty(Math.max(0, rLen - dec));
              roll.length = updatedLen;
              roll.soldLength = roundQty(Math.max(0, initLen - updatedLen));
              roll.status = updatedLen <= 0 ? "sold" : "available";
            }
          }
          prod.stock = roundQty(prod.rolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));
        }
      }

      const lineTotal = round2(prod.price * lineQty);
      totalAmount = round2(totalAmount + lineTotal);

      saleItems.push({
        productId: prod.id,
        productName: prod.name,
        name: prod.name,
        quantity: lineQty,
        price: prod.price,
        selectedRollId: item.selectedRollId,
        cutLength: item.cutLength !== undefined ? round2(Number(item.cutLength)) : undefined
      });
    }

    const saleId = idempotencyKey || "S_" + Math.random().toString(36).substring(2, 9).toUpperCase();
    const newSale: Sale = {
      id: saleId,
      items: saleItems,
      totalAmount,
      timestamp: new Date().toISOString()
    };

    salesList.unshift(newSale);
    setLocal("stokpro_demo_products", productsList);
    setLocal("stokpro_demo_sales", salesList);

    if (customerId) {
      const cust = customersList.find(c => c.id === customerId);
      if (cust) {
        cust.transactions = cust.transactions || [];
        cust.totalDebt = cust.totalDebt || 0;
        cust.totalPaid = cust.totalPaid || 0;

        cust.transactions.unshift({
          id: "T_P_" + newSale.id,
          type: "sale",
          amount: totalAmount,
          description: `Satış Alımı (Fiş: #${newSale.id})`,
          timestamp: new Date().toISOString()
        });
        cust.totalDebt = round2(cust.totalDebt + totalAmount);

        const paid = Number(amountPaid || 0);
        if (paid > 0) {
          cust.transactions.unshift({
            id: "T_P_PAY_" + newSale.id,
            type: "payment",
            amount: paid,
            description: `Satış Ödemesi (Fiş: #${newSale.id})`,
            timestamp: new Date().toISOString()
          });
          cust.totalDebt = round2(Math.max(0, cust.totalDebt - paid));
          cust.totalPaid = round2(cust.totalPaid + paid);
        }
        setLocal("stokpro_demo_customers", customersList);
      }
    }

    await logAuditEvent(uid, {
      action: "SALE_CREATED",
      entityType: "sale",
      entityId: newSale.id,
      details: {
        totalAmount,
        itemsCount: saleItems.length,
        customerId
      }
    });

    return newSale;
  }

  // -------------------------------------------------------------
  // PRODUCTION FIRESTORE ACID TRANSACTION
  // -------------------------------------------------------------
  try {
    const context = await getOrCreateTenantContext(uid);
    const saleResult = await runTransaction(db, async (transaction) => {
      // 1. PHASE 1: ALL READS FIRST (MANDATORY IN FIRESTORE TRANSACTIONS)
      const uniqueProductIds = Array.from(new Set(items.map(i => i.productId)));
      
      // Read all products involved in the sale
      const productDocsMap = new Map<string, any>();
      for (const pId of uniqueProductIds) {
        const pRef = doc(db, "products", pId);
        const pSnap = await transaction.get(pRef);
        if (!pSnap.exists()) {
          throw new Error(`Ürün veri tabanında bulunamadı (ID: ${pId}).`);
        }
        const data = pSnap.data();
        const isAuthorized = data.userId === uid || (data.tenantId && data.tenantId === context.tenantId);
        if (!isAuthorized) {
          throw new Error("Yetkisiz işlem: Bu ürüne erişim izniniz bulunmuyor.");
        }
        productDocsMap.set(pId, { ...data, id: pSnap.id });
      }

      // Read customer doc if customerId is provided
      let customerData: any = null;
      let customerRef: any = null;
      if (customerId) {
        customerRef = doc(db, "customers", customerId);
        const cSnap = await transaction.get(customerRef);
        if (!cSnap.exists()) {
          throw new Error("Seçilen müşteri sistemde bulunamadı.");
        }
        customerData = cSnap.data();
        const isAuthorized = customerData.userId === uid || (customerData.tenantId && customerData.tenantId === context.tenantId);
        if (!isAuthorized) {
          throw new Error("Yetkisiz işlem: Bu müşteri kaydına erişim izniniz bulunmuyor.");
        }
      }

      // 2. PHASE 2: VALIDATE STOCK CONCURRENCY & CALCULATE MUTATIONS
      const saleItems: any[] = [];
      let totalAmount = 0;

      // In-memory working copies of product documents to compound multiple cuts/quantities of same product
      const workingProducts = new Map<string, { stock: number; rolls?: FabricRoll[]; name: string; price: number }>();
      for (const [pId, pData] of productDocsMap.entries()) {
        workingProducts.set(pId, {
          stock: roundQty(Number(pData.stock || 0)),
          rolls: pData.rolls ? JSON.parse(JSON.stringify(pData.rolls)) : undefined,
          name: pData.name || "Ürün",
          price: Number(pData.price || 0)
        });
      }

      for (const item of items) {
        const prod = workingProducts.get(item.productId);
        if (!prod) {
          throw new Error(`Ürün bulunamadı: ID ${item.productId}`);
        }

        const qty = roundQty(Number(item.quantity));
        const lineQty = item.cutLength !== undefined ? roundQty(Number(item.cutLength)) : qty;
        const qtyToDeduct = lineQty;
        if (isNaN(qtyToDeduct) || qtyToDeduct <= 0) {
          throw new Error(`Geçersiz satış miktarı (${prod.name}).`);
        }

        // Case A: Specific fabric roll requested
        if (item.selectedRollId && prod.rolls) {
          const roll = prod.rolls.find((r: FabricRoll) => r.id === item.selectedRollId);
          if (!roll) {
            throw new Error(`Kumaş topu bulunamadı: ${item.selectedRollId}`);
          }
          const currentLen = Number(roll.length);
          if (currentLen < qtyToDeduct) {
            throw new Error(
              `Stok Yetersiz! Seçilen kumaş topunda (${roll.rollNumber}) yalnızca ${currentLen}m kaldı. (Talep edilen: ${qtyToDeduct}m)`
            );
          }
          const initLen = roll.initialLength !== undefined ? Number(roll.initialLength) : currentLen;
          roll.initialLength = initLen;
          const updatedLen = roundQty(Math.max(0, currentLen - qtyToDeduct));
          roll.length = updatedLen;
          roll.soldLength = roundQty(Math.max(0, initLen - updatedLen));
          roll.status = updatedLen <= 0 ? "sold" : (roll.status === "reserved" ? "reserved" : "available");
          
          // Re-aggregate total stock strictly from rolls
          prod.stock = roundQty(prod.rolls.reduce((sum: number, r: FabricRoll) => sum + (Number(r.length) || 0), 0));
        } 
        // Case B: General stock deduction (with roll cascade if fabric rolls exist)
        else {
          if (prod.stock < qtyToDeduct) {
            throw new Error(
              `Stok Yetersiz! "${prod.name}" için mevcut stok: ${prod.stock}. Başka bir kullanıcı bu esnada stok tüketmiş olabilir.`
            );
          }
          prod.stock = roundQty(Math.max(0, prod.stock - qtyToDeduct));

          if (prod.rolls && prod.rolls.length > 0) {
            let remainingDeduct = qtyToDeduct;
            for (const roll of prod.rolls) {
              const rLen = Number(roll.length);
              if (roll.status === "available" && rLen > 0 && remainingDeduct > 0) {
                const dec = roundQty(Math.min(rLen, remainingDeduct));
                remainingDeduct = roundQty(remainingDeduct - dec);
                const initLen = roll.initialLength !== undefined ? Number(roll.initialLength) : rLen;
                roll.initialLength = initLen;
                const updatedLen = roundQty(Math.max(0, rLen - dec));
                roll.length = updatedLen;
                roll.soldLength = roundQty(Math.max(0, initLen - updatedLen));
                roll.status = updatedLen <= 0 ? "sold" : "available";
              }
            }
            prod.stock = roundQty(prod.rolls.reduce((sum: number, r: FabricRoll) => sum + (Number(r.length) || 0), 0));
          }
        }

        const lineTotal = round2(prod.price * lineQty);
        totalAmount = round2(totalAmount + lineTotal);

        saleItems.push({
          productId: item.productId,
          productName: prod.name,
          name: prod.name,
          quantity: lineQty,
          price: prod.price,
          selectedRollId: item.selectedRollId,
          cutLength: item.cutLength !== undefined ? round2(Number(item.cutLength)) : undefined
        });
      }

      // Prepare Sale document reference
      const saleRef = idempotencyKey 
        ? doc(db, "sales", idempotencyKey) 
        : doc(collection(db, "sales"));

      const newSaleDocData = {
        userId: uid,
        tenantId: context.tenantId,
        items: saleItems,
        totalAmount,
        amountPaid: Number(amountPaid || 0),
        customerId: customerId || null,
        timestamp: new Date().toISOString()
      };

      // 3. PHASE 3: ALL WRITES AFTER ALL READS (ATOMIC COMMIT)
      // A) Update product stock & rolls
      for (const [pId, updatedProd] of workingProducts.entries()) {
        const pDocRef = doc(db, "products", pId);
        transaction.update(pDocRef, {
          stock: updatedProd.stock,
          ...(updatedProd.rolls ? { rolls: updatedProd.rolls } : {})
        });
      }

      // B) Create sale record
      transaction.set(saleRef, newSaleDocData);

      // C) Update customer ledger if linked
      if (customerId && customerRef && customerData) {
        const transactions = [...(customerData.transactions || [])];
        let totalDebt = Number(customerData.totalDebt || 0);
        let totalPaid = Number(customerData.totalPaid || 0);

        transactions.unshift({
          id: "T_P_" + saleRef.id,
          type: "sale",
          amount: totalAmount,
          description: `Satış Alımı (Fiş: #${saleRef.id})`,
          timestamp: new Date().toISOString()
        });
        totalDebt = round2(totalDebt + totalAmount);

        const paid = Number(amountPaid || 0);
        if (paid > 0) {
          transactions.unshift({
            id: "T_P_PAY_" + saleRef.id,
            type: "payment",
            amount: paid,
            description: `Satış Ödemesi (Fiş: #${saleRef.id})`,
            timestamp: new Date().toISOString()
          });
          totalDebt = round2(Math.max(0, totalDebt - paid));
          totalPaid = round2(totalPaid + paid);
        }

        transaction.update(customerRef, {
          totalDebt,
          totalPaid,
          transactions
        });
      }

      return {
        id: saleRef.id,
        ...newSaleDocData
      } as Sale;
    });

    await logAuditEvent(uid, {
      action: "SALE_CREATED",
      entityType: "sale",
      entityId: saleResult.id,
      details: {
        totalAmount: saleResult.totalAmount,
        itemsCount: saleResult.items.length,
        customerId
      }
    });

    return saleResult;
  } catch (err: any) {
    console.error("Firestore sale transaction error:", err);
    if (err.message?.includes("Stok Yetersiz") || err.message?.includes("bulunamadı") || err.message?.includes("Yetkisiz")) {
      throw err;
    }
    if (err.code === "failed-precondition" || err.message?.includes("aborted")) {
      throw new Error("Stoklar eşzamanlı olarak başka bir işlem tarafından güncellendi. Lütfen tekrar deneyin.");
    }
    throw new Error(err.message || "Satış işlemi tamamlanırken beklenmedik bir hata oluştu.");
  }
}


// ==========================================
// CUSTOMERS (CRM) SERVICE (Delegated to CustomerRepository)
// ==========================================
export async function getCustomers(uid: string): Promise<Customer[]> {
  return repositories.customers.getAll(uid);
}

export async function addCustomer(uid: string, customer: Omit<Customer, "id">): Promise<Customer> {
  return repositories.customers.create(uid, customer);
}

export async function updateCustomer(customerId: string, updates: Partial<Customer>): Promise<void> {
  await repositories.customers.update(customerId, updates);
}

export async function deleteCustomer(customerId: string): Promise<void> {
  return repositories.customers.delete(customerId);
}

export async function processCustomerPayment(
  uid: string, 
  params: ProcessCustomerPaymentParams
): Promise<ProcessCustomerPaymentResult> {
  return repositories.customers.processPaymentTransaction(uid, params);
}


// ==========================================
// SECTOR SETTINGS SERVICE
// ==========================================
export async function getSectorSettings(uid: string): Promise<SectorSettings> {
  const validUid = assertAuthenticated(uid, "getSectorSettings");
  if (isDemoUser(validUid)) {
    return getLocal<SectorSettings>("stokpro_demo_settings", SEED_SECTOR_SETTINGS);
  }
  const context = await getOrCreateTenantContext(validUid);
  const targetId = context.tenantId || validUid;
  try {
    const docRef = doc(db, "settings", targetId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as SectorSettings;
      setLocal("stokpro_demo_settings", data);
      return data;
    } else {
      // Backward compatibility: check if document exists under validUid
      if (targetId !== validUid) {
        const legacyRef = doc(db, "settings", validUid);
        const legacySnap = await getDoc(legacyRef);
        if (legacySnap.exists()) {
          const lData = legacySnap.data() as SectorSettings;
          setLocal("stokpro_demo_settings", lData);
          return lData;
        }
      }
      const defaultSettings: SectorSettings = {
        activeSector: "genel",
        customFields: [
          { key: "Marka", label: "Marka", type: "text", required: false },
          { key: "RafNo", label: "Raf Numarası", type: "text", required: false }
        ]
      };
      if (context.role === "owner" || context.role === "admin") {
        await setDoc(docRef, defaultSettings);
      }
      setLocal("stokpro_demo_settings", defaultSettings);
      return defaultSettings;
    }
  } catch (err) {
    console.error("Error fetching sector settings:", err);
    if (isDemoAllowed()) {
      return getLocal<SectorSettings>("stokpro_demo_settings", SEED_SECTOR_SETTINGS);
    }
    throw err;
  }
}

export async function saveSectorSettings(uid: string, settings: SectorSettings): Promise<void> {
  const validUid = assertAuthenticated(uid, "saveSectorSettings");
  setLocal("stokpro_demo_settings", settings);
  if (isDemoUser(validUid)) {
    return;
  }
  const context = await getOrCreateTenantContext(validUid);
  if (context.role !== "owner" && context.role !== "admin") {
    throw new Error("Yetkilendirme Hatası: Sektör ayarlarını güncelleme yetkisi yalnızca 'owner' veya 'admin' rollerine aittir.");
  }
  const targetId = context.tenantId || validUid;
  try {
    const docRef = doc(db, "settings", targetId);
    await setDoc(docRef, settings);
  } catch (err) {
    console.error("Error saving sector settings to Firestore, saved to local cache:", err);
  }
}


// ==========================================
// COMPANY INFO SERVICE
// ==========================================
export async function getCompanyInfo(uid: string): Promise<CompanyInfo> {
  const validUid = assertAuthenticated(uid, "getCompanyInfo");
  if (isDemoUser(validUid)) {
    return getLocal<CompanyInfo>("stokpro_demo_company", SEED_COMPANY_INFO);
  }
  const context = await getOrCreateTenantContext(validUid);
  const targetId = context.tenantId || validUid;
  try {
    const docRef = doc(db, "company", targetId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as CompanyInfo;
    } else {
      if (targetId !== validUid) {
        const legacyRef = doc(db, "company", validUid);
        const legacySnap = await getDoc(legacyRef);
        if (legacySnap.exists()) {
          return legacySnap.data() as CompanyInfo;
        }
      }
      const defaultCompany: CompanyInfo = {
        name: context.tenant?.name || "Lütfen Şirket Adını Girin",
        address: "Lütfen Şirket Adresini Girin",
        phone: "+90 500 000 00 00",
        email: "",
        taxOffice: "Marmara",
        taxNumber: "0000000000",
        logo: ""
      };
      if (context.role === "owner" || context.role === "admin") {
        await setDoc(docRef, defaultCompany);
      }
      return defaultCompany;
    }
  } catch (err) {
    console.error("Error fetching company info:", err);
    if (isDemoAllowed()) {
      return getLocal<CompanyInfo>("stokpro_demo_company", SEED_COMPANY_INFO);
    }
    throw err;
  }
}

export async function saveCompanyInfo(uid: string, info: CompanyInfo): Promise<void> {
  const validUid = assertAuthenticated(uid, "saveCompanyInfo");
  if (isDemoUser(validUid)) {
    setLocal("stokpro_demo_company", info);
    return;
  }
  const context = await getOrCreateTenantContext(validUid);
  if (context.role !== "owner" && context.role !== "admin") {
    throw new Error("Yetkilendirme Hatası: Şirket bilgilerini güncelleme yetkisi yalnızca 'owner' veya 'admin' rollerine aittir.");
  }
  const targetId = context.tenantId || validUid;
  try {
    const docRef = doc(db, "company", targetId);
    await setDoc(docRef, info);
  } catch (err) {
    console.error("Error saving company info, falling back to local:", err);
    setLocal("stokpro_demo_company", info);
  }
}


// ==========================================
// ORDERS & WAYBILLS SERVICE (FAZ 13-A9-6-B ATOMIC DELEGATION)
// ==========================================
export async function getOrders(uid: string): Promise<Order[]> {
  return repositories.orders.getAll(uid);
}

export async function createOrderAtomic(uid: string, params: CreateOrderParams): Promise<Order> {
  return repositories.orders.createAtomic(uid, params);
}

export async function cancelOrderAtomic(uid: string, params: CancelOrderParams): Promise<Order> {
  return repositories.orders.cancelAtomic(uid, params);
}

export async function addOrder(uid: string, order: Omit<Order, "id">): Promise<Order> {
  return repositories.orders.createAtomic(uid, {
    items: (order.items || []).map(i => ({
      productId: i.productId,
      quantity: i.quantity,
      price: i.price,
      selectedRollId: i.rollId,
      cutLength: i.cutLength
    })),
    customerId: order.customerId,
    customerDetails: order.customerDetails,
    amountPaid: order.amountPaid,
    waybillNo: order.waybillNo,
    waybillDate: order.waybillDate,
    shipDate: order.shipDate,
    notes: order.notes
  });
}

export async function updateOrder(orderId: string, updates: Partial<Order>): Promise<void> {
  return repositories.orders.update(orderId, updates);
}

export async function deleteOrder(orderId: string): Promise<void> {
  return repositories.orders.delete(orderId);
}

// ==========================================
// CORE DOMAIN: SUPPLIERS (Tedarikçi Servisi)
// ==========================================

const SEED_SUPPLIERS: Supplier[] = [
  {
    id: "SUP-1",
    name: "Akdeniz Dokuma San. Tic. A.Ş.",
    contactPerson: "Mehmet Akdeniz",
    phone: "+90 224 555 1020",
    email: "siparis@akdenizdokuma.com",
    category: "Kumaş & İplik",
    balance: -14500,
    createdAt: new Date().toISOString()
  },
  {
    id: "SUP-2",
    name: "Avrasya Parça & Lojistik A.Ş.",
    contactPerson: "Canan Yılmaz",
    phone: "+90 216 444 8899",
    email: "tedarik@avrasyaparcasi.com",
    category: "Teknik Yedek Parça",
    balance: 0,
    createdAt: new Date().toISOString()
  }
];

export async function getSuppliers(uid: string): Promise<Supplier[]> {
  return repositories.suppliers.getAll(uid);
}

export async function addSupplier(uid: string, supplier: Omit<Supplier, "id" | "createdAt">): Promise<Supplier> {
  return repositories.suppliers.create(uid, supplier);
}

export async function updateSupplier(supplierId: string, updates: Partial<Supplier>): Promise<void> {
  return repositories.suppliers.update(supplierId, updates);
}

export async function deleteSupplier(supplierId: string): Promise<void> {
  return repositories.suppliers.delete(supplierId);
}

// ==========================================
// CORE DOMAIN: WAREHOUSES (Depo Servisi)
// ==========================================

const SEED_WAREHOUSES: Warehouse[] = [
  {
    id: "WH-1",
    name: "Merkez Ana Depo",
    code: "DEP-01",
    location: "A Blok Zemin Kat",
    isDefault: true,
    createdAt: new Date().toISOString()
  },
  {
    id: "WH-2",
    name: "Sevkiyat & Kesim Alanı",
    code: "DEP-02",
    location: "Sevkiyat Rampası",
    isDefault: false,
    createdAt: new Date().toISOString()
  }
];

export async function getWarehouses(uid: string): Promise<Warehouse[]> {
  const validUid = assertAuthenticated(uid, "getWarehouses");
  const context = await getOrCreateTenantContext(validUid);
  if (isDemoUser(validUid)) {
    return getLocal<Warehouse[]>("stokpro_demo_warehouses", SEED_WAREHOUSES);
  }
  try {
    const q = query(collection(db, "warehouses"), where("tenantId", "==", context.tenantId));
    const snapshot = await getDocs(q);
    const warehouses: Warehouse[] = [];
    snapshot.forEach((doc) => {
      warehouses.push({ id: doc.id, ...doc.data() } as Warehouse);
    });
    if (warehouses.length === 0) {
      return SEED_WAREHOUSES;
    }
    return warehouses;
  } catch (err) {
    console.error("Error fetching warehouses:", err);
    if (isDemoAllowed()) {
      return getLocal<Warehouse[]>("stokpro_demo_warehouses", SEED_WAREHOUSES);
    }
    throw err;
  }
}

export async function addWarehouse(uid: string, warehouse: Omit<Warehouse, "id" | "createdAt">): Promise<Warehouse> {
  const validUid = assertAuthenticated(uid, "addWarehouse");
  const context = await getOrCreateTenantContext(validUid);

  if (context.role !== "owner" && context.role !== "admin") {
    throw new Error("Yetkilendirme Hatası: Depo ekleme yetkisi yalnızca 'owner' veya 'admin' rollerine aittir.");
  }

  // Subscription entitlement guard
  const subscription = await getTenantSubscription(context.tenantId);
  const plan = getPlanConfig(subscription.planId);
  if (!isSubscriptionActive(subscription)) {
    throw new Error("Abonelik veya deneme süreniz sona ermiştir. Yeni depo eklemek için lütfen bir plan seçin.");
  }
  if (plan.maxWarehouses !== -1) {
    const existingWarehouses = await getWarehouses(validUid);
    if (existingWarehouses.length >= plan.maxWarehouses) {
      throw new Error(`Mevcut planınız (${plan.name}) maksimum ${plan.maxWarehouses} depo tanımlamanıza izin verir. Lütfen paketinizi yükseltin.`);
    }
  }

  const newWarehouseData = {
    ...warehouse,
    createdAt: new Date().toISOString(),
    tenantId: context.tenantId,
    userId: validUid
  };

  if (isDemoUser(validUid)) {
    const list = getLocal<Warehouse[]>("stokpro_demo_warehouses", SEED_WAREHOUSES);
    const newId = "WH_" + Math.random().toString(36).substring(2, 9).toUpperCase();
    const created = { id: newId, ...newWarehouseData } as Warehouse;
    list.push(created);
    setLocal("stokpro_demo_warehouses", list);
    return created;
  }

  try {
    const docRef = await addDoc(collection(db, "warehouses"), newWarehouseData);
    return { id: docRef.id, ...newWarehouseData } as Warehouse;
  } catch (err) {
    console.error("Error adding warehouse:", err);
    throw err;
  }
}

export async function updateWarehouse(warehouseId: string, updates: Partial<Warehouse>): Promise<void> {
  const validUid = getAuthenticatedUid("updateWarehouse");
  if (isDemoUser(validUid)) {
    const list = getLocal<Warehouse[]>("stokpro_demo_warehouses", SEED_WAREHOUSES);
    const updated = list.map(w => w.id === warehouseId ? { ...w, ...updates } : w);
    setLocal("stokpro_demo_warehouses", updated);
    return;
  }
  const context = await getOrCreateTenantContext(validUid);
  if (context.role !== "owner" && context.role !== "admin") {
    throw new Error("Yetkilendirme Hatası: Depo güncelleme yetkisi yalnızca 'owner' veya 'admin' rollerine aittir.");
  }
  try {
    const docRef = doc(db, "warehouses", warehouseId);
    await updateDoc(docRef, updates);
  } catch (err) {
    console.error("Error updating warehouse:", err);
    throw err;
  }
}

export async function deleteWarehouse(warehouseId: string): Promise<void> {
  const validUid = getAuthenticatedUid("deleteWarehouse");
  if (isDemoUser(validUid)) {
    const list = getLocal<Warehouse[]>("stokpro_demo_warehouses", SEED_WAREHOUSES);
    const filtered = list.filter(w => w.id !== warehouseId);
    setLocal("stokpro_demo_warehouses", filtered);
    return;
  }
  const context = await getOrCreateTenantContext(validUid);
  if (context.role !== "owner" && context.role !== "admin") {
    throw new Error("Yetkilendirme Hatası: Depo silme yetkisi yalnızca 'owner' veya 'admin' rollerine aittir.");
  }
  try {
    const docRef = doc(db, "warehouses", warehouseId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error("Error deleting warehouse:", err);
    throw err;
  }
}

// ==========================================
// CORE DOMAIN: PAYMENTS & FINANCIAL LEDGER
// ==========================================

export async function getPayments(uid: string): Promise<Payment[]> {
  const validUid = assertAuthenticated(uid, "getPayments");
  if (isDemoUser(validUid)) {
    return getLocal<Payment[]>("stokpro_demo_payments", []);
  }
  try {
    const context = await getOrCreateTenantContext(validUid);
    const q = query(collection(db, "payments"), where("tenantId", "==", context.tenantId));
    const snapshot = await getDocs(q);
    const payments: Payment[] = [];
    snapshot.forEach((doc) => {
      payments.push({ id: doc.id, ...doc.data() } as Payment);
    });
    return payments;
  } catch (err) {
    console.error("Error fetching payments:", err);
    if (isDemoAllowed()) {
      return getLocal<Payment[]>("stokpro_demo_payments", []);
    }
    throw err;
  }
}

export async function addPayment(uid: string, payment: Omit<Payment, "id">): Promise<Payment> {
  const validUid = assertAuthenticated(uid, "addPayment");
  const context = await getOrCreateTenantContext(validUid);
  const newPaymentData = {
    ...payment,
    tenantId: context.tenantId,
    userId: validUid
  };

  if (isDemoUser(validUid)) {
    const list = getLocal<Payment[]>("stokpro_demo_payments", []);
    const newId = "PAY_" + Math.random().toString(36).substring(2, 9).toUpperCase();
    const created = { id: newId, ...newPaymentData } as Payment;
    list.push(created);
    setLocal("stokpro_demo_payments", list);

    await logAuditEvent(validUid, {
      action: "PAYMENT_RECEIVED",
      entityType: "customer",
      entityId: payment.customerId || newId,
      companyId: context.tenantId,
      details: { amount: payment.amount, type: payment.type, method: payment.paymentMethod }
    });

    return created;
  }

  try {
    const docRef = await addDoc(collection(db, "payments"), newPaymentData);
    const created = { id: docRef.id, ...newPaymentData } as Payment;

    await logAuditEvent(validUid, {
      action: "PAYMENT_RECEIVED",
      entityType: "customer",
      entityId: payment.customerId || docRef.id,
      companyId: context.tenantId,
      details: { amount: payment.amount, type: payment.type, method: payment.paymentMethod }
    });

    return created;
  } catch (err) {
    console.error("Error adding payment:", err);
    throw err;
  }
}

// ==========================================
// CORE DOMAIN: STOCK MOVEMENTS
// ==========================================

export async function getStockMovements(uid: string): Promise<StockMovement[]> {
  const validUid = assertAuthenticated(uid, "getStockMovements");
  if (isDemoUser(validUid)) {
    return getLocal<StockMovement[]>("stokpro_demo_stock_movements", []);
  }
  try {
    const context = await getOrCreateTenantContext(validUid);
    const q = query(collection(db, "stock_movements"), where("tenantId", "==", context.tenantId), limit(100));
    const snapshot = await getDocs(q);
    const movements: StockMovement[] = [];
    snapshot.forEach((doc) => {
      movements.push({ id: doc.id, ...doc.data() } as StockMovement);
    });
    return movements;
  } catch (err) {
    console.error("Error fetching stock movements:", err);
    if (isDemoAllowed()) {
      return getLocal<StockMovement[]>("stokpro_demo_stock_movements", []);
    }
    throw err;
  }
}

export async function recordStockMovement(uid: string, movement: Omit<StockMovement, "id">): Promise<StockMovement> {
  const validUid = assertAuthenticated(uid, "recordStockMovement");
  const context = await getOrCreateTenantContext(validUid);
  const movementData = {
    ...movement,
    tenantId: context.tenantId,
    userId: validUid,
    timestamp: movement.timestamp || new Date().toISOString()
  };

  if (isDemoUser(validUid)) {
    const list = getLocal<StockMovement[]>("stokpro_demo_stock_movements", []);
    const newId = "SM_" + Math.random().toString(36).substring(2, 9).toUpperCase();
    const created = { id: newId, ...movementData } as StockMovement;
    list.push(created);
    setLocal("stokpro_demo_stock_movements", list);
    return created;
  }

  try {
    const docRef = await addDoc(collection(db, "stock_movements"), movementData);
    return { id: docRef.id, ...movementData } as StockMovement;
  } catch (err) {
    console.error("Error recording stock movement:", err);
    throw err;
  }
}

// ==========================================
// SAAS SUBSCRIPTION & ENTITLEMENTS SERVICE
// ==========================================

const SEED_SUBSCRIPTION: Subscription = {
  id: "demo-sub",
  tenantId: "demo-tenant",
  planId: "pro",
  status: "trialing",
  startDate: new Date().toISOString(),
  endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  trialEndDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  provider: "none",
  createdAt: new Date().toISOString()
};

/**
 * Retrieves the current subscription for a tenant.
 * Delegated to SubscriptionRepository.
 */
export async function getTenantSubscription(tenantId: string): Promise<Subscription> {
  return repositories.subscriptions.getByTenantId(tenantId);
}

/**
 * Updates a tenant's subscription plan.
 * Delegated to SubscriptionRepository.
 */
export async function updateTenantSubscriptionPlan(
  tenantId: string,
  planId: PlanId,
  billingPeriod: "monthly" | "yearly" = "monthly"
): Promise<Subscription> {
  return repositories.subscriptions.updatePlan(tenantId, planId, billingPeriod);
}

/**
 * Cancels or sets auto-renew to false for a tenant subscription.
 * Delegated to SubscriptionRepository.
 */
export async function cancelTenantSubscription(tenantId: string): Promise<Subscription> {
  return repositories.subscriptions.cancel(tenantId);
}

/**
 * Fetches tenant entitlement summary (usage + plan limits).
 * Delegated to SubscriptionRepository.
 */
export async function getTenantEntitlement(uid: string): Promise<SubscriptionEntitlement> {
  return repositories.subscriptions.getEntitlement(uid);
}

// ==========================================
// PAYMENT PROVIDER & WEBHOOK CLIENT SERVICES
// ==========================================

export async function fetchPaymentConfig(): Promise<{
  provider: string;
  isSandbox: boolean;
  currency: string;
  hasWebhookConfigured: boolean;
  availableProviders: string[];
  activeProvider: string;
}> {
  try {
    const res = await fetch("/api/payment/config");
    if (!res.ok) throw new Error("Ödeme konfigürasyonu alınamadı");
    return await res.json();
  } catch (err) {
    console.warn("fetchPaymentConfig fallback:", err);
    return {
      provider: "mock",
      isSandbox: true,
      currency: "TRY",
      hasWebhookConfigured: true,
      availableProviders: ["mock", "iyzico", "paytr"],
      activeProvider: "mock"
    };
  }
}

export async function createPaymentCheckoutSession(params: {
  tenantId: string;
  planId: string;
  billingPeriod: "monthly" | "yearly";
  amount: number;
  customer?: any;
}): Promise<any> {
  const res = await fetch("/api/payment/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Ödeme oturumu başlatılamadı.");
  }
  return await res.json();
}

export async function simulateWebhookEventApi(params: {
  type: string;
  tenantId: string;
  planId?: string;
  amount?: number;
  billingPeriod?: "monthly" | "yearly";
  failureReason?: string;
  tamperSignature?: boolean;
  duplicateEventId?: string;
}): Promise<any> {
  const res = await fetch("/api/payment/simulate-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      statusCode: res.status,
      result: data.result || data,
      error: data.error || "İşlem başarısız"
    };
  }
  return data;
}

export async function fetchPaymentWebhookEvents(tenantId?: string): Promise<any[]> {
  try {
    const url = tenantId ? `/api/payment/events?tenantId=${encodeURIComponent(tenantId)}` : "/api/payment/events";
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

export async function switchPaymentProviderApi(provider: string): Promise<any> {
  const res = await fetch("/api/payment/set-provider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || "Sağlayıcı değiştirilemedi.");
  }
  return await res.json();
}
