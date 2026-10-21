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
            throw new Error(`Yetersiz Stok: "${prod.name}" için mevcut stok: ${prod.stock}, istenen miktar: ${qtyToDeduct}`);
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
            prod.stock = roundQty(prod.rolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));
          }
        }

        const newStock = roundQty(Number(prod.stock || 0));
        const lineTotal = round2(prod.price * lineQty);
        totalAmount = round2(totalAmount + lineTotal);

        saleItems.push({
          productId: item.productId,
          productName: prod.name,
          name: prod.name,
          quantity: lineQty,
          price: prod.price,
          selectedRollId: item.selectedRollId,
          cutLength: item.cutLength !== undefined ? roundQty(Number(item.cutLength)) : undefined
        });

        const movementDocId = `${scopedSaleId}_mov_${i}_${item.productId}`;
        demoMovementsToRecord.push({
          id: movementDocId,
          tenantId: context.tenantId,
          userId: uid,
          productId: item.productId,
          productName: prod.name,
          warehouseId: prod.warehouseId || undefined,
          type: item.selectedRollId ? "roll_cut" : "out",
          quantity: lineQty,
          previousStock,
          newStock,
          unit: prod.unit || (item.selectedRollId ? "metre" : "adet"),
          referenceType: "sale",
          referenceId: scopedSaleId,
          timestamp: new Date().toISOString(),
          notes: item.selectedRollId 
            ? `Satış Fişi #${scopedSaleId} - Kumaş Topu Kesimi (Top ID: ${item.selectedRollId})`
            : `Satış Fişi #${scopedSaleId}`
        });
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
        const uniqueProductIds = Array.from(new Set(items.map(i => i.productId)));
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

          if (item.selectedRollId && prod.rolls) {
            const roll = prod.rolls.find((r: FabricRoll) => r.id === item.selectedRollId);
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
            prod.stock = roundQty(prod.rolls.reduce((sum: number, r: FabricRoll) => sum + (Number(r.length) || 0), 0));
          } else {
            if (prod.stock < qtyToDeduct) {
              throw new Error(`Stok Yetersiz: "${prod.name}" için mevcut stok: ${prod.stock}, istenen miktar: ${qtyToDeduct}`);
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

          const newStock = roundQty(Number(prod.stock || 0));
          const lineTotal = round2(prod.price * lineQty);
          totalAmount = round2(totalAmount + lineTotal);

          const cleanSaleItem: any = {
            productId: item.productId,
            productName: prod.name,
            name: prod.name,
            quantity: lineQty,
            price: prod.price
          };
          if (item.selectedRollId) cleanSaleItem.selectedRollId = item.selectedRollId;
          if (item.cutLength !== undefined) cleanSaleItem.cutLength = roundQty(Number(item.cutLength));
          saleItems.push(cleanSaleItem);

          const movementDocId = `${saleRef.id}_mov_${i}_${item.productId}`;
          const cleanMovement: any = {
            id: movementDocId,
            tenantId: context.tenantId,
            userId: uid,
            productId: item.productId,
            productName: prod.name,
            type: item.selectedRollId ? "roll_cut" : "out",
            quantity: lineQty,
            previousStock,
            newStock,
            unit: prod.unit || (item.selectedRollId ? "metre" : "adet"),
            referenceType: "sale",
            referenceId: saleRef.id,
            timestamp: new Date().toISOString(),
            notes: item.selectedRollId 
              ? `Satış Fişi #${saleRef.id} - Kumaş Topu Kesimi (Top ID: ${item.selectedRollId})`
              : `Satış Fişi #${saleRef.id}`
          };
          if (prod.warehouseId) cleanMovement.warehouseId = prod.warehouseId;
          stockMovementsToCreate.push(cleanMovement);
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
            ...(updatedProd.rolls ? { rolls: updatedProd.rolls } : {})
          });
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
      if (sale.status === "İptal Edildi" || sale.stockRestored === true) {
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

      for (let i = 0; i < sale.items.length; i++) {
        const item = sale.items[i];
        const prod = workingProducts.find(p => p.id === item.productId);
        if (!prod) continue;

        const qtyToRestore = roundQty(Number(item.quantity));
        const previousStock = roundQty(Number(prod.stock || 0));
        const rollId = (item as any).selectedRollId || (item as any).rollId;

        if (rollId && prod.rolls) {
          const roll = prod.rolls.find(r => r.id === rollId);
          if (roll) {
            const currentLen = Number(roll.length);
            const updatedLen = roundQty(currentLen + qtyToRestore);
            roll.length = updatedLen;
            roll.soldLength = roundQty(Math.max(0, (roll.soldLength || 0) - qtyToRestore));
            if (roll.status === "sold" && updatedLen > 0) {
              roll.status = "available";
            }
            prod.stock = roundQty(prod.rolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));
          } else {
            prod.stock = roundQty(previousStock + qtyToRestore);
          }
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
          unit: prod.unit || (rollId ? "metre" : "adet"),
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
        if (saleData.status === "İptal Edildi" || saleData.stockRestored === true) {
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
        const uniqueProductIds = Array.from(new Set(saleData.items.map(i => i.productId)));
        const productDocsMap = new Map<string, any>();

        for (const pId of uniqueProductIds) {
          const pRef = doc(this.db, "products", pId);
          const pSnap = await transaction.get(pRef);
          if (pSnap.exists()) {
            productDocsMap.set(pId, { ...pSnap.data(), id: pSnap.id });
          }
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

          const qtyToRestore = roundQty(Number(item.quantity));
          const previousStock = roundQty(Number(prod.stock || 0));
          const rollId = (item as any).selectedRollId || (item as any).rollId;

          if (rollId && prod.rolls) {
            const roll = prod.rolls.find((r: FabricRoll) => r.id === rollId);
            if (roll) {
              const currentLen = Number(roll.length);
              const updatedLen = roundQty(currentLen + qtyToRestore);
              roll.length = updatedLen;
              roll.soldLength = roundQty(Math.max(0, (roll.soldLength || 0) - qtyToRestore));
              if (roll.status === "sold" && updatedLen > 0) {
                roll.status = "available";
              }
              prod.stock = roundQty(prod.rolls.reduce((sum: number, r: FabricRoll) => sum + (Number(r.length) || 0), 0));
            } else {
              prod.stock = roundQty(previousStock + qtyToRestore);
            }
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
            unit: prod.unit || (rollId ? "metre" : "adet"),
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
            ...(updatedProd.rolls ? { rolls: updatedProd.rolls } : {})
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
