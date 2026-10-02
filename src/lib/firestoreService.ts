import { 
  db,
  auth
} from "./firebase";
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
  orderBy
} from "firebase/firestore";
import { 
  Product, 
  Sale, 
  Customer, 
  SectorSettings, 
  CompanyInfo, 
  Order 
} from "../types";

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
  localStorage.setItem(key, JSON.stringify(value));
}

// ==========================================
// PRODUCTS SERVICE
// ==========================================
export async function getProducts(uid: string): Promise<Product[]> {
  if (uid === "demo-user") {
    return getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
  }
  try {
    const q = query(collection(db, "products"), where("userId", "==", uid));
    const snapshot = await getDocs(q);
    const products: Product[] = [];
    snapshot.forEach((doc) => {
      products.push({ id: doc.id, ...doc.data() } as Product);
    });
    return products;
  } catch (err) {
    console.error("Error fetching products:", err);
    throw err;
  }
}

export async function addProduct(uid: string, product: Omit<Product, "id">): Promise<Product> {
  if (uid === "demo-user") {
    const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
    const newId = "P_" + Math.random().toString(36).substring(2, 9).toUpperCase();
    const newProduct = { id: newId, ...product } as Product;
    list.push(newProduct);
    setLocal("stokpro_demo_products", list);
    return newProduct;
  }
  try {
    const docRef = await addDoc(collection(db, "products"), {
      ...product,
      userId: uid,
      createdAt: new Date().toISOString()
    });
    return { id: docRef.id, ...product } as Product;
  } catch (err) {
    console.error("Error adding product:", err);
    throw err;
  }
}

export async function updateProduct(productId: string, updates: Partial<Product>): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid === "demo-user") {
    const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
    const updated = list.map(p => p.id === productId ? { ...p, ...updates } : p);
    setLocal("stokpro_demo_products", updated);
    return;
  }
  try {
    const docRef = doc(db, "products", productId);
    await updateDoc(docRef, updates);
  } catch (err) {
    console.error("Error updating product:", err);
    throw err;
  }
}

export async function deleteProduct(productId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid === "demo-user") {
    const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
    const filtered = list.filter(p => p.id !== productId);
    setLocal("stokpro_demo_products", filtered);
    return;
  }
  try {
    const docRef = doc(db, "products", productId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error("Error deleting product:", err);
    throw err;
  }
}


// ==========================================
// SALES SERVICE
// ==========================================
export async function getSales(uid: string): Promise<Sale[]> {
  if (uid === "demo-user") {
    const list = getLocal<Sale[]>("stokpro_demo_sales", SEED_SALES);
    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
  try {
    const q = query(collection(db, "sales"), where("userId", "==", uid));
    const snapshot = await getDocs(q);
    const sales: Sale[] = [];
    snapshot.forEach((doc) => {
      sales.push({ id: doc.id, ...doc.data() } as Sale);
    });
    return sales.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  } catch (err) {
    console.error("Error fetching sales:", err);
    throw err;
  }
}

export async function addSale(uid: string, sale: Omit<Sale, "id">): Promise<Sale> {
  if (uid === "demo-user") {
    const list = getLocal<Sale[]>("stokpro_demo_sales", SEED_SALES);
    const newId = "S_" + Math.random().toString(36).substring(2, 9).toUpperCase();
    const newSale = { id: newId, ...sale } as Sale;
    list.push(newSale);
    setLocal("stokpro_demo_sales", list);
    return newSale;
  }
  try {
    const docRef = await addDoc(collection(db, "sales"), {
      ...sale,
      userId: uid
    });
    return { id: docRef.id, ...sale } as Sale;
  } catch (err) {
    console.error("Error adding sale:", err);
    throw err;
  }
}


// ==========================================
// CUSTOMERS (CRM) SERVICE
// ==========================================
export async function getCustomers(uid: string): Promise<Customer[]> {
  if (uid === "demo-user") {
    return getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
  }
  try {
    const q = query(collection(db, "customers"), where("userId", "==", uid));
    const snapshot = await getDocs(q);
    const customers: Customer[] = [];
    snapshot.forEach((doc) => {
      customers.push({ id: doc.id, ...doc.data() } as Customer);
    });
    return customers;
  } catch (err) {
    console.error("Error fetching customers:", err);
    throw err;
  }
}

export async function addCustomer(uid: string, customer: Omit<Customer, "id">): Promise<Customer> {
  if (uid === "demo-user") {
    const list = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
    const newId = "C_" + Math.random().toString(36).substring(2, 9).toUpperCase();
    const newCustomer = { id: newId, ...customer } as Customer;
    list.push(newCustomer);
    setLocal("stokpro_demo_customers", list);
    return newCustomer;
  }
  try {
    const docRef = await addDoc(collection(db, "customers"), {
      ...customer,
      userId: uid
    });
    return { id: docRef.id, ...customer } as Customer;
  } catch (err) {
    console.error("Error adding customer:", err);
    throw err;
  }
}

export async function updateCustomer(customerId: string, updates: Partial<Customer>): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid === "demo-user") {
    const list = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
    const updated = list.map(c => c.id === customerId ? { ...c, ...updates } : c);
    setLocal("stokpro_demo_customers", updated);
    return;
  }
  try {
    const docRef = doc(db, "customers", customerId);
    await updateDoc(docRef, updates);
  } catch (err) {
    console.error("Error updating customer:", err);
    throw err;
  }
}

export async function deleteCustomer(customerId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid === "demo-user") {
    const list = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
    const filtered = list.filter(c => c.id !== customerId);
    setLocal("stokpro_demo_customers", filtered);
    return;
  }
  try {
    const docRef = doc(db, "customers", customerId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error("Error deleting customer:", err);
    throw err;
  }
}


// ==========================================
// SECTOR SETTINGS SERVICE
// ==========================================
export async function getSectorSettings(uid: string): Promise<SectorSettings> {
  if (!uid || uid === "demo-user" || uid.startsWith("local-")) {
    return getLocal<SectorSettings>("stokpro_demo_settings", SEED_SECTOR_SETTINGS);
  }
  try {
    const docRef = doc(db, "settings", uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const data = docSnap.data() as SectorSettings;
      setLocal("stokpro_demo_settings", data);
      return data;
    } else {
      const defaultSettings: SectorSettings = {
        activeSector: "genel",
        customFields: [
          { key: "Marka", label: "Marka", type: "text", required: false },
          { key: "RafNo", label: "Raf Numarası", type: "text", required: false }
        ]
      };
      await setDoc(docRef, defaultSettings);
      setLocal("stokpro_demo_settings", defaultSettings);
      return defaultSettings;
    }
  } catch (err) {
    console.error("Error fetching sector settings:", err);
    return getLocal<SectorSettings>("stokpro_demo_settings", SEED_SECTOR_SETTINGS);
  }
}

export async function saveSectorSettings(uid: string, settings: SectorSettings): Promise<void> {
  // Always write to local storage first for offline/immediate consistency
  setLocal("stokpro_demo_settings", settings);
  if (!uid || uid === "demo-user" || uid.startsWith("local-")) {
    return;
  }
  try {
    const docRef = doc(db, "settings", uid);
    await setDoc(docRef, settings);
  } catch (err) {
    console.error("Error saving sector settings to Firestore, saved to local cache:", err);
  }
}


// ==========================================
// COMPANY INFO SERVICE
// ==========================================
export async function getCompanyInfo(uid: string): Promise<CompanyInfo> {
  if (!uid || uid === "demo-user" || uid.startsWith("local-")) {
    return getLocal<CompanyInfo>("stokpro_demo_company", SEED_COMPANY_INFO);
  }
  try {
    const docRef = doc(db, "company", uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as CompanyInfo;
    } else {
      const defaultCompany: CompanyInfo = {
        name: "Lütfen Şirket Adını Girin",
        address: "Lütfen Şirket Adresini Girin",
        phone: "+90 500 000 00 00",
        email: "",
        taxOffice: "Marmara",
        taxNumber: "0000000000",
        logo: ""
      };
      await setDoc(docRef, defaultCompany);
      return defaultCompany;
    }
  } catch (err) {
    console.error("Error fetching company info:", err);
    return getLocal<CompanyInfo>("stokpro_demo_company", SEED_COMPANY_INFO);
  }
}

export async function saveCompanyInfo(uid: string, info: CompanyInfo): Promise<void> {
  if (!uid || uid === "demo-user" || uid.startsWith("local-")) {
    setLocal("stokpro_demo_company", info);
    return;
  }
  try {
    const docRef = doc(db, "company", uid);
    await setDoc(docRef, info);
  } catch (err) {
    console.error("Error saving company info, falling back to local:", err);
    setLocal("stokpro_demo_company", info);
  }
}


// ==========================================
// ORDERS & WAYBILLS SERVICE
// ==========================================
export async function getOrders(uid: string): Promise<Order[]> {
  if (uid === "demo-user") {
    return getLocal<Order[]>("stokpro_demo_orders", []);
  }
  try {
    const q = query(collection(db, "orders"), where("userId", "==", uid));
    const snapshot = await getDocs(q);
    const orders: Order[] = [];
    snapshot.forEach((doc) => {
      orders.push({ id: doc.id, ...doc.data() } as Order);
    });
    return orders;
  } catch (err) {
    console.error("Error fetching orders:", err);
    throw err;
  }
}

export async function addOrder(uid: string, order: Omit<Order, "id">): Promise<Order> {
  if (uid === "demo-user") {
    const list = getLocal<Order[]>("stokpro_demo_orders", []);
    const newId = "O_" + Math.random().toString(36).substring(2, 9).toUpperCase();
    const newOrder = { id: newId, ...order } as Order;
    list.push(newOrder);
    setLocal("stokpro_demo_orders", list);
    return newOrder;
  }
  try {
    const docRef = await addDoc(collection(db, "orders"), {
      ...order,
      userId: uid
    });
    return { id: docRef.id, ...order } as Order;
  } catch (err) {
    console.error("Error adding order:", err);
    throw err;
  }
}

export async function updateOrder(orderId: string, updates: Partial<Order>): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid === "demo-user") {
    const list = getLocal<Order[]>("stokpro_demo_orders", []);
    const updated = list.map(o => o.id === orderId ? { ...o, ...updates } : o);
    setLocal("stokpro_demo_orders", updated);
    return;
  }
  try {
    const docRef = doc(db, "orders", orderId);
    await updateDoc(docRef, updates);
  } catch (err) {
    console.error("Error updating order:", err);
    throw err;
  }
}

export async function deleteOrder(orderId: string): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid === "demo-user") {
    const list = getLocal<Order[]>("stokpro_demo_orders", []);
    const filtered = list.filter(o => o.id !== orderId);
    setLocal("stokpro_demo_orders", filtered);
    return;
  }
  try {
    const docRef = doc(db, "orders", orderId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error("Error deleting order:", err);
    throw err;
  }
}
