import express from "express";
import path from "path";
import fs from "fs/promises";
import { createServer as createViteServer } from "vite";

interface FabricRoll {
  id: string;
  rollNumber: string; // e.g. "Top #1", "Top #2"
  length: number;    // current length in meters
  initialLength: number; // original length in meters
  status: 'available' | 'sold' | 'reserved';
}

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  minStock: number;
  // Dynamic fields
  attributes?: Record<string, string>;
  // Kısmi Stok / Paket İçi Eksiltme
  isPackaged?: boolean;
  packageUnitsCount?: number;
  packageUnitName?: string;
  subUnitStock?: number;
  // Kumaş topları takibi
  rolls?: FabricRoll[];
}

interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

interface Sale {
  id: string;
  items: SaleItem[];
  totalAmount: number;
  timestamp: string;
}

interface CustomerTransaction {
  id: string;
  type: 'sale' | 'payment';
  amount: number;
  description: string;
  timestamp: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  instagram: string;
  totalDebt: number; // Ödenmemiş borç
  totalPaid: number; // Ödenen miktar
  notes?: string;
  transactions: CustomerTransaction[];
  address?: string;
  taxOffice?: string;
  taxNumber?: string;
}

interface SectorField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  required: boolean;
}

interface SectorSettings {
  activeSector: string;
  customFields: SectorField[];
}

interface CompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  taxOffice: string;
  taxNumber: string;
  logo: string; // Base64 or image URL
}

interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  rollId?: string;
  rollNumber?: string;
  cutLength?: number;
}

interface Order {
  id: string;
  orderNo: string;
  customerId?: string;
  customerName?: string;
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
  orderDate: string;
  waybillNo?: string;
  waybillDate?: string;
  shipDate?: string;
  notes?: string;
}

interface DB {
  products: Product[];
  sales: Sale[];
  customers: Customer[];
  sectorSettings: SectorSettings;
  companyInfo?: CompanyInfo;
  orders?: Order[];
}

const DATA_FILE = path.join(process.cwd(), "data.json");

// Default DB structure
const defaultDB: DB = {
  products: [
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
      attributes: { "Renk": "Mavi", "En": "150cm" },
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
      price: 450, 
      stock: 20, 
      minStock: 5,
      isPackaged: true,
      packageUnitsCount: 30,
      packageUnitName: "Metre",
      subUnitStock: 30,
      attributes: { "Renk": "Kırmızı", "En": "120cm" },
      rolls: [
        { id: "R-P2-1", rollNumber: "Top #1 (Kırmızı)", length: 20, initialLength: 20, status: "available" }
      ]
    },
    { id: "P3", name: "Düğme Seti (Metal)", sku: "PROD_P3", category: "Aksesuar", price: 25, stock: 150, minStock: 25, attributes: { "Malzeme": "Pirinç" } },
    { id: "P4", name: "İplik Seti (12 Renk)", sku: "PROD_P4", category: "Aksesuar", price: 75, stock: 8, minStock: 15 }
  ],
  sales: [
    {
      id: "S1",
      items: [
        { productId: "P1", productName: "Premium Pamuk Kumaş", quantity: 2, price: 250 }
      ],
      totalAmount: 500,
      timestamp: new Date(Date.now() - 3600000 * 2).toISOString()
    }
  ],
  customers: [
    {
      id: "C1",
      name: "Ahmet Yılmaz (Yılmaz Tekstil)",
      phone: "+905321234567",
      instagram: "yilmaz_tekstil",
      totalDebt: 500,
      totalPaid: 1200,
      notes: "Güvenilir toptancı müşteri",
      transactions: [
        { id: "T1", type: "sale", amount: 1700, description: "Kumaş Alımı (Fiş: #S1)", timestamp: new Date(Date.now() - 86400000).toISOString() },
        { id: "T2", type: "payment", amount: 1200, description: "Banka Havalesi Ödemesi", timestamp: new Date(Date.now() - 43200000).toISOString() }
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
        { id: "T3", type: "sale", amount: 450, description: "Butik Sipariş", timestamp: new Date(Date.now() - 172800000).toISOString() },
        { id: "T4", type: "payment", amount: 450, description: "Elden Nakit Ödeme", timestamp: new Date(Date.now() - 172800000).toISOString() }
      ]
    }
  ],
  sectorSettings: {
    activeSector: "tekstil",
    customFields: [
      { key: "Renk", label: "Renk", type: "text", required: false },
      { key: "En", label: "Kumaş Eni (cm)", type: "text", required: false },
      { key: "Malzeme", label: "Malzeme Tipi", type: "text", required: false }
    ]
  },
  companyInfo: {
    name: "Örnek Tekstil ve Sanayi Tic. Ltd. Şti.",
    address: "Merkez Mahallesi, Şair Nigar Sokak No: 45, Şişli, İstanbul",
    phone: "+90 212 555 44 33",
    email: "info@ornektekstil.com",
    taxOffice: "Şişli",
    taxNumber: "1234567890",
    logo: ""
  },
  orders: []
};

async function readDB(): Promise<DB> {
  try {
    const data = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(data);
    
    // Ensure backwards compatibility for older json structures
    let updated = false;
    if (!parsed.customers) {
      parsed.customers = defaultDB.customers;
      updated = true;
    }
    if (!parsed.sectorSettings) {
      parsed.sectorSettings = defaultDB.sectorSettings;
      updated = true;
    }
    if (!parsed.companyInfo) {
      parsed.companyInfo = defaultDB.companyInfo;
      updated = true;
    }
    if (!parsed.orders) {
      parsed.orders = defaultDB.orders || [];
      updated = true;
    }
    
    // Auto-migrate old products to support fabric rolls if category is cloth
    if (parsed.products) {
      for (const p of parsed.products) {
        if (!p.rolls) {
          if (p.category && (p.category.toLowerCase().includes("kumaş") || p.category.toLowerCase().includes("kumas"))) {
            p.rolls = [
              { id: "R-" + p.id + "-1", rollNumber: "Top #1", length: p.stock, initialLength: p.stock, status: "available" }
            ];
            updated = true;
          } else {
            p.rolls = [];
          }
        }
      }
    }

    if (updated) {
      await fs.writeFile(DATA_FILE, JSON.stringify(parsed, null, 2));
    }
    return parsed;
  } catch (err) {
    // If file doesn't exist, create it with default data
    await fs.writeFile(DATA_FILE, JSON.stringify(defaultDB, null, 2));
    return defaultDB;
  }
}

async function writeDB(db: DB): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Endpoints
  // 1. Get products
  app.get("/api/products", async (req, res) => {
    try {
      const db = await readDB();
      res.json(db.products);
    } catch (err) {
      res.status(500).json({ error: "Veritabanı okunamadı." });
    }
  });

  // 2. Add product
  app.post("/api/products", async (req, res) => {
    try {
      const { name, category, price, stock, minStock, sku, attributes, isPackaged, packageUnitsCount, packageUnitName, subUnitStock, rolls } = req.body;
      if (!name || price === undefined || stock === undefined) {
        return res.status(400).json({ error: "Ürün adı, fiyat ve stok alanları zorunludur." });
      }

      const db = await readDB();
      const id = "P" + Math.random().toString(36).substring(2, 8).toUpperCase();
      const productSku = sku || `PROD_${id}`;

      // Check if SKU is unique
      const skuExists = db.products.some(p => p.sku === productSku);
      if (skuExists) {
        return res.status(400).json({ error: "Bu SKU/Barkod koduna sahip başka bir ürün zaten var." });
      }

      const cleanCategory = String(category || "Genel").trim();
      let productRolls: FabricRoll[] = [];

      if (rolls && Array.isArray(rolls)) {
        productRolls = rolls.map((r: any, idx: number) => ({
          id: r.id || "R-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
          rollNumber: r.rollNumber || `Top #${idx + 1}`,
          length: Number(r.length || 0),
          initialLength: Number(r.initialLength || r.length || 0),
          status: r.status || 'available'
        }));
      } else if (cleanCategory.toLowerCase().includes("kumaş") || cleanCategory.toLowerCase().includes("kumas")) {
        // Auto-generate fabric rolls based on total stock
        let remaining = Number(stock || 0);
        let rollCounter = 1;
        while (remaining > 0) {
          const rollLen = Math.min(remaining, 50); // Split in max 50m rolls
          productRolls.push({
            id: "R-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
            rollNumber: `Top #${rollCounter++}`,
            length: rollLen,
            initialLength: rollLen,
            status: 'available'
          });
          remaining -= rollLen;
        }
      }

      const newProduct: Product = {
        id,
        name: String(name).trim(),
        sku: String(productSku).trim(),
        category: cleanCategory,
        price: Number(price),
        stock: productRolls.length > 0 ? productRolls.reduce((sum, r) => sum + r.length, 0) : Number(stock),
        minStock: Number(minStock || 0),
        attributes: attributes || {},
        isPackaged: !!isPackaged,
        packageUnitsCount: packageUnitsCount !== undefined ? Number(packageUnitsCount) : undefined,
        packageUnitName: packageUnitName !== undefined ? String(packageUnitName).trim() : undefined,
        subUnitStock: subUnitStock !== undefined ? Number(subUnitStock) : undefined,
        rolls: productRolls
      };

      db.products.push(newProduct);
      await writeDB(db);
      res.status(201).json(newProduct);
    } catch (err) {
      res.status(500).json({ error: "Ürün eklenemedi." });
    }
  });

  // 3. Update product (stock increase/decrease or editing)
  app.put("/api/products/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, category, price, stock, minStock, sku, attributes, isPackaged, packageUnitsCount, packageUnitName, subUnitStock, rolls } = req.body;

      const db = await readDB();
      const index = db.products.findIndex(p => p.id === id);
      if (index === -1) {
        return res.status(404).json({ error: "Ürün bulunamadı." });
      }

      const current = db.products[index];

      // Validate SKU uniqueness if changing
      if (sku && sku !== current.sku) {
        const skuExists = db.products.some(p => p.sku === sku);
        if (skuExists) {
          return res.status(400).json({ error: "Bu SKU/Barkod koduna sahip başka bir ürün zaten var." });
        }
      }

      let finalRolls = current.rolls || [];
      let finalStock = stock !== undefined ? Number(stock) : current.stock;

      if (rolls !== undefined && Array.isArray(rolls)) {
        finalRolls = rolls.map((r: any, idx: number) => ({
          id: r.id || "R-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
          rollNumber: r.rollNumber || `Top #${idx + 1}`,
          length: Number(r.length || 0),
          initialLength: Number(r.initialLength || r.length || 0),
          status: r.status || 'available'
        }));
        // Recalculate stock
        finalStock = finalRolls.reduce((sum, r) => sum + r.length, 0);
      }

      db.products[index] = {
        ...current,
        name: name !== undefined ? String(name).trim() : current.name,
        category: category !== undefined ? String(category).trim() : current.category,
        price: price !== undefined ? Number(price) : current.price,
        stock: finalStock,
        minStock: minStock !== undefined ? Number(minStock) : current.minStock,
        sku: sku !== undefined ? String(sku).trim() : current.sku,
        attributes: attributes !== undefined ? attributes : current.attributes,
        isPackaged: isPackaged !== undefined ? !!isPackaged : current.isPackaged,
        packageUnitsCount: packageUnitsCount !== undefined ? Number(packageUnitsCount) : current.packageUnitsCount,
        packageUnitName: packageUnitName !== undefined ? String(packageUnitName).trim() : current.packageUnitName,
        subUnitStock: subUnitStock !== undefined ? Number(subUnitStock) : current.subUnitStock,
        rolls: finalRolls
      };

      await writeDB(db);
      res.json(db.products[index]);
    } catch (err) {
      res.status(500).json({ error: "Ürün güncellenemedi." });
    }
  });

  // 4. Delete product
  app.delete("/api/products/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const db = await readDB();
      const initialLength = db.products.length;
      db.products = db.products.filter(p => p.id !== id);

      if (db.products.length === initialLength) {
        return res.status(404).json({ error: "Ürün bulunamadı." });
      }

      await writeDB(db);
      res.json({ message: "Ürün başarıyla silindi." });
    } catch (err) {
      res.status(500).json({ error: "Ürün silinemedi." });
    }
  });

  // 5. Create a sale / Record a sale (Supports linked CRM customer transaction)
  app.post("/api/sales", async (req, res) => {
    try {
      const { items, customerId, amountPaid } = req.body; // array of { productId, quantity, selectedRollId, cutLength }
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Satışta en az bir ürün bulunmalıdır." });
      }

      const db = await readDB();
      const saleItems: any[] = [];
      let totalAmount = 0;

      // 1. Check stock and compile items list
      for (const item of items) {
        const product = db.products.find(p => p.id === item.productId);
        if (!product) {
          return res.status(404).json({ error: `Ürün bulunamadı: ID ${item.productId}` });
        }

        const qtyToDeduct = item.cutLength !== undefined ? Number(item.cutLength) : Number(item.quantity);

        if (item.selectedRollId && product.rolls && product.rolls.length > 0) {
          const roll = product.rolls.find(r => r.id === item.selectedRollId);
          if (!roll) {
            return res.status(404).json({ error: `Kumaş topu bulunamadı: ID ${item.selectedRollId}` });
          }
          if (roll.length < qtyToDeduct) {
            return res.status(400).json({ error: `Seçilen kumaş topunda yeterli miktar yok! Kalan: ${roll.length}m, istenen: ${qtyToDeduct}m` });
          }
        } else {
          if (product.stock < qtyToDeduct) {
            return res.status(400).json({ error: `Yetersiz stok! ${product.name} için kalan: ${product.stock}, istenen: ${qtyToDeduct}` });
          }
        }

        saleItems.push({
          productId: product.id,
          productName: product.name,
          quantity: Number(item.quantity),
          price: product.price,
          rollId: item.selectedRollId,
          rollNumber: item.selectedRollId && product.rolls ? product.rolls.find(r => r.id === item.selectedRollId)?.rollNumber : undefined,
          cutLength: item.cutLength !== undefined ? Number(item.cutLength) : undefined
        });
        totalAmount += product.price * Number(item.quantity);
      }

      // 2. Deduct stock
      for (const item of items) {
        const product = db.products.find(p => p.id === item.productId)!;
        const qtyToDeduct = item.cutLength !== undefined ? Number(item.cutLength) : Number(item.quantity);

        if (item.selectedRollId && product.rolls && product.rolls.length > 0) {
          const roll = product.rolls.find(r => r.id === item.selectedRollId)!;
          roll.length = Math.max(0, roll.length - qtyToDeduct);
          if (roll.length <= 0) {
            roll.status = 'sold';
          }
          // Recalculate product stock
          product.stock = product.rolls.reduce((sum, r) => sum + r.length, 0);
        } else {
          product.stock -= qtyToDeduct;
          // Synchronize rolls if present
          if (product.rolls && product.rolls.length > 0) {
            let remaining = qtyToDeduct;
            for (const r of product.rolls) {
              if (r.status === 'available' && r.length > 0) {
                const dec = Math.min(r.length, remaining);
                r.length = Math.max(0, r.length - dec);
                if (r.length <= 0) r.status = 'sold';
                remaining -= dec;
                if (remaining <= 0) break;
              }
            }
            product.stock = product.rolls.reduce((sum, r) => sum + r.length, 0);
          }
        }
      }

      const saleId = "S" + Math.random().toString(36).substring(2, 8).toUpperCase();

      // 3. Optional CRM Link
      if (customerId) {
        const customer = db.customers.find(c => c.id === customerId);
        if (customer) {
          const description = `Satış İşlemi (Fiş: #${saleId})`;
          const paidVal = amountPaid !== undefined ? Number(amountPaid) : totalAmount;

          // Record purchase
          customer.transactions.unshift({
            id: "T_S_" + saleId,
            type: "sale",
            amount: totalAmount,
            description,
            timestamp: new Date().toISOString()
          });
          customer.totalDebt += totalAmount;

          // Record payment if any
          if (paidVal > 0) {
            customer.transactions.unshift({
              id: "T_P_" + saleId,
              type: "payment",
              amount: paidVal,
              description: `Satış Ödemesi (Fiş: #${saleId})`,
              timestamp: new Date().toISOString()
            });
            customer.totalDebt = Math.max(0, customer.totalDebt - paidVal);
            customer.totalPaid += paidVal;
          }
        }
      }

      // 4. Record sale
      const newSale: Sale = {
        id: saleId,
        items: saleItems,
        totalAmount,
        timestamp: new Date().toISOString()
      };

      db.sales.push(newSale);
      await writeDB(db);

      res.status(201).json({ sale: newSale, products: db.products, customers: db.customers });
    } catch (err) {
      res.status(500).json({ error: "Satış kaydedilemedi." });
    }
  });

  // 6. Get sales history
  app.get("/api/sales", async (req, res) => {
    try {
      const db = await readDB();
      res.json(db.sales);
    } catch (err) {
      res.status(500).json({ error: "Satış geçmişi okunamadı." });
    }
  });

  // 7. Sub-unit extraction (Kısmi Stok / Paket İçi Ürün Eksiltme)
  app.post("/api/products/:id/extract-subunit", async (req, res) => {
    try {
      const { id } = req.params;
      const { amount } = req.body;
      const extractAmount = Number(amount || 1);

      const db = await readDB();
      const index = db.products.findIndex(p => p.id === id);
      if (index === -1) {
        return res.status(404).json({ error: "Ürün bulunamadı." });
      }

      const product = db.products[index];
      if (!product.isPackaged) {
        return res.status(400).json({ error: "Bu ürün paket içi kısmi eksiltmeye uygun değildir." });
      }

      let currentOpen = product.subUnitStock || 0;
      const packageUnits = product.packageUnitsCount || 1;
      const totalSubUnitsAvailable = currentOpen + (product.stock * packageUnits);

      if (totalSubUnitsAvailable < extractAmount) {
        return res.status(400).json({ 
          error: `Yetersiz stok! Toplam kalan kısmi miktar (${totalSubUnitsAvailable} ${product.packageUnitName || 'Adet'}) istenen miktardan (${extractAmount}) az.` 
        });
      }

      if (currentOpen >= extractAmount) {
        product.subUnitStock = currentOpen - extractAmount;
      } else {
        let needed = extractAmount - currentOpen;
        const packagesToOpen = Math.ceil(needed / packageUnits);
        product.stock -= packagesToOpen;
        product.subUnitStock = (packagesToOpen * packageUnits) - needed;
      }

      await writeDB(db);
      res.json({ product, products: db.products });
    } catch (err) {
      res.status(500).json({ error: "Kısmi stok eksiltme başarısız oldu." });
    }
  });

  // 8. Bulk products upload (Toplu Excel / CSV)
  app.post("/api/products/bulk", async (req, res) => {
    try {
      const { products } = req.body;
      if (!products || !Array.isArray(products)) {
        return res.status(400).json({ error: "Geçersiz toplu ürün listesi." });
      }

      const db = await readDB();
      const addedProducts: Product[] = [];

      for (const p of products) {
        const id = "P" + Math.random().toString(36).substring(2, 8).toUpperCase();
        const sku = p.sku ? String(p.sku).trim() : `PROD_${id}`;

        // Ensure unique SKU
        const exists = db.products.some(item => item.sku === sku) || addedProducts.some(item => item.sku === sku);
        if (exists) {
          continue; // skip duplicate SKU
        }

        const category = String(p.category || "Genel").trim();
        let productRolls: FabricRoll[] = [];
        const stockVal = Number(p.stock || 0);

        if (p.rolls && Array.isArray(p.rolls)) {
          productRolls = p.rolls.map((r: any, idx: number) => ({
            id: r.id || "R-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
            rollNumber: r.rollNumber || `Top #${idx + 1}`,
            length: Number(r.length || 0),
            initialLength: Number(r.initialLength || r.length || 0),
            status: r.status || 'available'
          }));
        } else if (category.toLowerCase().includes("kumaş") || category.toLowerCase().includes("kumas")) {
          let remaining = stockVal;
          let rollCounter = 1;
          while (remaining > 0) {
            const rollLen = Math.min(remaining, 50);
            productRolls.push({
              id: "R-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
              rollNumber: `Top #${rollCounter++}`,
              length: rollLen,
              initialLength: rollLen,
              status: 'available'
            });
            remaining -= rollLen;
          }
        }

        const newProd: Product = {
          id,
          name: String(p.name || "İsimsiz Ürün").trim(),
          sku,
          category,
          price: Number(p.price || 0),
          stock: productRolls.length > 0 ? productRolls.reduce((sum, r) => sum + r.length, 0) : stockVal,
          minStock: Number(p.minStock || 0),
          attributes: p.attributes || {},
          isPackaged: !!p.isPackaged,
          packageUnitsCount: p.packageUnitsCount ? Number(p.packageUnitsCount) : undefined,
          packageUnitName: p.packageUnitName ? String(p.packageUnitName).trim() : undefined,
          subUnitStock: p.subUnitStock ? Number(p.subUnitStock) : undefined,
          rolls: productRolls
        };
        db.products.push(newProd);
        addedProducts.push(newProd);
      }

      await writeDB(db);
      res.status(201).json({ count: addedProducts.length, products: db.products });
    } catch (err) {
      res.status(500).json({ error: "Toplu ürün yüklemesi başarısız oldu." });
    }
  });

  // 9. Get all CRM Customers
  app.get("/api/customers", async (req, res) => {
    try {
      const db = await readDB();
      res.json(db.customers || []);
    } catch (err) {
      res.status(500).json({ error: "Müşteri listesi okunamadı." });
    }
  });

  // 10. Add CRM Customer
  app.post("/api/customers", async (req, res) => {
    try {
      const { name, phone, instagram, notes } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Müşteri adı zorunludur." });
      }

      const db = await readDB();
      const id = "C" + Math.random().toString(36).substring(2, 8).toUpperCase();
      const newCustomer: Customer = {
        id,
        name: String(name).trim(),
        phone: String(phone || "").trim(),
        instagram: String(instagram || "").trim(),
        totalDebt: 0,
        totalPaid: 0,
        notes: String(notes || "").trim(),
        transactions: []
      };

      db.customers.push(newCustomer);
      await writeDB(db);
      res.status(201).json({ customer: newCustomer, customers: db.customers });
    } catch (err) {
      res.status(500).json({ error: "Müşteri eklenemedi." });
    }
  });

  // 11. Update CRM Customer details
  app.put("/api/customers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { name, phone, instagram, notes } = req.body;

      const db = await readDB();
      const index = db.customers.findIndex(c => c.id === id);
      if (index === -1) {
        return res.status(404).json({ error: "Müşteri bulunamadı." });
      }

      const current = db.customers[index];
      db.customers[index] = {
        ...current,
        name: name !== undefined ? String(name).trim() : current.name,
        phone: phone !== undefined ? String(phone || "").trim() : current.phone,
        instagram: instagram !== undefined ? String(instagram || "").trim() : current.instagram,
        notes: notes !== undefined ? String(notes || "").trim() : current.notes
      };

      await writeDB(db);
      res.json({ customer: db.customers[index], customers: db.customers });
    } catch (err) {
      res.status(500).json({ error: "Müşteri güncellenemedi." });
    }
  });

  // 12. Delete CRM Customer
  app.delete("/api/customers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const db = await readDB();
      db.customers = db.customers.filter(c => c.id !== id);
      await writeDB(db);
      res.json({ message: "Müşteri silindi.", customers: db.customers });
    } catch (err) {
      res.status(500).json({ error: "Müşteri silinemedi." });
    }
  });

  // 13. Record custom transaction/payment on Customer Ledger
  app.post("/api/customers/:id/transactions", async (req, res) => {
    try {
      const { id } = req.params;
      const { type, amount, description } = req.body; // type: 'sale' or 'payment'

      if (!type || amount === undefined || Number(amount) <= 0) {
        return res.status(400).json({ error: "Geçersiz işlem tipi veya miktarı." });
      }

      const db = await readDB();
      const index = db.customers.findIndex(c => c.id === id);
      if (index === -1) {
        return res.status(404).json({ error: "Müşteri bulunamadı." });
      }

      const customer = db.customers[index];
      const val = Number(amount);
      const transId = "T" + Math.random().toString(36).substring(2, 8).toUpperCase();

      const newTransaction: CustomerTransaction = {
        id: transId,
        type: type,
        amount: val,
        description: String(description || (type === "payment" ? "Tahsilat Ödemesi" : "Borç Kaydı")).trim(),
        timestamp: new Date().toISOString()
      };

      if (type === "payment") {
        customer.totalDebt = Math.max(0, customer.totalDebt - val);
        customer.totalPaid += val;
      } else if (type === "sale") {
        customer.totalDebt += val;
      }

      customer.transactions.unshift(newTransaction);
      await writeDB(db);
      res.json({ customer, customers: db.customers });
    } catch (err) {
      res.status(500).json({ error: "İşlem kaydedilemedi." });
    }
  });

  // 14. Get Sector Settings
  app.get("/api/sector", async (req, res) => {
    try {
      const db = await readDB();
      res.json(db.sectorSettings || { activeSector: "genel", customFields: [] });
    } catch (err) {
      res.status(500).json({ error: "Sektör ayarları okunamadı." });
    }
  });

  // 15. Update Sector Settings
  app.post("/api/sector", async (req, res) => {
    try {
      const { activeSector, customFields } = req.body;
      if (!activeSector) {
        return res.status(400).json({ error: "Aktif sektör belirtilmelidir." });
      }

      const db = await readDB();
      db.sectorSettings = {
        activeSector: String(activeSector).trim(),
        customFields: Array.isArray(customFields) ? customFields : []
      };

      await writeDB(db);
      res.json(db.sectorSettings);
    } catch (err) {
      res.status(500).json({ error: "Sektör ayarları kaydedilemedi." });
    }
  });

  // 16. Get Company Info
  app.get("/api/company", async (req, res) => {
    try {
      const db = await readDB();
      res.json(db.companyInfo || { name: "", address: "", phone: "", email: "", taxOffice: "", taxNumber: "", logo: "" });
    } catch (err) {
      res.status(500).json({ error: "Firma bilgileri okunamadı." });
    }
  });

  // 17. Update Company Info
  app.post("/api/company", async (req, res) => {
    try {
      const { name, address, phone, email, taxOffice, taxNumber, logo } = req.body;
      const db = await readDB();
      db.companyInfo = {
        name: String(name || "").trim(),
        address: String(address || "").trim(),
        phone: String(phone || "").trim(),
        email: String(email || "").trim(),
        taxOffice: String(taxOffice || "").trim(),
        taxNumber: String(taxNumber || "").trim(),
        logo: String(logo || "")
      };
      await writeDB(db);
      res.json(db.companyInfo);
    } catch (err) {
      res.status(500).json({ error: "Firma bilgileri kaydedilemedi." });
    }
  });

  // 18. Get Orders & Waybills
  app.get("/api/orders", async (req, res) => {
    try {
      const db = await readDB();
      res.json(db.orders || []);
    } catch (err) {
      res.status(500).json({ error: "Siparişler okunamadı." });
    }
  });

  // 19. Create Order & Waybill
  app.post("/api/orders", async (req, res) => {
    try {
      const { customerId, customerName, customerDetails, items, totalAmount, amountPaid, status, waybillNo, waybillDate, shipDate, notes } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Siparişte en az bir ürün bulunmalıdır." });
      }

      const db = await readDB();
      const orderItems: any[] = [];
      let calculatedTotal = 0;

      // 1. Check stock
      for (const item of items) {
        const product = db.products.find(p => p.id === item.productId);
        if (!product) {
          return res.status(404).json({ error: `Ürün bulunamadı: ID ${item.productId}` });
        }

        const qty = Number(item.quantity);
        const rollId = item.rollId;
        const cutLen = item.cutLength !== undefined ? Number(item.cutLength) : undefined;
        const qtyToDeduct = cutLen !== undefined ? cutLen : qty;

        if (rollId && product.rolls) {
          const roll = product.rolls.find(r => r.id === rollId);
          if (!roll) {
            return res.status(404).json({ error: `Kumaş topu bulunamadı: ID ${rollId}` });
          }
          if (roll.length < qtyToDeduct) {
            return res.status(400).json({ error: `Seçilen kumaş topunda (${roll.rollNumber}) yeterli miktar yok! Kalan: ${roll.length}m` });
          }
        } else {
          if (product.stock < qtyToDeduct) {
            return res.status(400).json({ error: `Yetersiz stok! ${product.name} için kalan: ${product.stock}m` });
          }
        }

        orderItems.push({
          productId: product.id,
          productName: product.name,
          quantity: qty,
          price: Number(item.price || product.price),
          rollId: rollId,
          rollNumber: rollId && product.rolls ? product.rolls.find(r => r.id === rollId)?.rollNumber : undefined,
          cutLength: cutLen
        });
        calculatedTotal += Number(item.price || product.price) * qty;
      }

      // 2. Deduct stock
      for (const item of orderItems) {
        const product = db.products.find(p => p.id === item.productId)!;
        const qtyToDeduct = item.cutLength !== undefined ? item.cutLength : item.quantity;

        if (item.rollId && product.rolls) {
          const roll = product.rolls.find(r => r.id === item.rollId)!;
          roll.length = Math.max(0, roll.length - qtyToDeduct);
          if (roll.length <= 0) roll.status = 'sold';
          product.stock = product.rolls.reduce((sum, r) => sum + r.length, 0);
        } else {
          product.stock = Math.max(0, product.stock - qtyToDeduct);
          if (product.rolls && product.rolls.length > 0) {
            let remaining = qtyToDeduct;
            for (const r of product.rolls) {
              if (r.status === 'available' && r.length > 0) {
                const dec = Math.min(r.length, remaining);
                r.length = Math.max(0, r.length - dec);
                if (r.length <= 0) r.status = 'sold';
                remaining -= dec;
                if (remaining <= 0) break;
              }
            }
            product.stock = product.rolls.reduce((sum, r) => sum + r.length, 0);
          }
        }
      }

      const orderId = "ORD" + Math.random().toString(36).substring(2, 8).toUpperCase();
      const orderNo = `SIP-${Math.floor(1000 + Math.random() * 9000)}`;

      const newOrder: Order = {
        id: orderId,
        orderNo,
        customerId,
        customerName,
        customerDetails,
        items: orderItems,
        totalAmount: Number(totalAmount || calculatedTotal),
        amountPaid: Number(amountPaid || 0),
        status: status || 'Sipariş Alındı',
        orderDate: new Date().toISOString(),
        waybillNo,
        waybillDate,
        shipDate,
        notes
      };

      // 3. Customer Ledger Link
      if (customerId) {
        const customer = db.customers.find(c => c.id === customerId);
        if (customer) {
          customer.transactions.unshift({
            id: "T_ORD_" + orderId,
            type: "sale",
            amount: newOrder.totalAmount,
            description: `Sipariş Alımı (No: #${newOrder.orderNo})`,
            timestamp: new Date().toISOString()
          });
          customer.totalDebt += newOrder.totalAmount;

          const paid = Number(amountPaid || 0);
          if (paid > 0) {
            customer.transactions.unshift({
              id: "T_ORD_PAY_" + orderId,
              type: "payment",
              amount: paid,
              description: `Sipariş Ödemesi (No: #${newOrder.orderNo})`,
              timestamp: new Date().toISOString()
            });
            customer.totalDebt = Math.max(0, customer.totalDebt - paid);
            customer.totalPaid += paid;
          }
        }
      }

      if (!db.orders) db.orders = [];
      db.orders.unshift(newOrder);

      await writeDB(db);
      res.status(201).json({ order: newOrder, products: db.products, customers: db.customers, orders: db.orders });
    } catch (err) {
      res.status(500).json({ error: "Sipariş oluşturulamadı." });
    }
  });

  // 20. Update/Edit Order & Waybill
  app.put("/api/orders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { customerDetails, status, waybillNo, waybillDate, shipDate, notes, amountPaid, totalAmount } = req.body;

      const db = await readDB();
      const index = db.orders?.findIndex(o => o.id === id);
      if (index === undefined || index === -1) {
        return res.status(404).json({ error: "Sipariş bulunamadı." });
      }

      const currentOrder = db.orders![index];

      // Update simple properties
      if (customerDetails) currentOrder.customerDetails = customerDetails;
      if (status) currentOrder.status = status;
      if (waybillNo !== undefined) currentOrder.waybillNo = waybillNo;
      if (waybillDate !== undefined) currentOrder.waybillDate = waybillDate;
      if (shipDate !== undefined) currentOrder.shipDate = shipDate;
      if (notes !== undefined) currentOrder.notes = notes;

      // Update payment if specified
      if (amountPaid !== undefined) {
        const diff = Number(amountPaid) - currentOrder.amountPaid;
        currentOrder.amountPaid = Number(amountPaid);

        // Update customer debt if linked
        if (currentOrder.customerId && diff !== 0) {
          const customer = db.customers.find(c => c.id === currentOrder.customerId);
          if (customer) {
            customer.totalDebt = Math.max(0, customer.totalDebt - diff);
            customer.totalPaid += diff;
            customer.transactions.unshift({
              id: "T_ORD_PAY_UPD_" + Math.random().toString(36).substring(2, 6),
              type: "payment",
              amount: Math.abs(diff),
              description: diff > 0 ? `Sipariş Ek Ödemesi (No: #${currentOrder.orderNo})` : `Sipariş Ödemesi Geri Alımı (No: #${currentOrder.orderNo})`,
              timestamp: new Date().toISOString()
            });
          }
        }
      }

      if (totalAmount !== undefined) {
        currentOrder.totalAmount = Number(totalAmount);
      }

      await writeDB(db);
      res.json({ order: currentOrder, orders: db.orders, customers: db.customers });
    } catch (err) {
      res.status(500).json({ error: "Sipariş güncellenemedi." });
    }
  });

  // 21. Delete Order & Waybill
  app.delete("/api/orders/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const db = await readDB();
      if (!db.orders) db.orders = [];
      db.orders = db.orders.filter(o => o.id !== id);
      await writeDB(db);
      res.json({ message: "Sipariş başarıyla silindi.", orders: db.orders });
    } catch (err) {
      res.status(500).json({ error: "Sipariş silinemedi." });
    }
  });

  // Vite development integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
