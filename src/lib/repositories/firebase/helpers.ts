import { 
  Product, 
  Sale, 
  Customer, 
  Supplier, 
  Subscription, 
  AuditLog, 
  AuditAction 
} from "../../../types";
import { db } from "../../firebase";
import { collection, addDoc, Firestore } from "firebase/firestore";

export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Rounds physical stock quantities to 3 decimal places (e.g. 1.255 kg or 12.350 m)
 * to prevent floating point inaccuracies while preserving precise inventory values.
 */
export function roundQty(num: number): number {
  return Math.round((num + Number.EPSILON) * 1000) / 1000;
}

export function getLocal<T>(key: string, defaultValue: T): T {
  const storage = typeof window !== "undefined" && window.localStorage 
    ? window.localStorage 
    : (typeof globalThis !== "undefined" && (globalThis as any).localStorage ? (globalThis as any).localStorage : null);

  if (!storage) {
    return defaultValue;
  }
  const stored = storage.getItem(key);
  if (!stored) {
    storage.setItem(key, JSON.stringify(defaultValue));
    return defaultValue;
  }
  try {
    return JSON.parse(stored) as T;
  } catch {
    return defaultValue;
  }
}

export function setLocal<T>(key: string, value: T): void {
  const storage = typeof window !== "undefined" && window.localStorage 
    ? window.localStorage 
    : (typeof globalThis !== "undefined" && (globalThis as any).localStorage ? (globalThis as any).localStorage : null);

  if (storage) {
    storage.setItem(key, JSON.stringify(value));
  }
}

export const SEED_PRODUCTS: Product[] = [
  {
    id: "P1",
    name: "Premium Pamuk Kumaş",
    sku: "PROD_P1",
    category: "Kumaş",
    unit: "Metre",
    price: 250,
    stock: 45,
    minStock: 10,
    isActive: true,
    isPackaged: true,
    packageUnitsCount: 50,
    packageUnitName: "Metre",
    subUnitStock: 35,
    attributes: { "Renk": "Mavi", "En": "150cm" },
    metadata: {
      fabricType: "Pamuklu Viskon",
      color: "Mavi",
      width: "150cm"
    },
    rolls: [
      { id: "R-P1-1", rollNumber: "Top #1 (Mavi)", length: 25, initialLength: 25, status: "available" },
      { id: "R-P1-2", rollNumber: "Top #2 (Mavi)", length: 20, initialLength: 20, status: "available" }
    ]
  },
  {
    id: "P2",
    name: "Saten İpek Kumaş",
    sku: "PROD_P2",
    category: "Kumaş",
    unit: "Metre",
    price: 450,
    stock: 20,
    minStock: 5,
    isActive: true,
    isPackaged: true,
    packageUnitsCount: 30,
    packageUnitName: "Metre",
    subUnitStock: 30,
    attributes: { "Renk": "Kırmızı", "En": "120cm" },
    metadata: {
      fabricType: "Saf İpek",
      color: "Kırmızı",
      width: "120cm"
    },
    rolls: [
      { id: "R-P2-1", rollNumber: "Top #1 (Kırmızı)", length: 20, initialLength: 20, status: "available" }
    ]
  },
  {
    id: "P3",
    name: "Düğme Seti (Metal)",
    sku: "PROD_P3",
    category: "Aksesuar",
    unit: "Paket",
    price: 25,
    stock: 150,
    minStock: 25,
    isActive: true,
    attributes: { "Malzeme": "Pirinç" }
  },
  {
    id: "P4",
    name: "İplik Seti (12 Renk)",
    sku: "PROD_P4",
    category: "Aksesuar",
    unit: "Kutu",
    price: 75,
    stock: 8,
    minStock: 15,
    isActive: true
  }
];

export const SEED_SALES: Sale[] = [
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

export const SEED_CUSTOMERS: Customer[] = [
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

export const SEED_SUPPLIERS: Supplier[] = [
  {
    id: "SUP_1",
    tenantId: "demo-tenant",
    name: "Bursa Dokuma & İplik A.Ş.",
    contactPerson: "Mehmet Demir",
    phone: "+90 224 456 78 90",
    email: "siparis@bursadokuma.com",
    address: "Organize Sanayi Bölgesi 4. Cadde No:12 Nilüfer / Bursa",
    category: "Kumaş & Dokuma",
    balance: -45000,
    createdAt: new Date().toISOString()
  },
  {
    id: "SUP_2",
    tenantId: "demo-tenant",
    name: "Ege Fermuar ve Metal Aksesuar Ltd.",
    contactPerson: "Hülya Yılmaz",
    phone: "+90 232 345 67 89",
    email: "info@egefermuar.com",
    address: "Işıkkent Ayakkabıcılar Sitesi No: 45 Bornova / İzmir",
    category: "Aksesuar & Malzeme",
    balance: 0,
    createdAt: new Date().toISOString()
  }
];

export const SEED_SUBSCRIPTION: Subscription = {
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

import { isDemoUser } from "../../authGuard";

export async function logAuditEvent(uid: string, event: {
  action: AuditAction;
  entityType: 'product' | 'sale' | 'customer' | 'roll' | 'order';
  entityId: string;
  companyId?: string;
  details?: Record<string, any>;
}, customDb?: Firestore): Promise<void> {
  const timestamp = new Date().toISOString();
  const logEntry: AuditLog = {
    userId: uid,
    companyId: event.companyId || uid,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    timestamp,
    details: event.details || {}
  };

  if (isDemoUser(uid)) {
    const list = getLocal<AuditLog[]>("stokpro_demo_audit_logs", []);
    list.unshift(logEntry);
    setLocal("stokpro_demo_audit_logs", list);
    return;
  }

  try {
    await addDoc(collection(customDb || db, "audit_logs"), logEntry);
  } catch (err) {
    console.warn("Audit log notice:", err);
  }
}
