import { SalesRepository, ProcessSaleParams, CancelSaleParams } from "../interfaces";
import { Sale, Product, Customer, FabricRoll, StockMovement, Payment } from "../../../types";
import { db } from "../../firebase";
import { 
  Firestore,
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  runTransaction,
  onSnapshot 
} from "firebase/firestore";
import { getLocal, setLocal, SEED_SALES, SEED_PRODUCTS, SEED_CUSTOMERS, round2, roundQty, logAuditEvent } from "./helpers";
import { FirebaseUserRepository } from "./FirebaseUserRepository";
import { memoryCache } from "../../cache";
import { assertAuthenticated, isDemoUser, getAuthenticatedUid } from "../../authGuard";
import { getRollStockBalance, shouldShowRolls } from "../../sectorConfig";

export function normalizePaymentMethod(method?: string): Payment["paymentMethod"] {
  const pmStr = (method || "").toLowerCase().trim();
  if (pmStr.includes("kart") || pmStr === "kredi_karti") {
    return "kredi_karti";
  }
  if (pmStr.includes("havale") || pmStr.includes("eft")) {
    return "havale";
  }
  if (pmStr.includes("cek") || pmStr.includes("çek")) {
    return "cek";
  }
  if (pmStr === "diger" || pmStr === "diğer") {
    return "diger";
  }
  return "nakit";
}

export class FirebaseSalesRepository implements SalesRepository {
  private userRepo: FirebaseUserRepository;
  private db: Firestore;

  constructor(userRepo?: FirebaseUserRepository, customDb?: Firestore) {
    this.userRepo = userRepo || new FirebaseUserRepository(customDb);
    this.db = customDb || db;
  }

  async getAll(uid: string): Promise<Sale[]> {
    const validUid = assertAuthenticated(uid, "SalesRepository.getAll");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const tenantId = context.tenantId;

    const cacheKey = `sales_${tenantId}`;
    const cached = memoryCache.get<Sale[]>(cacheKey, 45000);
    if (cached) {
      return cached;
    }

    if (isDemoUser(validUid)) {
      const list = getLocal<Sale[]>("stokpro_demo_sales", SEED_SALES);
      const sorted = list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      memoryCache.set(cacheKey, sorted);
      return sorted;
    }

    try {
      const q = query(
        collection(this.db, "sales"),
        where("tenantId", "==", tenantId)
      );
      const snapshot = await getDocs(q);
      const sales: Sale[] = [];
      snapshot.forEach((docSnap) => {
        sales.push({ id: docSnap.id, ...docSnap.data() } as Sale);
      });
      const sorted = sales.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      memoryCache.set(cacheKey, sorted);
      return sorted;
    } catch (err) {
      console.error("FirebaseSalesRepository getAll error:", err);
      throw err;
    }
  }


  /**
   * Reserves one catalog fabric group across its underlying product documents.
   * Every document is updated atomically; the reservation stores exact top allocations.
   */
  private async reserveGroupedFabricStock(
    uid: string,
    representativeId: string,
    quantity: number,
    reservationId: string,
    groupProductIds: string[]
  ): Promise<Product> {
    const validUid = assertAuthenticated(uid, "SalesRepository.reserveGroupedFabricStock");
    const qty = roundQty(Number(quantity));
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Rezerve edilecek miktar sıfırdan büyük olmalıdır.");
    const productIds = Array.from(new Set([representativeId, ...groupProductIds])).filter(Boolean);
    if (productIds.length < 2 || productIds.length > 100) {
      throw new Error("Kumaş ürün grubu için geçersiz top kayıtları.");
    }
    const context = await this.userRepo.getOrCreateContext(validUid);
    const now = Date.now();
    const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();

    const releaseOldAllocations = (working: Map<string, Product>, reservation: any) => {
      const allocations = Array.isArray(reservation?.productAllocations)
        ? reservation.productAllocations
        : [{ productId: reservation?.productId, quantity: reservation?.quantity, rollAllocations: reservation?.rollAllocations || [] }];
      for (const allocation of allocations) {
        const product = working.get(allocation.productId);
        if (!product) continue;
        product.reservedStock = roundQty(Math.max(0, Number(product.reservedStock || 0) - Number(allocation.quantity || 0)));
        for (const rollAllocation of allocation.rollAllocations || []) {
          const roll = product.rolls?.find((item) => item.id === rollAllocation.rollId);
          if (roll) roll.reservedLength = roundQty(Math.max(0, Number(roll.reservedLength || 0) - Number(rollAllocation.length || 0)));
        }
      }
    };

    const createAllocations = (working: Map<string, Product>) => {
      let remaining = qty;
      const productAllocations: Array<{ productId: string; quantity: number; rollAllocations: Array<{ rollId: string; length: number }> }> = [];
      const ordered = productIds
        .map((id) => working.get(id))
        .filter((product): product is Product => Boolean(product))
        .sort((a, b) => {
          const dateA = String((a as any).createdAt || a.metadata?.entryDate || "");
          const dateB = String((b as any).createdAt || b.metadata?.entryDate || "");
          return dateA.localeCompare(dateB) || a.id.localeCompare(b.id);
        });

      for (const product of ordered) {
        if (remaining <= 0) break;
        const availableProductStock = roundQty(Math.max(0, Number(product.stock || 0) - Number(product.reservedStock || 0)));
        if (availableProductStock <= 0) continue;

        let allocated = 0;
        const rollAllocations: Array<{ rollId: string; length: number; productId?: string }> = [];
        if (shouldShowRolls(product) && product.rolls?.length) {
          const balance = getRollStockBalance(product);
          if (!balance.isBalanced) {
            throw new Error(product.name + " için top kayıtları ile ürün stoğu uyuşmuyor. Önce stok kayıtlarını kontrol edin.");
          }
          let rollRemaining = roundQty(Math.min(remaining, availableProductStock));
          for (const roll of product.rolls) {
            const freeLength = Math.max(0, Number(roll.length || 0) - Number(roll.reservedLength || 0));
            const amount = roundQty(Math.min(freeLength, rollRemaining));
            if (roll.status === "available" && amount > 0) {
              roll.reservedLength = roundQty(Number(roll.reservedLength || 0) + amount);
              rollAllocations.push({ rollId: roll.id, length: amount });
              allocated = roundQty(allocated + amount);
              rollRemaining = roundQty(rollRemaining - amount);
            }
          }
          if (rollRemaining > 0) {
            throw new Error(product.name + " içindeki uygun top kayıtları beklenen metrajı karşılamıyor.");
          }
        } else {
          allocated = roundQty(Math.min(remaining, availableProductStock));
        }

        if (allocated > 0) {
          product.reservedStock = roundQty(Number(product.reservedStock || 0) + allocated);
          productAllocations.push({ productId: product.id, quantity: allocated, rollAllocations });
          remaining = roundQty(remaining - allocated);
        }
      }

      if (remaining > 0) {
        const availableTotal = roundQty(qty - remaining);
        throw new Error("Yetersiz kullanılabilir kumaş. " + availableTotal + " m ayrılabilir; istenen " + qty + " m.");
      }
      return productAllocations;
    };

    if (isDemoUser(validUid)) {
      const products = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const reservations = getLocal<any[]>("stokpro_demo_reservations", []);
      const working = new Map<string, Product>();
      for (const id of productIds) {
        const found = products.find((product) => product.id === id);
        if (!found) throw new Error("Kumaş top kayıtlarından biri bulunamadı: " + id);
        if (found.tenantId && found.tenantId !== context.tenantId) throw new Error("Kumaş topu başka firmaya ait.");
        working.set(id, JSON.parse(JSON.stringify(found)));
      }

      const existing = reservations.find((reservation) => reservation.id === reservationId);
      if (existing && (existing.userId !== validUid || existing.tenantId !== context.tenantId)) {
        throw new Error("Bu sepet rezervasyonu başka bir kullanıcıya ait.");
      }
      if (existing?.status === "active") {
        const extraIds = (existing.productAllocations || []).map((item: any) => item.productId).filter((id: string) => !working.has(id));
        for (const id of extraIds) {
          const found = products.find((product) => product.id === id);
          if (found) working.set(id, JSON.parse(JSON.stringify(found)));
        }
        releaseOldAllocations(working, existing);
      } else if (existing && existing.status !== "released" && existing.status !== "expired") {
        throw new Error("Bu sepet rezervasyonu artık kullanılamıyor.");
      }

      const allocations = createAllocations(working);
      const nextProducts = products.map((product) => working.get(product.id) || product);
      const nextReservations = reservations.filter((reservation) => reservation.id !== reservationId);
      nextReservations.push({
        id: reservationId,
        tenantId: context.tenantId,
        userId: validUid,
        productId: representativeId,
        productIds,
        quantity: qty,
        unit: "Metre",
        productAllocations: allocations,
        status: "active",
        createdAt: new Date(now).toISOString(),
        expiresAt
      });
      setLocal("stokpro_demo_products", nextProducts);
      setLocal("stokpro_demo_reservations", nextReservations);
      memoryCache.invalidate("products_");
      return working.get(representativeId)!;
    }

    await this.cleanupExpiredReservations(validUid);
    const reservationRef = doc(this.db, "stock_reservations", reservationId);
    const productRefs = new Map(productIds.map((id) => [id, doc(this.db, "products", id)]));

    return runTransaction(this.db, async (transaction) => {
      const reservationSnap = await transaction.get(reservationRef);
      const productSnaps = new Map<string, any>();
      for (const id of productIds) {
        productSnaps.set(id, await transaction.get(productRefs.get(id)!));
      }

      const working = new Map<string, Product>();
      for (const [id, snap] of productSnaps.entries()) {
        if (!snap.exists()) throw new Error("Kumaş top kayıtlarından biri bulunamadı: " + id);
        const data = snap.data();
        if (!(data.tenantId === context.tenantId || data.userId === validUid)) {
          throw new Error("Bu kumaş topu için rezervasyon yapma yetkiniz yok.");
        }
        working.set(id, { id, ...data } as Product);
      }

      let existing: any = null;
      if (reservationSnap.exists()) {
        existing = reservationSnap.data();
        if (existing.userId !== validUid || existing.tenantId !== context.tenantId) {
          throw new Error("Bu sepet rezervasyonu başka bir kullanıcıya ait.");
        }
        if (existing.status === "active") {
          const extraIds = (existing.productAllocations || []).map((item: any) => item.productId).filter((id: string) => !working.has(id));
          if (extraIds.length) throw new Error("Önceki sepet rezervasyonunun top grubu değişmiş. Sepeti yeniden oluşturun.");
          releaseOldAllocations(working, existing);
        } else if (existing.status !== "released" && existing.status !== "expired") {
          throw new Error("Bu sepet rezervasyonu artık kullanılamıyor.");
        }
      }

      const allocations = createAllocations(working);
      for (const [id, product] of working.entries()) {
        transaction.update(productRefs.get(id)!, {
          reservedStock: Number(product.reservedStock || 0),
          ...(product.rolls ? { rolls: product.rolls } : {})
        });
      }
      transaction.set(reservationRef, {
        tenantId: context.tenantId,
        userId: validUid,
        productId: representativeId,
        productIds,
        quantity: qty,
        unit: "Metre",
        productAllocations: allocations,
        status: "active",
        createdAt: new Date(now).toISOString(),
        expiresAt
      });
      return working.get(representativeId)!;
    });
  }

  /**
   * Atomically holds stock for a cart line. The physical stock remains unchanged;
   * reservedStock / reservedLength / reservedQuantity reduce what other sellers can offer.
   */
  async reserveStock(
    uid: string,
    productId: string,
    quantity: number,
    reservationId: string,
    selectedBoxId?: string,
    groupProductIds?: string[]
  ): Promise<Product> {
    if (groupProductIds && new Set(groupProductIds).size > 1) {
      return this.reserveGroupedFabricStock(uid, productId, quantity, reservationId, groupProductIds);
    }
    const validUid = assertAuthenticated(uid, "SalesRepository.reserveStock");
    const qty = roundQty(Number(quantity));
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Rezerve edilecek miktar sıfırdan büyük olmalıdır.");
    if (!reservationId || reservationId.includes("/")) throw new Error("Geçersiz sepet rezervasyon kimliği.");

    const context = await this.userRepo.getOrCreateContext(validUid);
    const now = Date.now();
    const expiresAt = new Date(now + 15 * 60 * 1000).toISOString();

    if (isDemoUser(validUid)) {
      const products = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const product = products.find(p => p.id === productId);
      if (!product) throw new Error("Ürün bulunamadı.");
      const reservations = getLocal<any[]>("stokpro_demo_reservations", []);
      const old = reservations.find(r => r.id === reservationId && r.status === "active");
      if (old && old.productId !== productId) throw new Error("Rezervasyon başka bir ürüne ait.");

      const working: Product = JSON.parse(JSON.stringify(product));
      let reservedStock = Number(working.reservedStock || 0);
      if (old) {
        reservedStock = Math.max(0, reservedStock - Number(old.quantity || 0));
        for (const allocation of old.rollAllocations || []) {
          const roll = working.rolls?.find(r => r.id === allocation.rollId);
          if (roll) roll.reservedLength = roundQty(Math.max(0, Number(roll.reservedLength || 0) - allocation.length));
        }
        for (const allocation of old.boxAllocations || []) {
          const box = working.boxes?.find(b => b.id === allocation.boxId);
          if (box) box.reservedQuantity = roundQty(Math.max(0, Number(box.reservedQuantity || 0) - allocation.quantity));
        }
      }

      const availableStock = roundQty(Math.max(0, Number(working.stock || 0) - reservedStock));
      if (availableStock < qty) throw new Error(`Yetersiz kullanılabilir stok. Şu anda yalnızca ${availableStock} ${shouldShowRolls(working) ? "metre" : (working.unit || "adet")} ayırabilirsiniz.`);

      const rollAllocations: Array<{ rollId: string; length: number; productId?: string }> = [];
      const boxAllocations: Array<{ boxId: string; quantity: number }> = [];
      if (shouldShowRolls(working) && working.rolls?.length) {
        let remaining = qty;
        for (const roll of working.rolls) {
          const available = Math.max(0, Number(roll.length || 0) - Number(roll.reservedLength || 0));
          const amount = roundQty(Math.min(available, remaining));
          if (roll.status === "available" && amount > 0) {
            roll.reservedLength = roundQty(Number(roll.reservedLength || 0) + amount);
            rollAllocations.push({ rollId: roll.id, length: amount });
            remaining = roundQty(remaining - amount);
          }
        }
        if (remaining > 0) throw new Error(`Satışa uygun kumaş toplarında yalnızca ${roundQty(qty - remaining)} m ayrılabilir.`);
      } else if (working.boxes?.length) {
        let remaining = qty;
        const orderedBoxes = selectedBoxId
          ? working.boxes.filter(b => b.id === selectedBoxId)
          : working.boxes;
        for (const box of orderedBoxes) {
          const available = Math.max(0, Number(box.quantity || 0) - Number(box.reservedQuantity || 0));
          const amount = roundQty(Math.min(available, remaining));
          if (box.status === "available" && amount > 0) {
            box.reservedQuantity = roundQty(Number(box.reservedQuantity || 0) + amount);
            boxAllocations.push({ boxId: box.id, quantity: amount });
            remaining = roundQty(remaining - amount);
          }
        }
        if (remaining > 0) throw new Error(`Satışa uygun kolilerde yalnızca ${roundQty(qty - remaining)} adet ayrılabilir.`);
      }

      working.reservedStock = roundQty(reservedStock + qty);
      const index = products.findIndex(p => p.id === productId);
      products[index] = working;
      setLocal("stokpro_demo_products", products);
      const nextReservations = reservations.filter(r => r.id !== reservationId);
      nextReservations.push({
        id: reservationId, tenantId: context.tenantId, userId: validUid, productId,
        quantity: qty, rollAllocations, boxAllocations, status: "active", createdAt: new Date(now).toISOString(), expiresAt
      });
      setLocal("stokpro_demo_reservations", nextReservations);
      return working;
    }

    // Release expired holds before attempting a new hold.
    await this.cleanupExpiredReservations(validUid);

    const productRef = doc(this.db, "products", productId);
    const reservationRef = doc(this.db, "stock_reservations", reservationId);

    return runTransaction(this.db, async (transaction) => {
      const productSnap = await transaction.get(productRef);
      const reservationSnap = await transaction.get(reservationRef);
      if (!productSnap.exists()) throw new Error("Ürün bulunamadı.");
      const data = productSnap.data();
      if (!(data.tenantId === context.tenantId || data.userId === validUid)) {
        throw new Error("Bu ürün için rezervasyon yapma yetkiniz yok.");
      }
      let oldReservationData: any = null;
      if (reservationSnap.exists()) {
        const existingReservation = reservationSnap.data();
        if (existingReservation.userId !== validUid || existingReservation.productId !== productId || existingReservation.tenantId !== context.tenantId) {
          throw new Error("Bu sepet rezervasyonu başka bir kullanıcıya veya ürüne ait.");
        }
        if (existingReservation.status === "active") {
          oldReservationData = existingReservation;
        } else if (existingReservation.status !== "released" && existingReservation.status !== "expired") {
          throw new Error("Bu sepet rezervasyonu artık kullanılamıyor. Ürünü yeniden sepete ekleyin.");
        }
      }

      const working: Product = { id: productSnap.id, ...data } as Product;
      let reservedStock = Number(working.reservedStock || 0);
      const old = oldReservationData;
      if (old) {
        reservedStock = Math.max(0, reservedStock - Number(old.quantity || 0));
        for (const allocation of old.rollAllocations || []) {
          const roll = working.rolls?.find(r => r.id === allocation.rollId);
          if (roll) roll.reservedLength = roundQty(Math.max(0, Number(roll.reservedLength || 0) - Number(allocation.length || 0)));
        }
        for (const allocation of old.boxAllocations || []) {
          const box = working.boxes?.find(b => b.id === allocation.boxId);
          if (box) box.reservedQuantity = roundQty(Math.max(0, Number(box.reservedQuantity || 0) - Number(allocation.quantity || 0)));
        }
      }

      const availableStock = roundQty(Math.max(0, Number(working.stock || 0) - reservedStock));
      if (availableStock < qty) {
        throw new Error(`Yetersiz kullanılabilir stok. Şu anda yalnızca ${availableStock} ${shouldShowRolls(working) ? "metre" : (working.unit || "adet")} ayırabilirsiniz.`);
      }

      const rollAllocations: Array<{ rollId: string; length: number; productId?: string }> = [];
      const boxAllocations: Array<{ boxId: string; quantity: number }> = [];
      if (shouldShowRolls(working) && working.rolls?.length) {
        let remaining = qty;
        for (const roll of working.rolls) {
          const available = Math.max(0, Number(roll.length || 0) - Number(roll.reservedLength || 0));
          const amount = roundQty(Math.min(available, remaining));
          if (roll.status === "available" && amount > 0) {
            roll.reservedLength = roundQty(Number(roll.reservedLength || 0) + amount);
            rollAllocations.push({ rollId: roll.id, length: amount });
            remaining = roundQty(remaining - amount);
          }
        }
        if (remaining > 0) throw new Error(`Satışa uygun kumaş toplarında yalnızca ${roundQty(qty - remaining)} m ayrılabilir.`);
      } else if (working.boxes?.length) {
        let remaining = qty;
        const orderedBoxes = selectedBoxId
          ? working.boxes.filter(b => b.id === selectedBoxId)
          : working.boxes;
        for (const box of orderedBoxes) {
          const available = Math.max(0, Number(box.quantity || 0) - Number(box.reservedQuantity || 0));
          const amount = roundQty(Math.min(available, remaining));
          if (box.status === "available" && amount > 0) {
            box.reservedQuantity = roundQty(Number(box.reservedQuantity || 0) + amount);
            boxAllocations.push({ boxId: box.id, quantity: amount });
            remaining = roundQty(remaining - amount);
          }
        }
        if (remaining > 0) throw new Error(`Satışa uygun kolilerde yalnızca ${roundQty(qty - remaining)} adet ayrılabilir.`);
      }

      working.reservedStock = roundQty(reservedStock + qty);
      transaction.update(productRef, {
        reservedStock: working.reservedStock,
        ...(working.rolls ? { rolls: working.rolls } : {}),
        ...(working.boxes ? { boxes: working.boxes } : {})
      });
      transaction.set(reservationRef, {
        tenantId: context.tenantId,
        userId: validUid,
        productId,
        quantity: qty,
        unit: shouldShowRolls(working) ? "Metre" : (working.unit || "Adet"),
        rollAllocations,
        boxAllocations,
        status: "active",
        createdAt: new Date(now).toISOString(),
        expiresAt
      });
      return working;
    });
  }

  /** Releases a cart hold without reducing physical stock. */
  async releaseStockReservation(uid: string, reservationId: string): Promise<Product | null> {
    const validUid = assertAuthenticated(uid, "SalesRepository.releaseStockReservation");
    const context = await this.userRepo.getOrCreateContext(validUid);

    const applyRelease = (product: Product, allocation: any) => {
      product.reservedStock = roundQty(Math.max(0, Number(product.reservedStock || 0) - Number(allocation.quantity || 0)));
      for (const item of allocation.rollAllocations || []) {
        const roll = product.rolls?.find((entry) => entry.id === item.rollId);
        if (roll) roll.reservedLength = roundQty(Math.max(0, Number(roll.reservedLength || 0) - Number(item.length || 0)));
      }
      for (const item of allocation.boxAllocations || []) {
        const box = product.boxes?.find((entry) => entry.id === item.boxId);
        if (box) box.reservedQuantity = roundQty(Math.max(0, Number(box.reservedQuantity || 0) - Number(item.quantity || 0)));
      }
    };

    if (isDemoUser(validUid)) {
      const reservations = getLocal<any[]>("stokpro_demo_reservations", []);
      const reservation = reservations.find((entry) => entry.id === reservationId);
      if (!reservation || reservation.status !== "active" || reservation.tenantId !== context.tenantId || reservation.userId !== validUid) return null;
      const products = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const working = new Map<string, Product>();
      const allocations = reservation.productAllocations || [{
        productId: reservation.productId,
        quantity: reservation.quantity,
        rollAllocations: reservation.rollAllocations || [],
        boxAllocations: reservation.boxAllocations || []
      }];
      for (const allocation of allocations) {
        const source = products.find((entry) => entry.id === allocation.productId);
        if (!source) continue;
        const product = JSON.parse(JSON.stringify(source)) as Product;
        applyRelease(product, allocation);
        working.set(product.id, product);
      }
      reservation.status = "released";
      reservation.releasedAt = new Date().toISOString();
      setLocal("stokpro_demo_products", products.map((product) => working.get(product.id) || product));
      setLocal("stokpro_demo_reservations", reservations);
      memoryCache.invalidate("products_");
      return working.get(reservation.productId) || null;
    }

    const reservationRef = doc(this.db, "stock_reservations", reservationId);
    return runTransaction(this.db, async (transaction) => {
      const reservationSnap = await transaction.get(reservationRef);
      if (!reservationSnap.exists()) return null;
      const reservation = reservationSnap.data();
      if (reservation.tenantId !== context.tenantId || reservation.userId !== validUid || reservation.status !== "active") return null;

      const allocations = reservation.productAllocations || [{
        productId: reservation.productId,
        quantity: reservation.quantity,
        rollAllocations: reservation.rollAllocations || [],
        boxAllocations: reservation.boxAllocations || []
      }];
      const products = new Map<string, Product>();
      const refs = new Map<string, any>();
      for (const allocation of allocations) {
        if (products.has(allocation.productId)) continue;
        const ref = doc(this.db, "products", allocation.productId);
        const snap = await transaction.get(ref);
        if (snap.exists()) {
          refs.set(allocation.productId, ref);
          products.set(allocation.productId, { id: snap.id, ...snap.data() } as Product);
        }
      }
      for (const allocation of allocations) {
        const product = products.get(allocation.productId);
        if (product) applyRelease(product, allocation);
      }
      for (const [id, product] of products.entries()) {
        transaction.update(refs.get(id), {
          reservedStock: Number(product.reservedStock || 0),
          ...(product.rolls ? { rolls: product.rolls } : {}),
          ...(product.boxes ? { boxes: product.boxes } : {})
        });
      }
      transaction.update(reservationRef, { status: "released", releasedAt: new Date().toISOString() });
      return products.get(reservation.productId) || null;
    });
  }

  /** Expires abandoned cart reservations after their 15-minute hold window. */
  async cleanupExpiredReservations(uid: string): Promise<void> {
    const validUid = assertAuthenticated(uid, "SalesRepository.cleanupExpiredReservations");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const now = Date.now();
    if (isDemoUser(validUid)) {
      const reservations = getLocal<any[]>("stokpro_demo_reservations", []);
      for (const reservation of reservations) {
        if (reservation.status === "active" && Date.parse(reservation.expiresAt || "") <= now) {
          await this.releaseStockReservation(validUid, reservation.id);
          reservation.status = "expired";
        }
      }
      return;
    }
    const snapshot = await getDocs(query(
      collection(this.db, "stock_reservations"),
      where("tenantId", "==", context.tenantId),
      where("status", "==", "active"),
      where("expiresAt", "<=", new Date(now).toISOString())
    ));
    const expiredIds = snapshot.docs.map(d => d.id);
    for (const id of expiredIds) {
      await this.releaseReservationAsExpired(validUid, id);
    }
  }

  private async releaseReservationAsExpired(uid: string, reservationId: string): Promise<void> {
    const validUid = assertAuthenticated(uid, "SalesRepository.releaseReservationAsExpired");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const reservationRef = doc(this.db, "stock_reservations", reservationId);
    await runTransaction(this.db, async (transaction) => {
      const reservationSnap = await transaction.get(reservationRef);
      if (!reservationSnap.exists()) return;
      const reservation = reservationSnap.data();
      if (reservation.tenantId !== context.tenantId || reservation.status !== "active" || Date.parse(reservation.expiresAt || "") > Date.now()) return;

      const allocations = reservation.productAllocations || [{
        productId: reservation.productId,
        quantity: reservation.quantity,
        rollAllocations: reservation.rollAllocations || [],
        boxAllocations: reservation.boxAllocations || []
      }];
      const products = new Map<string, Product>();
      const refs = new Map<string, any>();
      for (const allocation of allocations) {
        if (products.has(allocation.productId)) continue;
        const ref = doc(this.db, "products", allocation.productId);
        const snap = await transaction.get(ref);
        if (snap.exists()) {
          refs.set(allocation.productId, ref);
          products.set(allocation.productId, { id: snap.id, ...snap.data() } as Product);
        }
      }

      for (const allocation of allocations) {
        const product = products.get(allocation.productId);
        if (!product) continue;
        product.reservedStock = roundQty(Math.max(0, Number(product.reservedStock || 0) - Number(allocation.quantity || 0)));
        for (const item of allocation.rollAllocations || []) {
          const roll = product.rolls?.find((entry) => entry.id === item.rollId);
          if (roll) roll.reservedLength = roundQty(Math.max(0, Number(roll.reservedLength || 0) - Number(item.length || 0)));
        }
        for (const item of allocation.boxAllocations || []) {
          const box = product.boxes?.find((entry) => entry.id === item.boxId);
          if (box) box.reservedQuantity = roundQty(Math.max(0, Number(box.reservedQuantity || 0) - Number(item.quantity || 0)));
        }
      }

      for (const [id, product] of products.entries()) {
        transaction.update(refs.get(id), {
          reservedStock: Number(product.reservedStock || 0),
          ...(product.rolls ? { rolls: product.rolls } : {}),
          ...(product.boxes ? { boxes: product.boxes } : {})
        });
      }
      transaction.update(reservationRef, { status: "expired", expiredAt: new Date().toISOString() });
    });
  }

  /**
   * Listens for real-time changes to sales receipts strictly within the caller's verified tenant.
   * Enables immediate multi-device synchronization across desktops and phones.
   */
  subscribe(
    uid: string,
    onUpdate: (sales: Sale[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const validUid = assertAuthenticated(uid, "SalesRepository.subscribe");
    if (isDemoUser(validUid)) {
      const list = getLocal<Sale[]>("stokpro_demo_sales", SEED_SALES);
      const sorted = list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      onUpdate(sorted);
      return () => {};
    }

    let isUnsubscribed = false;
    let unsubSnapshot: (() => void) | null = null;

    this.userRepo.getOrCreateContext(validUid).then((context) => {
      if (isUnsubscribed) return;
      const q = query(
        collection(this.db, "sales"),
        where("tenantId", "==", context.tenantId)
      );

      unsubSnapshot = onSnapshot(
        q,
        (snapshot) => {
          const sales: Sale[] = [];
          snapshot.forEach((docSnap) => {
            sales.push({ id: docSnap.id, ...docSnap.data() } as Sale);
          });
          const sorted = sales.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          memoryCache.set(`sales_${context.tenantId}`, sorted);
          onUpdate(sorted);
        },
        (err) => {
          console.error("FirebaseSalesRepository subscribe onSnapshot error:", err);
          if (onError) onError(err);
        }
      );
    }).catch((err) => {
      console.error("FirebaseSalesRepository subscribe context error:", err);
      if (onError) onError(err);
    });

    return () => {
      isUnsubscribed = true;
      if (unsubSnapshot) {
        unsubSnapshot();
      }
    };
  }

  async create(uid: string, sale: Omit<Sale, "id">): Promise<Sale> {
    const validUid = assertAuthenticated(uid, "SalesRepository.create");
    const context = await this.userRepo.getOrCreateContext(validUid);
    memoryCache.invalidate("sales_");

    if (isDemoUser(validUid)) {
      const list = getLocal<Sale[]>("stokpro_demo_sales", SEED_SALES);
      const newId = "S_" + Math.random().toString(36).substring(2, 9).toUpperCase();
      const newSale = { id: newId, ...sale, tenantId: context.tenantId } as Sale;
      list.unshift(newSale);
      setLocal("stokpro_demo_sales", list);
      return newSale;
    }

    try {
      const docRef = await addDoc(collection(this.db, "sales"), {
        ...sale,
        userId: validUid,
        tenantId: context.tenantId,
        timestamp: sale.timestamp || new Date().toISOString()
      });
      return { id: docRef.id, ...sale, tenantId: context.tenantId } as Sale;
    } catch (err) {
      console.error("FirebaseSalesRepository create error:", err);
      throw err;
    }
  }

  async processTransaction(uid: string, params: ProcessSaleParams): Promise<Sale> {
    const validUid = assertAuthenticated(uid, "SalesRepository.processTransaction");
    const { items, customerId, amountPaid, idempotencyKey, paymentMethod } = params;
    if (!items || items.length === 0) {
      throw new Error("Sepette satılacak ürün bulunamadı.");
    }

    const isDemo = isDemoUser(validUid);
    const context = await this.userRepo.getOrCreateContext(validUid);

    // 1. DEMO / OFFLINE FALLBACK MODE
    if (isDemo) {
      const productsList = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const salesList = getLocal<Sale[]>("stokpro_demo_sales", SEED_SALES);
      const customersList = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
      const demoReservations = getLocal<any[]>("stokpro_demo_reservations", []);

      const scopedSaleId = idempotencyKey 
        ? `${context.tenantId}_${idempotencyKey}` 
        : ("S_" + Math.random().toString(36).substring(2, 9).toUpperCase());

      // Idempotency check for demo / offline fallback
      if (idempotencyKey) {
        const existingSale = salesList.find(s => s.id === scopedSaleId || s.id === idempotencyKey);
        if (existingSale) {
          return existingSale;
        }
      }

      const saleItems: any[] = [];
      const demoMovementsToRecord: StockMovement[] = [];
      let totalAmount = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const prod = productsList.find(p => p.id === item.productId);
        if (!prod) throw new Error(`Ürün bulunamadı: ${item.productId}`);

        const previousStock = roundQty(Number(prod.stock || 0));
        const qty = roundQty(Number(item.quantity));
        const lineQty = item.cutLength !== undefined ? roundQty(Number(item.cutLength)) : qty;
        const qtyToDeduct = lineQty;
        if (isNaN(qtyToDeduct) || qtyToDeduct <= 0) {
          throw new Error(`Geçersiz satış miktarı: ${prod.name}`);
        }

        const isRollTracked = shouldShowRolls(prod);
        const rollAllocations: Array<{ rollId: string; length: number; productId?: string }> = [];
        const boxAllocations: Array<{ boxId: string; quantity: number }> = [];
        const groupProductAllocations: Array<{ productId: string; quantity: number; rollAllocations: Array<{ rollId: string; length: number }> }> = [];

        if (isRollTracked && prod.rolls && prod.rolls.length > 0) {
          const balance = getRollStockBalance(prod);
          if (!balance.isBalanced) {
            throw new Error(`Kumaş stok uyuşmazlığı: ürün stoğu ${balance.productStock} m, top kayıtları ${balance.trackedRollLength} m. Satıştan önce topları kontrol edin.`);
          }
        }

        const cartReservation = item.reservationId
          ? demoReservations.find(r => r.id === item.reservationId)
          : null;

        if (item.reservationId) {
          if (!cartReservation || cartReservation.status !== "active" || cartReservation.userId !== validUid ||
              cartReservation.productId !== prod.id || Date.parse(cartReservation.expiresAt || "") <= Date.now()) {
            throw new Error("Sepet stok ayırma süresi dolmuş. Ürünü yeniden sepete ekleyin.");
          }
          if (roundQty(Number(cartReservation.quantity)) !== qtyToDeduct) {
            throw new Error("Sepet rezervasyonu ile satış miktarı eşleşmiyor. Miktarı yeniden ayırın.");
          }

          if (Array.isArray(cartReservation.productAllocations) && cartReservation.productAllocations.length > 0) {
            for (const allocation of cartReservation.productAllocations) {
              const source = productsList.find((entry) => entry.id === allocation.productId);
              if (!source) throw new Error("Sepet rezervasyonundaki kumaş topu bulunamadı.");
              const amount = roundQty(Number(allocation.quantity || 0));
              source.reservedStock = roundQty(Math.max(0, Number(source.reservedStock || 0) - amount));
              const sourceRollAllocations: Array<{ rollId: string; length: number }> = [];
              for (const rollAllocation of allocation.rollAllocations || []) {
                const roll = source.rolls?.find((entry) => entry.id === rollAllocation.rollId);
                if (!roll) throw new Error("Rezervasyondaki kumaş topu bulunamadı.");
                const rollAmount = roundQty(Number(rollAllocation.length || 0));
                if (Number(roll.reservedLength || 0) < rollAmount || Number(roll.length || 0) < rollAmount) {
                  throw new Error("Rezerve edilen kumaş topu miktarı artık uygun değil.");
                }
                roll.reservedLength = roundQty(Math.max(0, Number(roll.reservedLength || 0) - rollAmount));
                roll.length = roundQty(Math.max(0, Number(roll.length || 0) - rollAmount));
                roll.soldLength = roundQty(Number(roll.soldLength || 0) + rollAmount);
                roll.status = roll.length <= 0 ? "sold" : "available";
                sourceRollAllocations.push({ rollId: roll.id, length: rollAmount });
                rollAllocations.push({ rollId: roll.id, length: rollAmount, productId: source.id });
              }
              if (sourceRollAllocations.length > 0 && source.rolls) {
                source.stock = roundQty(source.rolls.reduce((sum, roll) => sum + (Number(roll.length) || 0), 0));
              } else {
                source.stock = roundQty(Math.max(0, Number(source.stock || 0) - amount));
              }
              groupProductAllocations.push({ productId: source.id, quantity: amount, rollAllocations: sourceRollAllocations });
              demoMovementsToRecord.push({
                id: scopedSaleId + "_mov_" + i + "_" + source.id,
                tenantId: context.tenantId,
                userId: uid,
                productId: source.id,
                productName: source.name,
                warehouseId: source.warehouseId || undefined,
                type: "roll_cut",
                quantity: amount,
                previousStock: roundQty(Number(source.stock || 0) + amount),
                newStock: roundQty(Number(source.stock || 0)),
                unit: "Metre",
                referenceType: "sale",
                referenceId: scopedSaleId,
                timestamp: new Date().toISOString(),
                notes: "Satış Fişi #" + scopedSaleId + " - Kumaş grup metraj çıkışı"
              });
            }
          } else {
            prod.reservedStock = roundQty(Math.max(0, Number(prod.reservedStock || 0) - qtyToDeduct));
            for (const allocation of cartReservation.rollAllocations || []) {
              const roll = prod.rolls?.find(r => r.id === allocation.rollId);
              if (!roll) throw new Error("Rezervasyondaki kumaş topu bulunamadı.");
              const amount = roundQty(Number(allocation.length || 0));
              if (Number(roll.reservedLength || 0) < amount || Number(roll.length || 0) < amount) {
                throw new Error("Rezerve edilen kumaş topu miktarı artık uygun değil.");
              }
              roll.reservedLength = roundQty(Math.max(0, Number(roll.reservedLength || 0) - amount));
              roll.length = roundQty(Math.max(0, Number(roll.length || 0) - amount));
              roll.soldLength = roundQty(Number(roll.soldLength || 0) + amount);
              roll.status = roll.length <= 0 ? "sold" : "available";
              rollAllocations.push({ rollId: roll.id, length: amount });
            }
            for (const allocation of cartReservation.boxAllocations || []) {
              const box = prod.boxes?.find(b => b.id === allocation.boxId);
              if (!box) throw new Error("Rezervasyondaki koli bulunamadı.");
              const amount = roundQty(Number(allocation.quantity || 0));
              if (Number(box.reservedQuantity || 0) < amount || Number(box.quantity || 0) < amount) {
                throw new Error("Rezerve edilen koli miktarı artık uygun değil.");
              }
              box.reservedQuantity = roundQty(Math.max(0, Number(box.reservedQuantity || 0) - amount));
              box.quantity = roundQty(Math.max(0, Number(box.quantity || 0) - amount));
              box.soldQuantity = roundQty(Number(box.soldQuantity || 0) + amount);
              box.status = box.quantity <= 0 ? "depleted" : "available";
              boxAllocations.push({ boxId: box.id, quantity: amount });
            }
            if (rollAllocations.length > 0 && prod.rolls) {
              prod.stock = roundQty(prod.rolls.reduce((sum, roll) => sum + (Number(roll.length) || 0), 0));
            } else if (boxAllocations.length > 0 && prod.boxes) {
              prod.stock = roundQty(prod.boxes.reduce((sum, box) => sum + (Number(box.quantity) || 0), 0));
            } else {
              prod.stock = roundQty(Math.max(0, Number(prod.stock || 0) - qtyToDeduct));
            }
          }
          cartReservation.status = "committed";
          cartReservation.committedAt = new Date().toISOString();
        } else if (item.selectedRollId && prod.rolls) {
          const roll = prod.rolls.find(r => r.id === item.selectedRollId);
          if (!roll) throw new Error(`Kumaş topu bulunamadı: ID ${item.selectedRollId}`);
          if (roll.status !== "available") throw new Error(`Seçilen kumaş topu satışa uygun değil: ${roll.rollNumber}`);
          const currentLen = Number(roll.length);
          if (currentLen - Number(roll.reservedLength || 0) < qtyToDeduct) {
            throw new Error(`Seçilen kumaş topunda (${roll.rollNumber}) yeterli kumaş kalmadı! Kalan: ${currentLen}m (Talep edilen: ${qtyToDeduct}m)`);
          }
          const initLen = roll.initialLength !== undefined ? Number(roll.initialLength) : currentLen;
          roll.initialLength = initLen;
          const updatedLen = roundQty(Math.max(0, currentLen - qtyToDeduct));
          roll.length = updatedLen;
          roll.soldLength = roundQty(Math.max(0, initLen - updatedLen));
          roll.status = updatedLen <= 0 ? "sold" : "available";
          rollAllocations.push({ rollId: roll.id, length: qtyToDeduct });
          prod.stock = roundQty(prod.rolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));
        } else if (item.selectedBoxId && prod.boxes) {
          const box = prod.boxes.find(b => b.id === item.selectedBoxId);
          if (!box) throw new Error(`Koli bulunamadı: ID ${item.selectedBoxId}`);
          if (box.status !== "available") throw new Error(`Seçilen koli satışa uygun değil: ${box.boxNumber}`);
          const currentQty = Number(box.quantity);
          if (currentQty - Number(box.reservedQuantity || 0) < qtyToDeduct) {
            throw new Error(`Seçilen kolide (${box.boxNumber}) yeterli serbest adet kalmadı! Kalan: ${roundQty(currentQty - Number(box.reservedQuantity || 0))} (Talep edilen: ${qtyToDeduct})`);
          }
          const initQty = box.initialQuantity !== undefined ? Number(box.initialQuantity) : currentQty;
          box.initialQuantity = initQty;
          const updatedQty = roundQty(Math.max(0, currentQty - qtyToDeduct));
          box.quantity = updatedQty;
          box.soldQuantity = roundQty((box.soldQuantity || 0) + qtyToDeduct);
          box.status = updatedQty <= 0 ? "depleted" : "available";
          boxAllocations.push({ boxId: box.id, quantity: qtyToDeduct });
          prod.stock = roundQty(prod.boxes.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0));
        } else if (isRollTracked && prod.rolls && prod.rolls.length > 0) {
          const availableRollLength = prod.rolls
            .filter(r => r.status === "available")
            .reduce((sum, r) => sum + Math.max(0, Number(r.length || 0) - Number(r.reservedLength || 0)), 0);
          if (availableRollLength < qtyToDeduct) {
            throw new Error(`Satışa uygun toplarda yeterli kumaş yok! Kullanılabilir: ${availableRollLength} m`);
          }

          let remainingDeduct = qtyToDeduct;
          for (const roll of prod.rolls) {
            const currentLen = Number(roll.length) || 0;
            const freeLen = Math.max(0, currentLen - Number(roll.reservedLength || 0));
            if (roll.status === "available" && freeLen > 0 && remainingDeduct > 0) {
              const dec = roundQty(Math.min(freeLen, remainingDeduct));
              remainingDeduct = roundQty(remainingDeduct - dec);
              const initLen = roll.initialLength !== undefined ? Number(roll.initialLength) : currentLen;
              roll.initialLength = initLen;
              const updatedLen = roundQty(Math.max(0, currentLen - dec));
              roll.length = updatedLen;
              roll.soldLength = roundQty(Math.max(0, initLen - updatedLen));
              roll.status = updatedLen <= 0 ? "sold" : "available";
              rollAllocations.push({ rollId: roll.id, length: dec });
            }
          }
          if (remainingDeduct > 0) {
            throw new Error(`Kumaş top kayıtlarında ${remainingDeduct} m eksik stok var. Satış iptal edildi.`);
          }
          prod.stock = roundQty(prod.rolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));
        } else if (prod.boxes && prod.boxes.length > 0) {
          const availableBoxQuantity = prod.boxes
            .filter(b => b.status === "available")
            .reduce((sum, b) => sum + Math.max(0, Number(b.quantity || 0) - Number(b.reservedQuantity || 0)), 0);
          if (availableBoxQuantity < qtyToDeduct) {
            throw new Error(`Satışa uygun kolilerde yeterli adet yok! Kullanılabilir: ${availableBoxQuantity}`);
          }

          let remainingDeduct = qtyToDeduct;
          for (const box of prod.boxes) {
            const currentQty = Number(box.quantity) || 0;
            const freeQty = Math.max(0, currentQty - Number(box.reservedQuantity || 0));
            if (box.status === "available" && freeQty > 0 && remainingDeduct > 0) {
              const dec = roundQty(Math.min(freeQty, remainingDeduct));
              remainingDeduct = roundQty(remainingDeduct - dec);
              const initQty = box.initialQuantity !== undefined ? Number(box.initialQuantity) : currentQty;
              box.initialQuantity = initQty;
              const updatedQty = roundQty(Math.max(0, currentQty - dec));
              box.quantity = updatedQty;
              box.soldQuantity = roundQty((box.soldQuantity || 0) + dec);
              box.status = updatedQty <= 0 ? "depleted" : "available";
              boxAllocations.push({ boxId: box.id, quantity: dec });
            }
          }
          if (remainingDeduct > 0) {
            throw new Error(`Koli kayıtlarında ${remainingDeduct} adet eksik stok var. Satış iptal edildi.`);
          }
          prod.stock = roundQty(prod.boxes.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0));
        } else {
          if (prod.stock - Number(prod.reservedStock || 0) < qtyToDeduct) {
            throw new Error(`Yetersiz Stok: "${prod.name}" için kullanılabilir stok: ${roundQty(prod.stock - Number(prod.reservedStock || 0))}, istenen miktar: ${qtyToDeduct}`);
          }
          prod.stock = roundQty(Math.max(0, prod.stock - qtyToDeduct));
        }

        const newStock = roundQty(Number(prod.stock || 0));
        const lineTotal = round2(prod.price * lineQty);
        totalAmount = round2(totalAmount + lineTotal);
        const itemUnit = isRollTracked ? "Metre" : (prod.unit || "Adet");

        const saleItem: any = {
          productId: item.productId,
          productName: prod.name,
          name: prod.name,
          quantity: lineQty,
          price: prod.price,
          unit: itemUnit
        };
        if (item.selectedRollId) saleItem.selectedRollId = item.selectedRollId;
        if (item.selectedBoxId) saleItem.selectedBoxId = item.selectedBoxId;
        if (item.cutLength !== undefined) saleItem.cutLength = roundQty(Number(item.cutLength));
        if (rollAllocations.length > 0) saleItem.rollAllocations = rollAllocations;
        if (boxAllocations.length > 0) saleItem.boxAllocations = boxAllocations;
        if (groupProductAllocations.length > 0) saleItem.productAllocations = groupProductAllocations;
        saleItems.push(saleItem);

        if (groupProductAllocations.length === 0) {
        const movementDocId = `${scopedSaleId}_mov_${i}_${item.productId}`;
        demoMovementsToRecord.push({
          id: movementDocId,
          tenantId: context.tenantId,
          userId: uid,
          productId: item.productId,
          productName: prod.name,
          warehouseId: prod.warehouseId || undefined,
          type: isRollTracked ? "roll_cut" : "out",
          quantity: lineQty,
          previousStock,
          newStock,
          unit: itemUnit,
          referenceType: "sale",
          referenceId: scopedSaleId,
          timestamp: new Date().toISOString(),
          notes: isRollTracked
            ? `Satış Fişi #${scopedSaleId} - Kumaş metraj çıkışı`
            : (item.selectedBoxId || boxAllocations.length > 0
              ? `Satış Fişi #${scopedSaleId} - Koli çıkışı`
              : `Satış Fişi #${scopedSaleId}`)
        });
        }
      }

      const saleId = scopedSaleId;
      const newSale: Sale = {
        id: saleId,
        tenantId: context.tenantId,
        items: saleItems,
        totalAmount,
        paymentMethod: paymentMethod || "Nakit",
        timestamp: new Date().toISOString(),
        customerId: customerId || undefined,
        status: "Tamamlandı",
        stockDeducted: true,
        stockRestored: false,
        idempotencyKey: idempotencyKey || undefined
      };

      // Sync timestamp on movements
      demoMovementsToRecord.forEach(m => m.timestamp = newSale.timestamp);

      salesList.unshift(newSale);
      setLocal("stokpro_demo_products", productsList);
      setLocal("stokpro_demo_reservations", demoReservations);
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

      // Record stock movements in demo storage
      const demoMovementsList = getLocal<StockMovement[]>("stokpro_demo_stock_movements", []);
      for (const mov of demoMovementsToRecord) {
        demoMovementsList.unshift(mov);
      }
      setLocal("stokpro_demo_stock_movements", demoMovementsList);

      // Record payment in demo storage if amountPaid > 0
      const paid = round2(Number(amountPaid || 0));
      if (paid > 0) {
        const demoCust = customerId ? customersList.find(c => c.id === customerId) : null;
        const demoPaymentsList = getLocal<Payment[]>("stokpro_demo_payments", []);
        const paymentDocId = `${newSale.id}_pay`;
        const paymentData: Payment = {
          id: paymentDocId,
          tenantId: context.tenantId,
          userId: uid,
          customerId: customerId || undefined,
          customerName: demoCust ? demoCust.name : (customerId ? undefined : "Peşin / Anonim Müşteri"),
          type: "incoming",
          amount: paid,
          paymentMethod: normalizePaymentMethod(paymentMethod),
          timestamp: newSale.timestamp,
          description: demoCust
            ? `Satış Tahsilatı (Fiş: #${newSale.id} - ${demoCust.name})`
            : `Peşin Satış Tahsilatı (Fiş: #${newSale.id})`,
          receiptNo: newSale.id
        };
        demoPaymentsList.unshift(paymentData);
        setLocal("stokpro_demo_payments", demoPaymentsList);
      }

      await logAuditEvent(uid, {
        action: "SALE_CREATED",
        entityType: "sale",
        entityId: newSale.id,
        companyId: context.tenantId,
        details: { 
          totalAmount, 
          amountPaid: paid,
          itemsCount: saleItems.length, 
          customerId,
          paymentMethod: normalizePaymentMethod(paymentMethod)
        }
      });

      memoryCache.invalidate("sales_");
      memoryCache.invalidate("products_");
      memoryCache.invalidate("customers_");
      memoryCache.invalidate("payments_");
      memoryCache.invalidate("stock_movements_");

      return newSale;
    }

    // 2. PRODUCTION FIRESTORE ACID TRANSACTION
    try {
      const saleDocId = idempotencyKey 
        ? `${context.tenantId}_${idempotencyKey}` 
        : doc(collection(this.db, "sales")).id;
      const saleRef = doc(this.db, "sales", saleDocId);
      let isIdempotentHit = false;

      const saleResult = await runTransaction(this.db, async (transaction) => {
        isIdempotentHit = false;

        // Reads first: Idempotency deduplication gate
        if (idempotencyKey) {
          const existingSaleSnap = await transaction.get(saleRef);
          if (existingSaleSnap.exists()) {
            const existingData = existingSaleSnap.data() as Sale;
            if (existingData.tenantId && existingData.tenantId !== context.tenantId) {
              throw new Error("Yetkisiz işlem: Bu satış kaydına erişim izniniz bulunmuyor.");
            }
            isIdempotentHit = true;
            return {
              id: existingSaleSnap.id,
              ...existingData
            } as Sale;
          }
        }

        // Reads first: Load products
        const uniqueProductIds = Array.from(new Set(items.flatMap(i => [i.productId, ...(i.productIds || [])])));
        const productDocsMap = new Map<string, any>();

        for (const pId of uniqueProductIds) {
          const pRef = doc(this.db, "products", pId);
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

        // Load every cart reservation before the transaction begins writing.
        const reservationDocsMap = new Map<string, { ref: any; data: any }>();
        const reservationIds = Array.from(new Set(items.map(i => i.reservationId).filter((id): id is string => Boolean(id))));
        for (const reservationId of reservationIds) {
          const reservationRef = doc(this.db, "stock_reservations", reservationId);
          const reservationSnap = await transaction.get(reservationRef);
          if (!reservationSnap.exists()) {
            throw new Error("Sepet stok ayırması bulunamadı. Ürünü yeniden sepete ekleyin.");
          }
          reservationDocsMap.set(reservationId, { ref: reservationRef, data: reservationSnap.data() });
        }

        let customerData: any = null;
        let customerRef: any = null;
        if (customerId) {
          customerRef = doc(this.db, "customers", customerId);
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

        // Writes calculation
        const workingProducts = new Map<string, any>();
        for (const [pId, pData] of productDocsMap.entries()) {
          workingProducts.set(pId, JSON.parse(JSON.stringify(pData)));
        }

        const saleItems: any[] = [];
        const stockMovementsToCreate: StockMovement[] = [];
        let totalAmount = 0;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const prod = workingProducts.get(item.productId);
          if (!prod) continue;

          const previousStock = roundQty(Number(prod.stock || 0));
          const qty = roundQty(Number(item.quantity));
          const lineQty = item.cutLength !== undefined ? roundQty(Number(item.cutLength)) : qty;
          const qtyToDeduct = lineQty;
          if (isNaN(qtyToDeduct) || qtyToDeduct <= 0) {
            throw new Error(`Geçersiz satış miktarı: ${prod.name}`);
          }

          const isRollTracked = shouldShowRolls(prod);
          const rollAllocations: Array<{ rollId: string; length: number; productId?: string }> = [];
          const boxAllocations: Array<{ boxId: string; quantity: number }> = [];
          const groupProductAllocations: Array<{ productId: string; quantity: number; rollAllocations: Array<{ rollId: string; length: number }> }> = [];

          if (isRollTracked && prod.rolls && prod.rolls.length > 0) {
            const balance = getRollStockBalance(prod);
            if (!balance.isBalanced) {
              throw new Error(`Kumaş stok uyuşmazlığı: ürün stoğu ${balance.productStock} m, top kayıtları ${balance.trackedRollLength} m. Satıştan önce topları kontrol edin.`);
            }
          }

          const reservationEntry = item.reservationId ? reservationDocsMap.get(item.reservationId) : undefined;
          if (item.reservationId) {
            const reservation = reservationEntry?.data;
            if (!reservation || reservation.status !== "active" || reservation.userId !== uid ||
                reservation.tenantId !== context.tenantId || reservation.productId !== prod.id ||
                Date.parse(reservation.expiresAt || "") <= Date.now()) {
              throw new Error("Sepet stok ayırmasının süresi dolmuş. Ürünü yeniden sepete ekleyin.");
            }
            if (roundQty(Number(reservation.quantity)) !== qtyToDeduct) {
              throw new Error("Sepette ayrılan miktar ile satış miktarı eşleşmiyor. Lütfen miktarı yeniden ayırın.");
            }

            if (Array.isArray(reservation.productAllocations) && reservation.productAllocations.length > 0) {
              const expectedIds = new Set(item.productIds || []);
              for (const allocation of reservation.productAllocations) {
                if (expectedIds.size > 0 && !expectedIds.has(allocation.productId)) {
                  throw new Error("Sepet rezervasyonu ile kumaş ürün grubu eşleşmiyor. Sepeti yeniden oluşturun.");
                }
                const source = workingProducts.get(allocation.productId);
                if (!source) throw new Error("Rezervasyondaki kumaş topu bulunamadı.");
                const amount = roundQty(Number(allocation.quantity || 0));
                if (Number(source.reservedStock || 0) < amount || Number(source.stock || 0) < amount) {
                  throw new Error("Rezerve edilen kumaş stoğu artık uygun değil.");
                }
                source.reservedStock = roundQty(Math.max(0, Number(source.reservedStock || 0) - amount));
                const sourceRollAllocations: Array<{ rollId: string; length: number }> = [];
                for (const rollAllocation of allocation.rollAllocations || []) {
                  const roll = source.rolls?.find((entry: FabricRoll) => entry.id === rollAllocation.rollId);
                  if (!roll) throw new Error("Rezervasyondaki kumaş topu bulunamadı.");
                  const rollAmount = roundQty(Number(rollAllocation.length || 0));
                  if (Number(roll.reservedLength || 0) < rollAmount || Number(roll.length || 0) < rollAmount) {
                    throw new Error("Rezerve edilen kumaş topu miktarı artık uygun değil.");
                  }
                  roll.reservedLength = roundQty(Math.max(0, Number(roll.reservedLength || 0) - rollAmount));
                  roll.length = roundQty(Math.max(0, Number(roll.length || 0) - rollAmount));
                  roll.soldLength = roundQty(Number(roll.soldLength || 0) + rollAmount);
                  roll.status = roll.length <= 0 ? "sold" : "available";
                  sourceRollAllocations.push({ rollId: roll.id, length: rollAmount });
                  rollAllocations.push({ rollId: roll.id, length: rollAmount, productId: source.id });
                }
                if (sourceRollAllocations.length > 0 && source.rolls) {
                  source.stock = roundQty(source.rolls.reduce((sum: number, roll: FabricRoll) => sum + (Number(roll.length) || 0), 0));
                } else {
                  source.stock = roundQty(Math.max(0, Number(source.stock || 0) - amount));
                }
                groupProductAllocations.push({ productId: source.id, quantity: amount, rollAllocations: sourceRollAllocations });
                const moveId = saleRef.id + "_mov_" + i + "_" + source.id;
                const sourceMovement: any = {
                  id: moveId,
                  tenantId: context.tenantId,
                  userId: uid,
                  productId: source.id,
                  productName: source.name,
                                    type: "roll_cut",
                  quantity: amount,
                  previousStock: roundQty(Number(source.stock || 0) + amount),
                  newStock: roundQty(Number(source.stock || 0)),
                  unit: "Metre",
                  referenceType: "sale",
                  referenceId: saleRef.id,
                  timestamp: new Date().toISOString(),
                  notes: "Satış Fişi #" + saleRef.id + " - Kumaş grup metraj çıkışı"
                };
                if (source.warehouseId) sourceMovement.warehouseId = source.warehouseId;
                stockMovementsToCreate.push(sourceMovement as StockMovement);
              }
            } else {
              prod.reservedStock = roundQty(Math.max(0, Number(prod.reservedStock || 0) - qtyToDeduct));
              for (const allocation of reservation.rollAllocations || []) {
                const roll = prod.rolls?.find((r: FabricRoll) => r.id === allocation.rollId);
                if (!roll) throw new Error("Rezervasyondaki kumaş topu bulunamadı.");
                const amount = roundQty(Number(allocation.length || 0));
                if (Number(roll.reservedLength || 0) < amount || Number(roll.length || 0) < amount) {
                  throw new Error("Rezerve edilen kumaş topu miktarı artık uygun değil.");
                }
                roll.reservedLength = roundQty(Math.max(0, Number(roll.reservedLength || 0) - amount));
                roll.length = roundQty(Math.max(0, Number(roll.length || 0) - amount));
                roll.soldLength = roundQty(Number(roll.soldLength || 0) + amount);
                roll.status = roll.length <= 0 ? "sold" : "available";
                rollAllocations.push({ rollId: roll.id, length: amount });
              }
              for (const allocation of reservation.boxAllocations || []) {
                const box = prod.boxes?.find((b: any) => b.id === allocation.boxId);
                if (!box) throw new Error("Rezervasyondaki koli bulunamadı.");
                const amount = roundQty(Number(allocation.quantity || 0));
                if (Number(box.reservedQuantity || 0) < amount || Number(box.quantity || 0) < amount) {
                  throw new Error("Rezerve edilen koli miktarı artık uygun değil.");
                }
                box.reservedQuantity = roundQty(Math.max(0, Number(box.reservedQuantity || 0) - amount));
                box.quantity = roundQty(Math.max(0, Number(box.quantity || 0) - amount));
                box.soldQuantity = roundQty(Number(box.soldQuantity || 0) + amount);
                box.status = box.quantity <= 0 ? "depleted" : "available";
                boxAllocations.push({ boxId: box.id, quantity: amount });
              }
              if (rollAllocations.length > 0 && prod.rolls) {
                prod.stock = roundQty(prod.rolls.reduce((sum: number, roll: FabricRoll) => sum + (Number(roll.length) || 0), 0));
              } else if (boxAllocations.length > 0 && prod.boxes) {
                prod.stock = roundQty(prod.boxes.reduce((sum: number, box: any) => sum + (Number(box.quantity) || 0), 0));
              } else {
                prod.stock = roundQty(Math.max(0, Number(prod.stock || 0) - qtyToDeduct));
              }
            }
            reservationEntry!.data.status = "committed";
            reservationEntry!.data.committedAt = new Date().toISOString();
          } else if (item.selectedRollId && prod.rolls) {
            const roll = prod.rolls.find((r: FabricRoll) => r.id === item.selectedRollId);
            if (!roll) throw new Error(`Kumaş topu bulunamadı: ID ${item.selectedRollId}`);
            if (roll.status !== "available") throw new Error(`Seçilen kumaş topu satışa uygun değil: ${roll.rollNumber}`);
            const currentLen = Number(roll.length);
            if (currentLen - Number(roll.reservedLength || 0) < qtyToDeduct) {
              throw new Error(`Seçilen kumaş topunda (${roll.rollNumber}) yeterli kumaş kalmadı! Kalan: ${currentLen}m (Talep edilen: ${qtyToDeduct}m)`);
            }
            const initLen = roll.initialLength !== undefined ? Number(roll.initialLength) : currentLen;
            roll.initialLength = initLen;
            const updatedLen = roundQty(Math.max(0, currentLen - qtyToDeduct));
            roll.length = updatedLen;
            roll.soldLength = roundQty(Math.max(0, initLen - updatedLen));
            roll.status = updatedLen <= 0 ? "sold" : "available";
            rollAllocations.push({ rollId: roll.id, length: qtyToDeduct });
            prod.stock = roundQty(prod.rolls.reduce((sum: number, r: FabricRoll) => sum + (Number(r.length) || 0), 0));
          } else if (item.selectedBoxId && prod.boxes) {
            const box = prod.boxes.find((b: any) => b.id === item.selectedBoxId);
            if (!box) throw new Error(`Koli bulunamadı: ID ${item.selectedBoxId}`);
            if (box.status !== "available") throw new Error(`Seçilen koli satışa uygun değil: ${box.boxNumber}`);
            const currentQty = Number(box.quantity);
            if (currentQty - Number(box.reservedQuantity || 0) < qtyToDeduct) {
              throw new Error(`Seçilen kolide (${box.boxNumber}) yeterli serbest adet kalmadı! Kalan: ${roundQty(currentQty - Number(box.reservedQuantity || 0))} (Talep edilen: ${qtyToDeduct})`);
            }
            const initQty = box.initialQuantity !== undefined ? Number(box.initialQuantity) : currentQty;
            box.initialQuantity = initQty;
            const updatedQty = roundQty(Math.max(0, currentQty - qtyToDeduct));
            box.quantity = updatedQty;
            box.soldQuantity = roundQty((box.soldQuantity || 0) + qtyToDeduct);
            box.status = updatedQty <= 0 ? "depleted" : "available";
            boxAllocations.push({ boxId: box.id, quantity: qtyToDeduct });
            prod.stock = roundQty(prod.boxes.reduce((sum: number, b: any) => sum + (Number(b.quantity) || 0), 0));
          } else if (isRollTracked && prod.rolls && prod.rolls.length > 0) {
            const availableRollLength = prod.rolls
              .filter((r: FabricRoll) => r.status === "available")
              .reduce((sum: number, r: FabricRoll) => sum + Math.max(0, Number(r.length || 0) - Number(r.reservedLength || 0)), 0);
            if (availableRollLength < qtyToDeduct) {
              throw new Error(`Satışa uygun toplarda yeterli kumaş yok! Kullanılabilir: ${availableRollLength} m`);
            }

            let remainingDeduct = qtyToDeduct;
            for (const roll of prod.rolls as FabricRoll[]) {
              const currentLen = Number(roll.length) || 0;
              const freeLen = Math.max(0, currentLen - Number(roll.reservedLength || 0));
              if (roll.status === "available" && freeLen > 0 && remainingDeduct > 0) {
                const dec = roundQty(Math.min(freeLen, remainingDeduct));
                remainingDeduct = roundQty(remainingDeduct - dec);
                const initLen = roll.initialLength !== undefined ? Number(roll.initialLength) : currentLen;
                roll.initialLength = initLen;
                const updatedLen = roundQty(Math.max(0, currentLen - dec));
                roll.length = updatedLen;
                roll.soldLength = roundQty(Math.max(0, initLen - updatedLen));
                roll.status = updatedLen <= 0 ? "sold" : "available";
                rollAllocations.push({ rollId: roll.id, length: dec });
              }
            }
            if (remainingDeduct > 0) {
              throw new Error(`Kumaş top kayıtlarında ${remainingDeduct} m eksik stok var. Satış iptal edildi.`);
            }
            prod.stock = roundQty(prod.rolls.reduce((sum: number, r: FabricRoll) => sum + (Number(r.length) || 0), 0));
          } else if (prod.boxes && prod.boxes.length > 0) {
            const availableBoxQuantity = prod.boxes
              .filter((b: any) => b.status === "available")
              .reduce((sum: number, b: any) => sum + Math.max(0, Number(b.quantity || 0) - Number(b.reservedQuantity || 0)), 0);
            if (availableBoxQuantity < qtyToDeduct) {
              throw new Error(`Satışa uygun kolilerde yeterli adet yok! Kullanılabilir: ${availableBoxQuantity}`);
            }

            let remainingDeduct = qtyToDeduct;
            for (const box of prod.boxes) {
              const currentQty = Number(box.quantity) || 0;
              const freeQty = Math.max(0, currentQty - Number(box.reservedQuantity || 0));
              if (box.status === "available" && freeQty > 0 && remainingDeduct > 0) {
                const dec = roundQty(Math.min(freeQty, remainingDeduct));
                remainingDeduct = roundQty(remainingDeduct - dec);
                const initQty = box.initialQuantity !== undefined ? Number(box.initialQuantity) : currentQty;
                box.initialQuantity = initQty;
                const updatedQty = roundQty(Math.max(0, currentQty - dec));
                box.quantity = updatedQty;
                box.soldQuantity = roundQty((box.soldQuantity || 0) + dec);
                box.status = updatedQty <= 0 ? "depleted" : "available";
                boxAllocations.push({ boxId: box.id, quantity: dec });
              }
            }
            if (remainingDeduct > 0) {
              throw new Error(`Koli kayıtlarında ${remainingDeduct} adet eksik stok var. Satış iptal edildi.`);
            }
            prod.stock = roundQty(prod.boxes.reduce((sum: number, b: any) => sum + (Number(b.quantity) || 0), 0));
          } else {
            if (prod.stock - Number(prod.reservedStock || 0) < qtyToDeduct) {
              throw new Error(`Stok Yetersiz: "${prod.name}" için kullanılabilir stok: ${roundQty(prod.stock - Number(prod.reservedStock || 0))}, istenen miktar: ${qtyToDeduct}`);
            }
            prod.stock = roundQty(Math.max(0, prod.stock - qtyToDeduct));
          }

          const newStock = roundQty(Number(prod.stock || 0));
          const lineTotal = round2(prod.price * lineQty);
          totalAmount = round2(totalAmount + lineTotal);
          const itemUnit = isRollTracked ? "Metre" : (prod.unit || "Adet");

          const cleanSaleItem: any = {
            productId: item.productId,
            productName: prod.name,
            name: prod.name,
            quantity: lineQty,
            price: prod.price,
            unit: itemUnit
          };
          if (item.selectedRollId) cleanSaleItem.selectedRollId = item.selectedRollId;
          if (item.selectedBoxId) cleanSaleItem.selectedBoxId = item.selectedBoxId;
          if (item.cutLength !== undefined) cleanSaleItem.cutLength = roundQty(Number(item.cutLength));
          if (rollAllocations.length > 0) cleanSaleItem.rollAllocations = rollAllocations;
          if (boxAllocations.length > 0) cleanSaleItem.boxAllocations = boxAllocations;
          if (groupProductAllocations.length > 0) cleanSaleItem.productAllocations = groupProductAllocations;
          saleItems.push(cleanSaleItem);

          if (groupProductAllocations.length === 0) {
          const movementDocId = `${saleRef.id}_mov_${i}_${item.productId}`;
          const cleanMovement: any = {
            id: movementDocId,
            tenantId: context.tenantId,
            userId: uid,
            productId: item.productId,
            productName: prod.name,
            type: isRollTracked ? "roll_cut" : "out",
            quantity: lineQty,
            previousStock,
            newStock,
            unit: itemUnit,
            referenceType: "sale",
            referenceId: saleRef.id,
            timestamp: new Date().toISOString(),
            notes: isRollTracked
              ? `Satış Fişi #${saleRef.id} - Kumaş metraj çıkışı`
              : (item.selectedBoxId || boxAllocations.length > 0
                ? `Satış Fişi #${saleRef.id} - Koli çıkışı`
                : `Satış Fişi #${saleRef.id}`)
          };
          if (prod.warehouseId) cleanMovement.warehouseId = prod.warehouseId;
          stockMovementsToCreate.push(cleanMovement);
          }
        }

        const paidAmountVal = round2(Number(amountPaid || 0));
        const normalizedMethod = normalizePaymentMethod(paymentMethod);

        const newSaleDocData = {
          userId: uid,
          tenantId: context.tenantId,
          items: saleItems,
          totalAmount,
          amountPaid: paidAmountVal,
          customerId: customerId || null,
          paymentMethod: normalizedMethod,
          timestamp: new Date().toISOString(),
          status: "Tamamlandı" as const,
          stockDeducted: true,
          stockRestored: false,
          idempotencyKey: idempotencyKey || null
        };

        // Writes commit
        for (const [pId, updatedProd] of workingProducts.entries()) {
          const pDocRef = doc(this.db, "products", pId);
          transaction.update(pDocRef, {
            stock: updatedProd.stock,
            reservedStock: Number(updatedProd.reservedStock || 0),
            ...(updatedProd.rolls ? { rolls: updatedProd.rolls } : {}),
            ...(updatedProd.boxes ? { boxes: updatedProd.boxes } : {})
          });
        }

        for (const [reservationId, entry] of reservationDocsMap.entries()) {
          if (entry.data.status === "committed") {
            transaction.update(entry.ref, { status: "committed", committedAt: entry.data.committedAt || newSaleDocData.timestamp });
          }
        }

        transaction.set(saleRef, newSaleDocData);

        // Stock Movements atomic transaction writes (with accurate previous/new stock)
        for (const mov of stockMovementsToCreate) {
          mov.timestamp = newSaleDocData.timestamp;
          const movementRef = doc(this.db, "stock_movements", mov.id);
          transaction.set(movementRef, mov);
        }

        if (customerId && customerRef && customerData) {
          const transactions = [...(customerData.transactions || [])];
          let totalDebt = round2(Number(customerData.totalDebt || 0) + totalAmount);
          let totalPaid = round2(Number(customerData.totalPaid || 0));

          transactions.unshift({
            id: "T_P_" + saleRef.id,
            type: "sale",
            amount: totalAmount,
            description: `Satış Alımı (Fiş: #${saleRef.id})`,
            timestamp: newSaleDocData.timestamp
          });

          if (paidAmountVal > 0) {
            transactions.unshift({
              id: "T_P_PAY_" + saleRef.id,
              type: "payment",
              amount: paidAmountVal,
              description: `Satış Ödemesi (Fiş: #${saleRef.id})`,
              timestamp: newSaleDocData.timestamp
            });
            totalDebt = round2(Math.max(0, totalDebt - paidAmountVal));
            totalPaid = round2(totalPaid + paidAmountVal);
          }

          transaction.update(customerRef, {
            totalDebt,
            totalPaid,
            transactions
          });
        }

        // Atomic Payment collection write (if amountPaid > 0)
        if (paidAmountVal > 0) {
          const paymentDocId = `${saleRef.id}_pay`;
          const paymentRef = doc(this.db, "payments", paymentDocId);

          const paymentData: any = {
            id: paymentDocId,
            tenantId: context.tenantId,
            userId: uid,
            type: "incoming",
            amount: paidAmountVal,
            paymentMethod: normalizedMethod,
            timestamp: newSaleDocData.timestamp,
            description: customerData
              ? `Satış Tahsilatı (Fiş: #${saleRef.id} - ${customerData.name})`
              : `Peşin Satış Tahsilatı (Fiş: #${saleRef.id})`,
            receiptNo: saleRef.id
          };
          if (customerId) paymentData.customerId = customerId;
          if (customerData?.name) paymentData.customerName = customerData.name;
          else if (!customerId) paymentData.customerName = "Peşin / Anonim Müşteri";

          transaction.set(paymentRef, paymentData);
        }

        return {
          id: saleRef.id,
          ...newSaleDocData
        } as Sale;
      });

      if (!isIdempotentHit) {
        await logAuditEvent(uid, {
          action: "SALE_CREATED",
          entityType: "sale",
          entityId: saleResult.id,
          companyId: context.tenantId,
          details: { 
            totalAmount: saleResult.totalAmount, 
            amountPaid: round2(Number(amountPaid || 0)),
            itemsCount: saleResult.items.length, 
            customerId,
            paymentMethod: normalizePaymentMethod(paymentMethod)
          }
        }, this.db);

        if (round2(Number(amountPaid || 0)) > 0) {
          await logAuditEvent(uid, {
            action: "PAYMENT_RECEIVED",
            entityType: customerId ? "customer" : "sale",
            entityId: `${saleResult.id}_pay`,
            companyId: context.tenantId,
            details: {
              amount: round2(Number(amountPaid || 0)),
              type: "incoming",
              method: normalizePaymentMethod(paymentMethod),
              saleId: saleResult.id,
              customerId
            }
          }, this.db);
        }

        memoryCache.invalidate("sales_");
        memoryCache.invalidate("products_");
        memoryCache.invalidate("customers_");
        memoryCache.invalidate("payments_");
        memoryCache.invalidate("stock_movements_");
      }

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

  /**
   * FAZ 14: Atomic Sale Cancellation & Stock Restoration with Idempotency & RBAC
   */
  async cancelSale(saleId: string, uidParam?: string, reason?: string, idempotencyKey?: string): Promise<Sale> {
    const validUid = uidParam 
      ? assertAuthenticated(uidParam, "SalesRepository.cancelSale") 
      : getAuthenticatedUid("SalesRepository.cancelSale");
    return this.cancelAtomic(validUid, { saleId, reason, idempotencyKey });
  }

  async cancelAtomic(uid: string, params: CancelSaleParams): Promise<Sale> {
    const validUid = assertAuthenticated(uid, "SalesRepository.cancelAtomic");
    const { saleId, reason, idempotencyKey } = params;

    const context = await this.userRepo.getOrCreateContext(validUid);

    // RBAC: Cancellation is restricted strictly to Owner and Admin!
    if (context.role !== "owner" && context.role !== "admin") {
      throw new Error("Yetkilendirme Hatası: Satış iptali yalnızca 'owner' veya 'admin' yetkisine sahip kullanıcılar tarafından yapılabilir.");
    }

    const now = new Date().toISOString();

    // -------------------------------------------------------------
    // 1. DEMO MODE EXECUTION
    // -------------------------------------------------------------
    if (isDemoUser(validUid)) {
      const salesList = getLocal<Sale[]>("stokpro_demo_sales", SEED_SALES);
      const saleIndex = salesList.findIndex(s => s.id === saleId);
      if (saleIndex === -1) {
        throw new Error(`Satış fişi bulunamadı: ${saleId}`);
      }

      const sale = { ...salesList[saleIndex] };

      // Multi-Tenant Isolation Check (MANDATORY before idempotency check)
      if (sale.tenantId && sale.tenantId !== context.tenantId) {
        throw new Error("Yetkisiz işlem: Bu satış kaydına erişim izniniz bulunmuyor.");
      }

      // Idempotency: If already cancelled, do not increment stocks again!
      if (sale.status === "İptal Edildi" || sale.stockRestored === true || sale.manualReconciliationRequired === true) {
        console.warn(`[FirebaseSalesRepository] Sale already cancelled in demo: ${saleId}`);
        return sale;
      }

      // Special rule: Legacy sales without proven stock deduction
      if (sale.stockDeducted !== true) {
        console.warn(`[FirebaseSalesRepository] Legacy sale cancel - stock deduction not verified: ${saleId}`);
        sale.status = "İptal Edildi";
        sale.stockRestored = false;
        sale.manualReconciliationRequired = true;
        sale.cancelledAt = now;
        sale.cancelledBy = validUid;
        sale.cancelReason = reason || "Eski satış iptali (Manuel stok kontrolü gereklidir)";
        sale.cancelIdempotencyKey = idempotencyKey || undefined;

        salesList[saleIndex] = sale;
        setLocal("stokpro_demo_sales", salesList);
        memoryCache.invalidate("sales_");

        await logAuditEvent(validUid, {
          action: "SALE_CANCELLED",
          entityType: "sale",
          entityId: saleId,
          companyId: context.tenantId,
          details: { totalAmount: sale.totalAmount, unverifiedStock: true }
        });

        return sale;
      }

      // Verified sale: Restore stocks and fabric rolls atomically
      const productsList = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const workingProducts: Product[] = JSON.parse(JSON.stringify(productsList));
      const movementsList = getLocal<StockMovement[]>("stokpro_demo_stock_movements", []);
      const reverseMovements: StockMovement[] = [];

      const hasUnallocatedLegacyPackageSale = sale.items.some((item) => {
        const prod = workingProducts.find(p => p.id === item.productId);
        if (!prod) return false;
        if (shouldShowRolls(prod) && prod.rolls && prod.rolls.length > 0) {
          return !item.selectedRollId && !item.selectedBoxId && !(item.rollAllocations && item.rollAllocations.length > 0);
        }
        if (prod.boxes && prod.boxes.length > 0) {
          return !item.selectedBoxId && !(item.boxAllocations && item.boxAllocations.length > 0);
        }
        return false;
      });

      if (hasUnallocatedLegacyPackageSale) {
        sale.status = "İptal Edildi";
        sale.stockRestored = false;
        sale.manualReconciliationRequired = true;
        sale.cancelledAt = now;
        sale.cancelledBy = validUid;
        sale.cancelReason = reason || "Eski FIFO satışında hangi top/koli kullanıldığı kayıtlı değil. Manuel stok kontrolü gereklidir.";
        sale.cancelIdempotencyKey = idempotencyKey || undefined;
        salesList[saleIndex] = sale;
        setLocal("stokpro_demo_sales", salesList);
        memoryCache.invalidate("sales_");
        await logAuditEvent(validUid, {
          action: "SALE_CANCELLED",
          entityType: "sale",
          entityId: saleId,
          companyId: context.tenantId,
          details: { totalAmount: sale.totalAmount, manualReconciliationRequired: true }
        });
        return sale;
      }

      for (let i = 0; i < sale.items.length; i++) {
        const item = sale.items[i];
        const prod = workingProducts.find(p => p.id === item.productId);
        if (!prod) continue;

        if (Array.isArray((item as any).productAllocations) && (item as any).productAllocations.length > 0) {
          for (const allocation of (item as any).productAllocations) {
            const source = workingProducts.find((entry) => entry.id === allocation.productId);
            if (!source) throw new Error("Satış iptali için kumaş top kaydı bulunamadı: " + allocation.productId);
            const sourcePreviousStock = roundQty(Number(source.stock || 0));
            const sourceRolls = allocation.rollAllocations || [];
            if (sourceRolls.length > 0 && source.rolls) {
              for (const rollAllocation of sourceRolls) {
                const roll = source.rolls.find((entry) => entry.id === rollAllocation.rollId);
                if (!roll) throw new Error("Satış iptali için kumaş topu bulunamadı: " + rollAllocation.rollId);
                const restoreLength = roundQty(Number(rollAllocation.length || 0));
                roll.length = roundQty(Number(roll.length || 0) + restoreLength);
                roll.soldLength = roundQty(Math.max(0, Number(roll.soldLength || 0) - restoreLength));
                if (roll.length > 0 && roll.status === "sold") roll.status = "available";
              }
              source.stock = roundQty(source.rolls.reduce((sum, roll) => sum + Number(roll.length || 0), 0));
            } else {
              source.stock = roundQty(Number(source.stock || 0) + Number(allocation.quantity || 0));
            }
            reverseMovements.push({
              id: saleId + "_cancel_mov_" + i + "_" + source.id,
              tenantId: context.tenantId,
              userId: validUid,
              productId: source.id,
              productName: source.name,
              warehouseId: source.warehouseId || undefined,
              type: "in",
              quantity: Number(allocation.quantity || 0),
              previousStock: sourcePreviousStock,
              newStock: source.stock,
              unit: "Metre",
              referenceType: "sale",
              referenceId: saleId,
              timestamp: now,
              notes: "Satış İptali - Kumaş top stok iadesi (Fiş: #" + saleId + ")"
            });
          }
          continue;
        }

        const qtyToRestore = roundQty(Number(item.quantity));
        const previousStock = roundQty(Number(prod.stock || 0));
        const rollId = (item as any).selectedRollId || (item as any).rollId;
        const boxId = (item as any).selectedBoxId || (item as any).boxId;

        if (item.rollAllocations && item.rollAllocations.length > 0 && prod.rolls) {
          for (const allocation of item.rollAllocations) {
            const roll = prod.rolls.find(r => r.id === allocation.rollId);
            if (!roll) throw new Error(`Satış iptali için kumaş topu bulunamadı: ${allocation.rollId}`);
            const restoreLength = roundQty(Number(allocation.length));
            const currentLength = Number(roll.length) || 0;
            const updatedLength = roundQty(currentLength + restoreLength);
            roll.length = updatedLength;
            roll.soldLength = roundQty(Math.max(0, (roll.soldLength || 0) - restoreLength));
            if (updatedLength > 0 && roll.status === "sold") roll.status = "available";
          }
          prod.stock = roundQty(prod.rolls.reduce((sum, roll) => sum + (Number(roll.length) || 0), 0));
        } else if (item.boxAllocations && item.boxAllocations.length > 0 && prod.boxes) {
          for (const allocation of item.boxAllocations) {
            const box = prod.boxes.find(b => b.id === allocation.boxId);
            if (!box) throw new Error(`Satış iptali için koli bulunamadı: ${allocation.boxId}`);
            const restoreQuantity = roundQty(Number(allocation.quantity));
            const currentQuantity = Number(box.quantity) || 0;
            const updatedQuantity = roundQty(currentQuantity + restoreQuantity);
            box.quantity = updatedQuantity;
            box.soldQuantity = roundQty(Math.max(0, (box.soldQuantity || 0) - restoreQuantity));
            if (updatedQuantity > 0 && box.status === "depleted") box.status = "available";
          }
          prod.stock = roundQty(prod.boxes.reduce((sum, box) => sum + (Number(box.quantity) || 0), 0));
        } else if (rollId && prod.rolls) {
          const roll = prod.rolls.find(r => r.id === rollId);
          if (!roll) throw new Error(`Satış iptali için kumaş topu bulunamadı: ${rollId}`);
          const currentLen = Number(roll.length);
          const updatedLen = roundQty(currentLen + qtyToRestore);
          roll.length = updatedLen;
          roll.soldLength = roundQty(Math.max(0, (roll.soldLength || 0) - qtyToRestore));
          if (updatedLen > 0 && roll.status === "sold") roll.status = "available";
          prod.stock = roundQty(prod.rolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));
        } else if (boxId && prod.boxes) {
          const box = prod.boxes.find(b => b.id === boxId);
          if (!box) throw new Error(`Satış iptali için koli bulunamadı: ${boxId}`);
          const currentQty = Number(box.quantity);
          const updatedQty = roundQty(currentQty + qtyToRestore);
          box.quantity = updatedQty;
          box.soldQuantity = roundQty(Math.max(0, (box.soldQuantity || 0) - qtyToRestore));
          if (updatedQty > 0 && box.status === "depleted") box.status = "available";
          prod.stock = roundQty(prod.boxes.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0));
        } else {
          prod.stock = roundQty(previousStock + qtyToRestore);
        }

        const movementDocId = `${saleId}_cancel_mov_${i}_${prod.id}`;
        reverseMovements.push({
          id: movementDocId,
          tenantId: context.tenantId,
          userId: validUid,
          productId: prod.id,
          productName: prod.name,
          warehouseId: prod.warehouseId || undefined,
          type: "in",
          quantity: qtyToRestore,
          previousStock,
          newStock: prod.stock,
          unit: shouldShowRolls(prod) ? "Metre" : (prod.unit || "Adet"),
          referenceType: "sale",
          referenceId: saleId,
          timestamp: now,
          notes: `Satış İptali - Stok İadesi (Fiş: #${saleId})`
        });
      }

      // Reconcile Customer Ledger if customer transaction was created
      if (sale.customerId) {
        const customersList = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
        const custIndex = customersList.findIndex(c => c.id === sale.customerId);
        if (custIndex !== -1) {
          const cust = { ...customersList[custIndex] };
          const hasSaleTx = (cust.transactions || []).some(t => t.id === `T_P_${sale.id}`);
          if (hasSaleTx) {
            const saleDebt = round2(Number(sale.totalAmount || 0));
            cust.totalDebt = round2(Math.max(0, (cust.totalDebt || 0) - saleDebt));
            cust.transactions = [
              {
                id: `T_SALE_CANCEL_${sale.id}`,
                type: "payment",
                amount: saleDebt,
                description: `Satış İptali - Bakiye Düzeltmesi (Fiş: #${sale.id})`,
                timestamp: now
              },
              ...(cust.transactions || [])
            ];
            customersList[custIndex] = cust;
            setLocal("stokpro_demo_customers", customersList);
          }
        }
      }

      sale.status = "İptal Edildi";
      sale.stockRestored = true;
      sale.cancelledAt = now;
      sale.cancelledBy = validUid;
      sale.cancelReason = reason || "Kullanıcı talebi ile iptal edildi";
      sale.cancelIdempotencyKey = idempotencyKey || undefined;

      salesList[saleIndex] = sale;
      setLocal("stokpro_demo_sales", salesList);
      setLocal("stokpro_demo_products", workingProducts);

      for (const mov of reverseMovements) {
        movementsList.unshift(mov);
      }
      setLocal("stokpro_demo_stock_movements", movementsList);

      memoryCache.invalidate("sales_");
      memoryCache.invalidate("products_");
      memoryCache.invalidate("customers_");
      memoryCache.invalidate("stock_movements_");

      await logAuditEvent(validUid, {
        action: "SALE_CANCELLED",
        entityType: "sale",
        entityId: saleId,
        companyId: context.tenantId,
        details: { totalAmount: sale.totalAmount, stockRestored: true }
      });

      return sale;
    }

    // -------------------------------------------------------------
    // 2. PRODUCTION FIRESTORE ACID TRANSACTION
    // -------------------------------------------------------------
    try {
      const saleRef = doc(this.db, "sales", saleId);

      const updatedSale = await runTransaction(this.db, async (transaction) => {
        // READ 1: Sale document
        const saleSnap = await transaction.get(saleRef);
        if (!saleSnap.exists()) {
          throw new Error(`Satış kaydı bulunamadı: ${saleId}`);
        }

        const saleData = saleSnap.data() as Sale;
        if (saleData.tenantId && saleData.tenantId !== context.tenantId) {
          throw new Error("Yetkisiz işlem: Bu satış kaydına erişim izniniz bulunmuyor.");
        }

        // Idempotency: If already cancelled, do not increment stocks again!
        if (saleData.status === "İptal Edildi" || saleData.stockRestored === true || saleData.manualReconciliationRequired === true) {
          console.warn(`[FirebaseSalesRepository] Sale already cancelled: ${saleId}`);
          return { id: saleSnap.id, ...saleData } as Sale;
        }

        // Special rule: Legacy sales without proven stock deduction
        if (saleData.stockDeducted !== true) {
          console.warn(`[FirebaseSalesRepository] Legacy sale cancel - stock deduction not verified: ${saleId}`);
          const updates = {
            status: "İptal Edildi" as const,
            stockRestored: false,
            manualReconciliationRequired: true,
            cancelledAt: now,
            cancelledBy: validUid,
            cancelReason: reason || "Eski satış iptali (Manuel stok kontrolü gereklidir)",
            cancelIdempotencyKey: idempotencyKey || null
          };
          transaction.update(saleRef, updates);
          return { id: saleSnap.id, ...saleData, ...updates } as Sale;
        }

        // READ 2: Unique products
        const uniqueProductIds = Array.from(new Set(saleData.items.flatMap((item: any) => [item.productId, ...((item.productAllocations || []).map((allocation: any) => allocation.productId))])));
        const productDocsMap = new Map<string, any>();

        for (const pId of uniqueProductIds) {
          const pRef = doc(this.db, "products", pId);
          const pSnap = await transaction.get(pRef);
          if (pSnap.exists()) {
            productDocsMap.set(pId, { ...pSnap.data(), id: pSnap.id });
          }
        }

        const hasUnallocatedLegacyPackageSale = saleData.items.some((item: any) => {
          if (Array.isArray(item.productAllocations) && item.productAllocations.length > 0) return false;
          const prod = productDocsMap.get(item.productId);
          if (!prod) return false;
          if (shouldShowRolls(prod) && prod.rolls && prod.rolls.length > 0) {
            return !item.selectedRollId && !item.selectedBoxId && !(item.rollAllocations && item.rollAllocations.length > 0);
          }
          if (prod.boxes && prod.boxes.length > 0) {
            return !item.selectedBoxId && !(item.boxAllocations && item.boxAllocations.length > 0);
          }
          return false;
        });

        if (hasUnallocatedLegacyPackageSale) {
          const updates = {
            status: "İptal Edildi" as const,
            stockRestored: false,
            manualReconciliationRequired: true,
            cancelledAt: now,
            cancelledBy: validUid,
            cancelReason: reason || "Eski FIFO satışında hangi top/koli kullanıldığı kayıtlı değil. Manuel stok kontrolü gereklidir.",
            cancelIdempotencyKey: idempotencyKey || null
          };
          transaction.update(saleRef, updates);
          return { id: saleSnap.id, ...saleData, ...updates } as Sale;
        }

        // READ 3: Customer if assigned
        let customerData: any = null;
        let customerRef: any = null;
        if (saleData.customerId) {
          customerRef = doc(this.db, "customers", saleData.customerId);
          const cSnap = await transaction.get(customerRef);
          if (cSnap.exists()) {
            customerData = cSnap.data();
          }
        }

        // CALCULATE: Working copies & stock additions
        const workingProducts = new Map<string, any>();
        for (const [pId, pData] of productDocsMap.entries()) {
          workingProducts.set(pId, JSON.parse(JSON.stringify(pData)));
        }

        const reverseMovements: StockMovement[] = [];

        for (let i = 0; i < saleData.items.length; i++) {
          const item = saleData.items[i];
          const prod = workingProducts.get(item.productId);
          if (!prod) continue;

          if (Array.isArray((item as any).productAllocations) && (item as any).productAllocations.length > 0) {
            for (const allocation of (item as any).productAllocations) {
              const source = workingProducts.get(allocation.productId);
              if (!source) throw new Error("Satış iptali için kumaş top kaydı bulunamadı: " + allocation.productId);
              const sourcePreviousStock = roundQty(Number(source.stock || 0));
              const sourceRolls = allocation.rollAllocations || [];
              if (sourceRolls.length > 0 && source.rolls) {
                for (const rollAllocation of sourceRolls) {
                  const roll = source.rolls.find((entry: FabricRoll) => entry.id === rollAllocation.rollId);
                  if (!roll) throw new Error("Satış iptali için kumaş topu bulunamadı: " + rollAllocation.rollId);
                  const restoreLength = roundQty(Number(rollAllocation.length || 0));
                  roll.length = roundQty(Number(roll.length || 0) + restoreLength);
                  roll.soldLength = roundQty(Math.max(0, Number(roll.soldLength || 0) - restoreLength));
                  if (roll.length > 0 && roll.status === "sold") roll.status = "available";
                }
                source.stock = roundQty(source.rolls.reduce((sum: number, roll: FabricRoll) => sum + Number(roll.length || 0), 0));
              } else {
                source.stock = roundQty(Number(source.stock || 0) + Number(allocation.quantity || 0));
              }
              const movementId = saleId + "_cancel_mov_" + i + "_" + source.id;
              const reverseMovement: any = {
                id: movementId,
                tenantId: context.tenantId,
                userId: validUid,
                productId: source.id,
                productName: source.name,
                type: "in",
                quantity: Number(allocation.quantity || 0),
                previousStock: sourcePreviousStock,
                newStock: source.stock,
                unit: "Metre",
                referenceType: "sale",
                referenceId: saleId,
                timestamp: now,
                notes: "Satış İptali - Kumaş top stok iadesi (Fiş: #" + saleId + ")"
              };
              if (source.warehouseId) reverseMovement.warehouseId = source.warehouseId;
              reverseMovements.push(reverseMovement);
            }
            continue;
          }

          const qtyToRestore = roundQty(Number(item.quantity));
          const previousStock = roundQty(Number(prod.stock || 0));
          const rollId = (item as any).selectedRollId || (item as any).rollId;
          const boxId = (item as any).selectedBoxId || (item as any).boxId;

          if (item.rollAllocations && item.rollAllocations.length > 0 && prod.rolls) {
            for (const allocation of item.rollAllocations) {
              const roll = prod.rolls.find((r: FabricRoll) => r.id === allocation.rollId);
              if (!roll) throw new Error(`Satış iptali için kumaş topu bulunamadı: ${allocation.rollId}`);
              const restoreLength = roundQty(Number(allocation.length));
              const currentLength = Number(roll.length) || 0;
              const updatedLength = roundQty(currentLength + restoreLength);
              roll.length = updatedLength;
              roll.soldLength = roundQty(Math.max(0, (roll.soldLength || 0) - restoreLength));
              if (updatedLength > 0 && roll.status === "sold") roll.status = "available";
            }
            prod.stock = roundQty(prod.rolls.reduce((sum: number, roll: FabricRoll) => sum + (Number(roll.length) || 0), 0));
          } else if (item.boxAllocations && item.boxAllocations.length > 0 && prod.boxes) {
            for (const allocation of item.boxAllocations) {
              const box = prod.boxes.find((b: any) => b.id === allocation.boxId);
              if (!box) throw new Error(`Satış iptali için koli bulunamadı: ${allocation.boxId}`);
              const restoreQuantity = roundQty(Number(allocation.quantity));
              const currentQuantity = Number(box.quantity) || 0;
              const updatedQuantity = roundQty(currentQuantity + restoreQuantity);
              box.quantity = updatedQuantity;
              box.soldQuantity = roundQty(Math.max(0, (box.soldQuantity || 0) - restoreQuantity));
              if (updatedQuantity > 0 && box.status === "depleted") box.status = "available";
            }
            prod.stock = roundQty(prod.boxes.reduce((sum: number, box: any) => sum + (Number(box.quantity) || 0), 0));
          } else if (rollId && prod.rolls) {
            const roll = prod.rolls.find((r: FabricRoll) => r.id === rollId);
            if (!roll) throw new Error(`Satış iptali için kumaş topu bulunamadı: ${rollId}`);
            const currentLen = Number(roll.length);
            const updatedLen = roundQty(currentLen + qtyToRestore);
            roll.length = updatedLen;
            roll.soldLength = roundQty(Math.max(0, (roll.soldLength || 0) - qtyToRestore));
            if (updatedLen > 0 && roll.status === "sold") roll.status = "available";
            prod.stock = roundQty(prod.rolls.reduce((sum: number, r: FabricRoll) => sum + (Number(r.length) || 0), 0));
          } else if (boxId && prod.boxes) {
            const box = prod.boxes.find((b: any) => b.id === boxId);
            if (!box) throw new Error(`Satış iptali için koli bulunamadı: ${boxId}`);
            const currentQty = Number(box.quantity);
            const updatedQty = roundQty(currentQty + qtyToRestore);
            box.quantity = updatedQty;
            box.soldQuantity = roundQty(Math.max(0, (box.soldQuantity || 0) - qtyToRestore));
            if (updatedQty > 0 && box.status === "depleted") box.status = "available";
            prod.stock = roundQty(prod.boxes.reduce((sum: number, b: any) => sum + (Number(b.quantity) || 0), 0));
          } else {
            prod.stock = roundQty(previousStock + qtyToRestore);
          }

          const movementDocId = `${saleId}_cancel_mov_${i}_${prod.id}`;
          const revMov: any = {
            id: movementDocId,
            tenantId: context.tenantId,
            userId: validUid,
            productId: prod.id,
            productName: prod.name,
            type: "in",
            quantity: qtyToRestore,
            previousStock,
            newStock: prod.stock,
            unit: shouldShowRolls(prod) ? "Metre" : (prod.unit || "Adet"),
            referenceType: "sale",
            referenceId: saleId,
            timestamp: now,
            notes: `Satış İptali - Stok İadesi (Fiş: #${saleId})`
          };
          if (prod.warehouseId) revMov.warehouseId = prod.warehouseId;
          reverseMovements.push(revMov);
        }

        const saleUpdates = {
          status: "İptal Edildi" as const,
          stockRestored: true,
          cancelledAt: now,
          cancelledBy: validUid,
          cancelReason: reason || "Kullanıcı talebi ile iptal edildi",
          cancelIdempotencyKey: idempotencyKey || null
        };

        // WRITES: 1. Sale document
        transaction.update(saleRef, saleUpdates);

        // WRITES: 2. Restored Products
        for (const [pId, updatedProd] of workingProducts.entries()) {
          const pDocRef = doc(this.db, "products", pId);
          transaction.update(pDocRef, {
            stock: updatedProd.stock,
            ...(updatedProd.rolls ? { rolls: updatedProd.rolls } : {}),
            ...(updatedProd.boxes ? { boxes: updatedProd.boxes } : {})
          });
        }

        // WRITES: 3. Reverse Stock Movements
        for (const mov of reverseMovements) {
          const mRef = doc(this.db, "stock_movements", mov.id);
          transaction.set(mRef, mov);
        }

        // WRITES: 4. Customer ledger compensating adjustment
        if (customerRef && customerData) {
          const hasSaleTx = (customerData.transactions || []).some((t: any) => t.id === `T_P_${saleId}`);
          if (hasSaleTx) {
            const saleDebt = round2(Number(saleData.totalAmount || 0));
            const newDebt = round2(Math.max(0, Number(customerData.totalDebt || 0) - saleDebt));
            const updatedTransactions = [
              {
                id: `T_SALE_CANCEL_${saleId}`,
                type: "payment" as const,
                amount: saleDebt,
                description: `Satış İptali - Bakiye Düzeltmesi (Fiş: #${saleId})`,
                timestamp: now
              },
              ...(customerData.transactions || [])
            ];
            transaction.update(customerRef, {
              totalDebt: newDebt,
              transactions: updatedTransactions
            });
          }
        }

        return {
          id: saleRef.id,
          ...saleData,
          ...saleUpdates
        } as Sale;
      });

      await logAuditEvent(validUid, {
        action: "SALE_CANCELLED",
        entityType: "sale",
        entityId: saleId,
        companyId: context.tenantId,
        details: { totalAmount: updatedSale.totalAmount, stockRestored: updatedSale.stockRestored }
      }, this.db);

      memoryCache.invalidate("sales_");
      memoryCache.invalidate("products_");
      memoryCache.invalidate("customers_");
      memoryCache.invalidate("stock_movements_");

      return updatedSale;
    } catch (err: any) {
      console.error("Firestore cancelSaleAtomic error:", err);
      if (err.message?.includes("Yetkilendirme") || err.message?.includes("bulunamadı")) {
        throw err;
      }
      if (err.code === "failed-precondition" || err.message?.includes("aborted")) {
        throw new Error("Satış veya stoklar eşzamanlı olarak başka bir işlem tarafından güncellendi. Lütfen tekrar deneyin.");
      }
      throw new Error(err.message || "Satış iptal edilirken beklenmedik bir hata meydana geldi.");
    }
  }
}
