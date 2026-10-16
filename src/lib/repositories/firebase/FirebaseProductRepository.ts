import { ProductRepository, BarcodeConflictResult, ReplenishStockParams } from "../interfaces";
import { Product } from "../../../types";
import { db, auth } from "../../firebase";
import { 
  Firestore,
  collection, 
  getDocs, 
  getDoc, 
  doc, 
  addDoc, 
  updateDoc, 
  writeBatch,
  query, 
  where,
  limit
} from "firebase/firestore";
import { memoryCache } from "../../cache";
import { getLocal, setLocal, SEED_PRODUCTS, logAuditEvent, roundQty, round2 } from "./helpers";
import { FirebaseUserRepository } from "./FirebaseUserRepository";
import { FirebaseSubscriptionRepository } from "./FirebaseSubscriptionRepository";
import { getPlanConfig, isSubscriptionActive } from "../../subscriptionConfig";
import { syncSectorMetadata } from "../../sectorConfig";
import { assertAuthenticated, isDemoUser, getAuthenticatedUid } from "../../authGuard";

export class FirebaseProductRepository implements ProductRepository {
  private userRepo: FirebaseUserRepository;
  private subRepo: FirebaseSubscriptionRepository;
  private db: Firestore;

  constructor(userRepo?: FirebaseUserRepository, subRepo?: FirebaseSubscriptionRepository, customDb?: Firestore) {
    this.userRepo = userRepo || new FirebaseUserRepository(customDb);
    this.subRepo = subRepo || new FirebaseSubscriptionRepository(this.userRepo, customDb);
    this.db = customDb || db;
  }

  async getAll(uid: string, includeArchived = false): Promise<Product[]> {
    const validUid = assertAuthenticated(uid, "ProductRepository.getAll");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const tenantId = context.tenantId;

    const cacheKey = `products_${tenantId}`;
    const cached = memoryCache.get<Product[]>(cacheKey, 45000);
    if (cached) {
      return includeArchived ? cached : cached.filter(p => p.isActive !== false);
    }

    if (isDemoUser(validUid)) {
      const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      memoryCache.set(cacheKey, list);
      return includeArchived ? list : list.filter(p => p.isActive !== false);
    }

    try {
      const q = query(collection(this.db, "products"), where("tenantId", "==", tenantId));
      const snapshot = await getDocs(q);
      const products: Product[] = [];
      snapshot.forEach((docSnap) => {
        products.push({ id: docSnap.id, ...docSnap.data() } as Product);
      });
      memoryCache.set(cacheKey, products);
      return includeArchived ? products : products.filter(p => p.isActive !== false);
    } catch (err) {
      console.error("FirebaseProductRepository getAll error:", err);
      throw err;
    }
  }

  async getById(id: string, uidParam?: string): Promise<Product | null> {
    const validUid = uidParam
      ? assertAuthenticated(uidParam, "ProductRepository.getById")
      : getAuthenticatedUid("ProductRepository.getById");

    if (isDemoUser(validUid)) {
      const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      return list.find(p => p.id === id) || null;
    }

    try {
      const docSnap = await getDoc(doc(this.db, "products", id));
      if (!docSnap.exists()) return null;
      return { id: docSnap.id, ...docSnap.data() } as Product;
    } catch (err) {
      console.error("FirebaseProductRepository getById error:", err);
      return null;
    }
  }

  async getByBarcode(barcode: string, uidParam?: string): Promise<Product | null> {
    const validUid = uidParam
      ? assertAuthenticated(uidParam, "ProductRepository.getByBarcode")
      : getAuthenticatedUid("ProductRepository.getByBarcode");

    const clean = barcode?.trim();
    if (!clean) return null;

    const context = await this.userRepo.getOrCreateContext(validUid);
    const tenantId = context.tenantId;

    if (isDemoUser(validUid)) {
      const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      return list.find(p => p.isActive !== false && (
        (p.barcode && p.barcode.trim().toLowerCase() === clean.toLowerCase()) || 
        (p.sku && p.sku.trim().toLowerCase() === clean.toLowerCase()) || 
        p.id.toLowerCase() === clean.toLowerCase()
      )) || null;
    }

    try {
      // 1. Look up by exact manufacturer barcode
      const qBarcode = query(
        collection(this.db, "products"),
        where("tenantId", "==", tenantId),
        where("barcode", "==", clean),
        limit(1)
      );
      const snapBarcode = await getDocs(qBarcode);
      if (!snapBarcode.empty) {
        const docSnap = snapBarcode.docs[0];
        const prod = { id: docSnap.id, ...docSnap.data() } as Product;
        if (prod.isActive !== false) return prod;
      }

      // 2. Fall back to internal SKU match
      const qSku = query(
        collection(this.db, "products"),
        where("tenantId", "==", tenantId),
        where("sku", "==", clean),
        limit(1)
      );
      const snapSku = await getDocs(qSku);
      if (!snapSku.empty) {
        const docSnap = snapSku.docs[0];
        const prod = { id: docSnap.id, ...docSnap.data() } as Product;
        if (prod.isActive !== false) return prod;
      }

      return null;
    } catch (err) {
      console.error("FirebaseProductRepository getByBarcode error:", err);
      return null;
    }
  }

  async checkBarcodeConflict(barcode: string, excludeProductId?: string, uidParam?: string): Promise<BarcodeConflictResult> {
    const clean = barcode?.trim();
    if (!clean) {
      return { hasConflict: false };
    }

    const found = await this.getByBarcode(clean, uidParam);
    if (found && found.id !== excludeProductId) {
      return {
        hasConflict: true,
        conflictingProduct: found
      };
    }
    return { hasConflict: false };
  }

  async replenishStock(productId: string, params: ReplenishStockParams, uidParam?: string): Promise<Product> {
    const validUid = uidParam
      ? assertAuthenticated(uidParam, "ProductRepository.replenishStock")
      : getAuthenticatedUid("ProductRepository.replenishStock");

    const qtyToAdd = roundQty(Number(params.quantityToAdd));
    if (isNaN(qtyToAdd) || qtyToAdd <= 0) {
      throw new Error("Geçerli bir stok artış miktarı giriniz (0'dan büyük olmalıdır).");
    }

    const context = await this.userRepo.getOrCreateContext(validUid);
    const product = await this.getById(productId, validUid);
    if (!product) {
      throw new Error("Stok artırılacak ürün bulunamadı.");
    }
    if (product.tenantId && product.tenantId !== context.tenantId) {
      throw new Error("Yetkilendirme Hatası: Bu ürün başka bir firmaya aittir.");
    }

    const previousStock = roundQty(Number(product.stock || 0));
    const newStock = roundQty(previousStock + qtyToAdd);
    const nowIso = new Date().toISOString();

    const updates: Partial<Product> = {
      stock: newStock
    };
    if (params.costPrice !== undefined && !isNaN(Number(params.costPrice)) && Number(params.costPrice) >= 0) {
      updates.costPrice = round2(Number(params.costPrice));
    }

    memoryCache.invalidate("products_");

    if (isDemoUser(validUid)) {
      const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const updatedList = list.map(p => p.id === productId ? { ...p, ...updates } : p);
      setLocal("stokpro_demo_products", updatedList);

      const movements = getLocal<any[]>("stokpro_demo_stock_movements", []);
      movements.unshift({
        id: "MOV_" + Math.random().toString(36).substring(2, 9),
        tenantId: context.tenantId,
        productId,
        productName: product.name,
        type: "in",
        quantity: qtyToAdd,
        previousStock,
        newStock,
        unit: product.unit || "Adet",
        referenceType: "purchase",
        timestamp: nowIso,
        userId: validUid,
        notes: params.note || "Hızlı Stok Girişi"
      });
      setLocal("stokpro_demo_stock_movements", movements);

      await logAuditEvent(validUid, {
        action: "STOCK_IN",
        entityType: "product",
        entityId: productId,
        companyId: context.tenantId,
        details: {
          productName: product.name,
          quantityAdded: qtyToAdd,
          previousStock,
          newStock,
          costPrice: updates.costPrice,
          note: params.note
        }
      });

      return { ...product, ...updates };
    }

    try {
      const docRef = doc(this.db, "products", productId);
      await updateDoc(docRef, updates);

      // Append immutable stock movement audit record
      await addDoc(collection(this.db, "stock_movements"), {
        tenantId: context.tenantId,
        productId,
        productName: product.name,
        type: "in",
        quantity: qtyToAdd,
        previousStock,
        newStock,
        unit: product.unit || "Adet",
        referenceType: "purchase",
        timestamp: nowIso,
        userId: validUid,
        notes: params.note || "Hızlı Stok Girişi"
      });

      await logAuditEvent(validUid, {
        action: "STOCK_IN",
        entityType: "product",
        entityId: productId,
        companyId: context.tenantId,
        details: {
          productName: product.name,
          quantityAdded: qtyToAdd,
          previousStock,
          newStock,
          costPrice: updates.costPrice,
          note: params.note
        }
      }, this.db);

      return { ...product, ...updates };
    } catch (err) {
      console.error("FirebaseProductRepository replenishStock error:", err);
      throw err;
    }
  }

  async create(uid: string, product: Omit<Product, "id">): Promise<Product> {
    const validUid = assertAuthenticated(uid, "ProductRepository.create");
    const context = await this.userRepo.getOrCreateContext(validUid);

    // SaaS Entitlement Quota Check
    const subscription = await this.subRepo.getByTenantId(context.tenantId);
    const plan = getPlanConfig(subscription.planId);
    if (!isSubscriptionActive(subscription)) {
      throw new Error("Abonelik veya deneme süreniz sona ermiştir. Yeni ürün eklemek için lütfen bir plan seçin.");
    }
    if (plan.maxProducts !== -1) {
      const existingProducts = await this.getAll(validUid, false);
      if (existingProducts.length >= plan.maxProducts) {
        throw new Error(`Mevcut planınız (${plan.name}) maksimum ${plan.maxProducts} ürün eklemenize izin verir. Lütfen paketinizi yükseltin.`);
      }
    }

    // Barcode duplicate conflict check within tenant
    if (product.barcode && product.barcode.trim()) {
      const cleanBarcode = product.barcode.trim();
      const conflict = await this.checkBarcodeConflict(cleanBarcode, undefined, validUid);
      if (conflict.hasConflict && conflict.conflictingProduct) {
        throw new Error(
          `Bu barkod (${cleanBarcode}) zaten '${conflict.conflictingProduct.name}' ürününde kayıtlı! Mükerrer ürün oluşturulamaz. Var olan ürünün stoğunu artırabilirsiniz.`
        );
      }
    }

    const autoSku = product.sku && product.sku.trim() 
      ? product.sku.trim() 
      : ("PRD-" + Math.random().toString(36).substring(2, 8).toUpperCase());

    const synced = syncSectorMetadata({
      metadata: product.metadata,
      attributes: product.attributes
    });

    const initialProduct: Omit<Product, "id"> = {
      ...product,
      sku: autoSku,
      barcode: product.barcode?.trim() || undefined,
      metadata: synced.metadata,
      attributes: synced.attributes,
      unit: product.unit || "Adet",
      tenantId: context.tenantId,
      isActive: true
    };

    if (isDemoUser(validUid)) {
      const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const newId = "P_" + Math.random().toString(36).substring(2, 9).toUpperCase();
      const newProduct = { id: newId, ...initialProduct } as Product;
      list.push(newProduct);
      setLocal("stokpro_demo_products", list);
      memoryCache.invalidate("products_");

      await logAuditEvent(validUid, {
        action: "PRODUCT_CREATED",
        entityType: "product",
        entityId: newId,
        companyId: context.tenantId,
        details: { name: product.name, sku: autoSku, barcode: product.barcode, stock: product.stock, price: product.price }
      });

      return newProduct;
    }

    try {
      const docRef = await addDoc(collection(this.db, "products"), {
        ...initialProduct,
        userId: validUid,
        tenantId: context.tenantId,
        createdAt: new Date().toISOString()
      });

      const created = { id: docRef.id, ...initialProduct, tenantId: context.tenantId } as Product;
      memoryCache.invalidate("products_");

      await logAuditEvent(validUid, {
        action: "PRODUCT_CREATED",
        entityType: "product",
        entityId: docRef.id,
        companyId: context.tenantId,
        details: { name: product.name, sku: product.sku, stock: product.stock, price: product.price }
      }, this.db);

      return created;
    } catch (err) {
      console.error("FirebaseProductRepository create error:", err);
      throw err;
    }
  }

  async batchCreate(
    uid: string, 
    products: Omit<Product, "id">[], 
    onProgress?: (processed: number, total: number) => void
  ): Promise<Product[]> {
    const validUid = assertAuthenticated(uid, "ProductRepository.batchCreate");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const tenantId = context.tenantId;

    if (!products || products.length === 0) return [];

    // SaaS Entitlement Quota Check
    const subscription = await this.subRepo.getByTenantId(tenantId);
    const plan = getPlanConfig(subscription.planId);
    if (!isSubscriptionActive(subscription)) {
      throw new Error("Abonelik veya deneme süreniz sona ermiştir. Yeni ürün eklemek için lütfen bir plan seçin.");
    }
    if (plan.maxProducts !== -1) {
      const existingProducts = await this.getAll(validUid, false);
      if (existingProducts.length + products.length > plan.maxProducts) {
        throw new Error(
          `Mevcut planınız (${plan.name}) maksimum ${plan.maxProducts} ürün eklemenize izin verir. ` +
          `Şu anda ${existingProducts.length} ürününüz var, ${products.length} yeni ürün limitinizi aşıyor.`
        );
      }
    }

    const createdList: Product[] = [];
    const nowIso = new Date().toISOString();

    if (isDemoUser(validUid)) {
      const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      products.forEach((p, idx) => {
        const synced = syncSectorMetadata({ metadata: p.metadata, attributes: p.attributes });
        const newId = "P_" + Math.random().toString(36).substring(2, 9).toUpperCase() + "_" + idx;
        const newProduct: Product = {
          ...p,
          id: newId,
          metadata: synced.metadata,
          attributes: synced.attributes,
          unit: p.unit || "Adet",
          tenantId,
          isActive: true
        };
        list.push(newProduct);
        createdList.push(newProduct);
      });
      setLocal("stokpro_demo_products", list);
      memoryCache.invalidate("products_");

      await logAuditEvent(validUid, {
        action: "BATCH_PRODUCTS_CREATED",
        entityType: "product",
        entityId: `batch_${Date.now()}`,
        companyId: tenantId,
        details: { count: createdList.length, demo: true }
      });

      if (onProgress) onProgress(createdList.length, products.length);
      return createdList;
    }

    // Real Firestore Batching in chunks of 400 (safe margin under 500 limit)
    const BATCH_LIMIT = 400;
    for (let i = 0; i < products.length; i += BATCH_LIMIT) {
      const chunk = products.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(this.db);

      chunk.forEach((p) => {
        const synced = syncSectorMetadata({ metadata: p.metadata, attributes: p.attributes });
        const newDocRef = doc(collection(this.db, "products"));
        const docPayload = {
          ...p,
          metadata: synced.metadata,
          attributes: synced.attributes,
          unit: p.unit || "Adet",
          tenantId,
          userId: validUid,
          isActive: true,
          createdAt: nowIso
        };
        batch.set(newDocRef, docPayload);
        createdList.push({ id: newDocRef.id, ...docPayload } as Product);
      });

      await batch.commit();

      if (onProgress) {
        onProgress(createdList.length, products.length);
      }
    }

    memoryCache.invalidate("products_");

    await logAuditEvent(validUid, {
      action: "BATCH_PRODUCTS_CREATED",
      entityType: "product",
      entityId: `batch_${Date.now()}`,
      companyId: tenantId,
      details: { count: createdList.length }
    }, this.db);

    return createdList;
  }

  async update(productId: string, updates: Partial<Product>, uidParam?: string): Promise<void> {
    const validUid = uidParam 
      ? assertAuthenticated(uidParam, "ProductRepository.update") 
      : getAuthenticatedUid("ProductRepository.update");

    memoryCache.invalidate("products_");

    let normalizedUpdates = { ...updates };
    if (updates.metadata || updates.attributes) {
      const synced = syncSectorMetadata({
        metadata: updates.metadata,
        attributes: updates.attributes
      });
      normalizedUpdates.metadata = synced.metadata;
      normalizedUpdates.attributes = synced.attributes;
    }

    if (isDemoUser(validUid)) {
      const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const prev = list.find(p => p.id === productId);
      const updated = list.map(p => p.id === productId ? { ...p, ...normalizedUpdates } : p);
      setLocal("stokpro_demo_products", updated);

      await logAuditEvent(validUid, {
        action: "PRODUCT_UPDATED",
        entityType: "product",
        entityId: productId,
        details: {
          summary: updates.stock !== undefined ? `Stok güncellendi: ${prev?.stock} -> ${updates.stock}` : "Ürün bilgileri güncellendi",
          previousStock: prev?.stock,
          newStock: updates.stock
        }
      });
      return;
    }

    try {
      const docRef = doc(this.db, "products", productId);
      await updateDoc(docRef, normalizedUpdates);

      await logAuditEvent(validUid, {
        action: "PRODUCT_UPDATED",
        entityType: "product",
        entityId: productId,
        details: { summary: "Ürün bilgileri güncellendi (Firebase)" }
      }, this.db);
    } catch (err) {
      console.error("FirebaseProductRepository update error:", err);
      throw err;
    }
  }

  async delete(productId: string, uidParam?: string): Promise<void> {
    const validUid = uidParam 
      ? assertAuthenticated(uidParam, "ProductRepository.delete") 
      : getAuthenticatedUid("ProductRepository.delete");

    const context = await this.userRepo.getOrCreateContext(validUid);
    if (context.role !== "owner" && context.role !== "admin") {
      throw new Error("Yetkilendirme Hatası: Ürün silme ve arşivleme yetkisi yalnızca 'owner' veya 'admin' rollerine aittir.");
    }

    memoryCache.invalidate("products_");

    if (isDemoUser(validUid)) {
      const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const updated = list.map(p => p.id === productId ? { ...p, isActive: false, deletedAt: new Date().toISOString() } : p);
      setLocal("stokpro_demo_products", updated);

      await logAuditEvent(validUid, {
        action: "PRODUCT_DELETED",
        entityType: "product",
        entityId: productId,
        details: { summary: "Ürün silindi (Arşive alındı - Soft Delete)" }
      });
      return;
    }

    try {
      const docRef = doc(this.db, "products", productId);
      await updateDoc(docRef, {
        isActive: false,
        deletedAt: new Date().toISOString()
      });

      await logAuditEvent(validUid, {
        action: "PRODUCT_DELETED",
        entityType: "product",
        entityId: productId,
        details: { summary: "Ürün silindi (Arşive alındı - Soft Delete)" }
      }, this.db);
    } catch (err) {
      console.error("FirebaseProductRepository delete error:", err);
      throw err;
    }
  }

  async restore(productId: string, uidParam?: string): Promise<void> {
    const validUid = uidParam 
      ? assertAuthenticated(uidParam, "ProductRepository.restore") 
      : getAuthenticatedUid("ProductRepository.restore");

    const context = await this.userRepo.getOrCreateContext(validUid);
    if (context.role !== "owner" && context.role !== "admin") {
      throw new Error("Yetkilendirme Hatası: Ürün geri yükleme yetkisi yalnızca 'owner' veya 'admin' rollerine aittir.");
    }

    memoryCache.invalidate("products_");

    if (isDemoUser(validUid)) {
      const list = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const updated = list.map(p => p.id === productId ? { ...p, isActive: true, deletedAt: undefined } : p);
      setLocal("stokpro_demo_products", updated);

      await logAuditEvent(validUid, {
        action: "PRODUCT_RESTORED",
        entityType: "product",
        entityId: productId,
        details: { summary: "Ürün arşivden geri yüklendi" }
      });
      return;
    }

    try {
      const docRef = doc(this.db, "products", productId);
      await updateDoc(docRef, {
        isActive: true,
        deletedAt: null
      });

      await logAuditEvent(validUid, {
        action: "PRODUCT_RESTORED",
        entityType: "product",
        entityId: productId,
        details: { summary: "Ürün arşivden geri yüklendi" }
      }, this.db);
    } catch (err) {
      console.error("FirebaseProductRepository restore error:", err);
      throw err;
    }
  }
}
