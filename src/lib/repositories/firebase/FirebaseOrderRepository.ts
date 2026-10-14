import { 
  OrderRepository, 
  CreateOrderParams, 
  CancelOrderParams,
  ProcessOrderItemInput
} from "../interfaces";
import { 
  Order, 
  Product, 
  Customer, 
  StockMovement, 
  FabricRoll, 
  OrderItem 
} from "../../../types";
import { db } from "../../firebase";
import { 
  Firestore,
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  runTransaction
} from "firebase/firestore";
import { 
  getLocal, 
  setLocal, 
  SEED_PRODUCTS, 
  SEED_CUSTOMERS, 
  round2, 
  roundQty, 
  logAuditEvent 
} from "./helpers";
import { FirebaseUserRepository } from "./FirebaseUserRepository";
import { memoryCache } from "../../cache";
import { assertAuthenticated, isDemoUser, getAuthenticatedUid } from "../../authGuard";

export class FirebaseOrderRepository implements OrderRepository {
  private userRepo: FirebaseUserRepository;
  private db: Firestore;

  constructor(userRepo?: FirebaseUserRepository, customDb?: Firestore) {
    this.userRepo = userRepo || new FirebaseUserRepository(customDb);
    this.db = customDb || db;
  }

  async getAll(uid: string): Promise<Order[]> {
    const validUid = assertAuthenticated(uid, "OrderRepository.getAll");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const tenantId = context.tenantId;

    const cacheKey = `orders_${tenantId}`;
    const cached = memoryCache.get<Order[]>(cacheKey, 60000);
    if (cached) {
      return cached;
    }

    if (isDemoUser(validUid)) {
      const data = getLocal<Order[]>("stokpro_demo_orders", []);
      memoryCache.set(cacheKey, data);
      return data;
    }

    try {
      const q = query(collection(this.db, "orders"), where("tenantId", "==", tenantId));
      const snapshot = await getDocs(q);
      const orders: Order[] = [];
      snapshot.forEach((docSnap) => {
        orders.push({ id: docSnap.id, ...docSnap.data() } as Order);
      });
      // Sort newest first
      orders.sort((a, b) => new Date(b.orderDate || 0).getTime() - new Date(a.orderDate || 0).getTime());
      memoryCache.set(cacheKey, orders);
      return orders;
    } catch (err) {
      console.error("FirebaseOrderRepository getAll error:", err);
      throw err;
    }
  }

  async getById(id: string): Promise<Order | null> {
    const validUid = getAuthenticatedUid("OrderRepository.getById");

    if (isDemoUser(validUid)) {
      const list = getLocal<Order[]>("stokpro_demo_orders", []);
      return list.find(o => o.id === id) || null;
    }

    try {
      const docSnap = await getDoc(doc(this.db, "orders", id));
      if (!docSnap.exists()) return null;
      return { id: docSnap.id, ...docSnap.data() } as Order;
    } catch (err) {
      console.error("FirebaseOrderRepository getById error:", err);
      return null;
    }
  }

  async update(orderId: string, updates: Partial<Order>): Promise<void> {
    const validUid = getAuthenticatedUid("OrderRepository.update");
    memoryCache.invalidate("orders_");

    if (isDemoUser(validUid)) {
      const list = getLocal<Order[]>("stokpro_demo_orders", []);
      const updated = list.map(o => o.id === orderId ? { ...o, ...updates } : o);
      setLocal("stokpro_demo_orders", updated);
      return;
    }

    try {
      const docRef = doc(this.db, "orders", orderId);
      await updateDoc(docRef, updates);
    } catch (err) {
      console.error("FirebaseOrderRepository update error:", err);
      throw err;
    }
  }

  async delete(orderId: string): Promise<void> {
    const validUid = getAuthenticatedUid("OrderRepository.delete");
    const context = await this.userRepo.getOrCreateContext(validUid);

    // RBAC: Only owner or admin may delete
    if (context.role !== "owner" && context.role !== "admin") {
      throw new Error("Yetkilendirme Hatası: Sipariş silme yetkisi yalnızca 'owner' veya 'admin' rollerine aittir.");
    }

    memoryCache.invalidate("orders_");

    if (isDemoUser(validUid)) {
      const list = getLocal<Order[]>("stokpro_demo_orders", []);
      const existing = list.find(o => o.id === orderId);
      if (existing && existing.stockDeducted === true && existing.stockRestored !== true) {
        throw new Error("Güvenlik Engeli: Stokları düşülmüş aktif bir sipariş doğrudan silinemez. Stok ve denetim tutarlılığı için lütfen önce siparişi iptal ediniz.");
      }
      const filtered = list.filter(o => o.id !== orderId);
      setLocal("stokpro_demo_orders", filtered);
      return;
    }

    try {
      const docRef = doc(this.db, "orders", orderId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const orderData = snap.data() as Order;
        if (orderData.stockDeducted === true && orderData.stockRestored !== true) {
          throw new Error("Güvenlik Engeli: Stokları düşülmüş aktif bir sipariş doğrudan silinemez. Stok ve denetim tutarlılığı için lütfen önce siparişi iptal ediniz.");
        }
      }
      await deleteDoc(docRef);
    } catch (err) {
      console.error("FirebaseOrderRepository delete error:", err);
      throw err;
    }
  }

  /**
   * FAZ 13-A9-6-B: Atomic Order Creation with Stock Deduction & Idempotency
   */
  async createAtomic(uid: string, params: CreateOrderParams): Promise<Order> {
    const validUid = assertAuthenticated(uid, "OrderRepository.createAtomic");
    const { items, customerId, customerDetails, amountPaid, waybillNo, waybillDate, shipDate, notes, idempotencyKey } = params;

    if (!items || items.length === 0) {
      throw new Error("Sipariş için en az bir ürün seçilmelidir.");
    }

    const context = await this.userRepo.getOrCreateContext(validUid);
    const now = new Date().toISOString();

    // -------------------------------------------------------------
    // 1. DEMO MODE EXECUTION
    // -------------------------------------------------------------
    if (isDemoUser(validUid)) {
      const ordersList = getLocal<Order[]>("stokpro_demo_orders", []);
      const productsList = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const customersList = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
      const movementsList = getLocal<StockMovement[]>("stokpro_demo_stock_movements", []);

      const scopedOrderId = idempotencyKey 
        ? `${context.tenantId}_${idempotencyKey}` 
        : `O_${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

      // Idempotency check with payload validation
      if (idempotencyKey) {
        const existingOrder = ordersList.find(o => o.id === scopedOrderId || o.id === idempotencyKey);
        if (existingOrder) {
          // Payload validation
          const isSameCustomer = (existingOrder.customerId || null) === (customerId || null);
          const isSameItemsCount = existingOrder.items.length === items.length;
          let isSameItems = isSameItemsCount;
          if (isSameItemsCount) {
            for (let i = 0; i < items.length; i++) {
              const reqItem = items[i];
              const extItem = existingOrder.items[i];
              const reqQty = roundQty(reqItem.cutLength ?? reqItem.quantity);
              const extQty = roundQty(extItem.cutLength ?? extItem.quantity);
              if (reqItem.productId !== extItem.productId || reqQty !== extQty) {
                isSameItems = false;
                break;
              }
            }
          }

          if (!isSameCustomer || !isSameItems) {
            throw new Error("İşlem doğrulama hatası: Aynı işlem anahtarı (idempotencyKey) farklı sipariş parametreleriyle kullanılamaz.");
          }

          console.warn(`[FirebaseOrderRepository] Idempotent replay detected in demo for order key: ${idempotencyKey}`);
          return existingOrder;
        }
      }

      // Pre-validation: Deep copy products to ensure atomic all-or-nothing rollback
      const workingProducts: Product[] = JSON.parse(JSON.stringify(productsList));
      const resolvedOrderItems: OrderItem[] = [];
      const stockMovementsToCreate: StockMovement[] = [];
      let calculatedTotal = 0;

      // 1. Validate and deduct stocks in working copy
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const prod = workingProducts.find(p => p.id === item.productId);
        if (!prod) {
          throw new Error(`Ürün bulunamadı: ID ${item.productId}`);
        }

        const qty = roundQty(Number(item.quantity));
        const rollId = item.selectedRollId;
        const cutLen = item.cutLength !== undefined ? roundQty(Number(item.cutLength)) : undefined;
        const qtyToDeduct = cutLen !== undefined ? cutLen : qty;

        if (isNaN(qtyToDeduct) || qtyToDeduct <= 0) {
          throw new Error(`Geçersiz sipariş miktarı: ${prod.name}`);
        }

        const previousStock = roundQty(Number(prod.stock || 0));

        if (rollId && prod.rolls) {
          const roll = prod.rolls.find(r => r.id === rollId);
          if (!roll) {
            throw new Error(`Kumaş topu bulunamadı: ID ${rollId}`);
          }
          const currentLen = Number(roll.length);
          if (currentLen < qtyToDeduct) {
            throw new Error(`Seçilen kumaş topunda (${roll.rollNumber}) yeterli miktar yok! Kalan: ${currentLen}m, İstenen: ${qtyToDeduct}m`);
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
            throw new Error(`Yetersiz stok! ${prod.name} için kalan: ${prod.stock}, İstenen: ${qtyToDeduct}`);
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

        const itemPrice = Number(item.price !== undefined ? item.price : prod.price);
        const lineTotal = round2(itemPrice * qty);
        calculatedTotal = round2(calculatedTotal + lineTotal);

        resolvedOrderItems.push({
          productId: prod.id,
          productName: prod.name,
          quantity: qty,
          price: itemPrice,
          rollId: rollId,
          rollNumber: rollId && prod.rolls ? prod.rolls.find(r => r.id === rollId)?.rollNumber : undefined,
          cutLength: cutLen
        });

        const movementDocId = `${scopedOrderId}_mov_${i}_${prod.id}`;
        stockMovementsToCreate.push({
          id: movementDocId,
          tenantId: context.tenantId,
          userId: validUid,
          productId: prod.id,
          productName: prod.name,
          warehouseId: prod.warehouseId || undefined,
          type: rollId ? "roll_cut" : "out",
          quantity: qtyToDeduct,
          previousStock,
          newStock: prod.stock,
          unit: prod.unit || (rollId ? "metre" : "adet"),
          referenceType: "order",
          referenceId: scopedOrderId,
          timestamp: now,
          notes: rollId 
            ? `Sipariş #${scopedOrderId} - Kumaş Topu Kesimi (Top ID: ${rollId})`
            : `Sipariş #${scopedOrderId} - Stok Düşümü`
        });
      }

      // 2. Create the Order object
      const orderNo = `SIP-${Math.floor(1000 + Math.random() * 9000)}`;
      const amountPaidVal = round2(Number(amountPaid || 0));

      const newOrder: Order = {
        id: scopedOrderId,
        tenantId: context.tenantId,
        orderNo,
        customerId: customerId || undefined,
        customerName: customerDetails?.name || (customerId ? "Kayıtlı Müşteri" : "Anonim Müşteri"),
        customerDetails: customerDetails || undefined,
        items: resolvedOrderItems,
        totalAmount: calculatedTotal,
        amountPaid: amountPaidVal,
        status: (waybillNo ? "Sevk Edildi" : "Sipariş Alındı") as Order["status"],
        orderDate: now,
        waybillNo: waybillNo || undefined,
        waybillDate: waybillDate || undefined,
        shipDate: shipDate || undefined,
        notes: notes || undefined,
        stockDeducted: true,
        stockRestored: false,
        idempotencyKey: idempotencyKey || undefined
      };

      // 3. Customer ledger link
      if (customerId) {
        const custIndex = customersList.findIndex(c => c.id === customerId);
        if (custIndex !== -1) {
          const cust = { ...customersList[custIndex] };
          cust.transactions = [...(cust.transactions || [])];
          let totalDebt = Number(cust.totalDebt || 0);
          let totalPaid = Number(cust.totalPaid || 0);

          cust.transactions.unshift({
            id: `T_ORD_${scopedOrderId}`,
            type: "sale",
            amount: calculatedTotal,
            description: `Sipariş Alımı (No: #${orderNo})`,
            timestamp: now
          });
          totalDebt = round2(totalDebt + calculatedTotal);

          if (amountPaidVal > 0) {
            cust.transactions.unshift({
              id: `T_ORD_PAY_${scopedOrderId}`,
              type: "payment",
              amount: amountPaidVal,
              description: `Sipariş Ödemesi (No: #${orderNo})`,
              timestamp: now
            });
            totalDebt = round2(Math.max(0, totalDebt - amountPaidVal));
            totalPaid = round2(totalPaid + amountPaidVal);
          }

          cust.totalDebt = totalDebt;
          cust.totalPaid = totalPaid;
          customersList[custIndex] = cust;
          setLocal("stokpro_demo_customers", customersList);
        }
      }

      // 4. Commit demo state atomically
      setLocal("stokpro_demo_products", workingProducts);
      ordersList.unshift(newOrder);
      setLocal("stokpro_demo_orders", ordersList);

      for (const mov of stockMovementsToCreate) {
        movementsList.unshift(mov);
      }
      setLocal("stokpro_demo_stock_movements", movementsList);

      memoryCache.invalidate("orders_");
      memoryCache.invalidate("products_");
      memoryCache.invalidate("customers_");
      memoryCache.invalidate("stock_movements_");

      await logAuditEvent(validUid, {
        action: "ORDER_CREATED",
        entityType: "order",
        entityId: scopedOrderId,
        companyId: context.tenantId,
        details: { 
          orderNo, 
          totalAmount: calculatedTotal, 
          amountPaid: amountPaidVal, 
          itemsCount: resolvedOrderItems.length,
          customerId 
        }
      });

      return newOrder;
    }

    // -------------------------------------------------------------
    // 2. PRODUCTION FIRESTORE ACID TRANSACTION
    // -------------------------------------------------------------
    try {
      const scopedOrderId = idempotencyKey 
        ? `${context.tenantId}_${idempotencyKey}` 
        : doc(collection(this.db, "orders")).id;
      const orderRef = doc(this.db, "orders", scopedOrderId);
      let isIdempotentHit = false;

      const orderResult = await runTransaction(this.db, async (transaction) => {
        isIdempotentHit = false;

        // READ 1: Idempotency check
        if (idempotencyKey) {
          const existingSnap = await transaction.get(orderRef);
          if (existingSnap.exists()) {
            const existingData = existingSnap.data() as Order;
            if (existingData.tenantId && existingData.tenantId !== context.tenantId) {
              throw new Error("Yetkisiz işlem: Bu sipariş kaydına erişim izniniz bulunmuyor.");
            }

            // Payload validation
            const isSameCustomer = (existingData.customerId || null) === (customerId || null);
            const isSameItemsCount = existingData.items.length === items.length;
            let isSameItems = isSameItemsCount;
            if (isSameItemsCount) {
              for (let i = 0; i < items.length; i++) {
                const reqItem = items[i];
                const extItem = existingData.items[i];
                const reqQty = roundQty(reqItem.cutLength ?? reqItem.quantity);
                const extQty = roundQty(extItem.cutLength ?? extItem.quantity);
                if (reqItem.productId !== extItem.productId || reqQty !== extQty) {
                  isSameItems = false;
                  break;
                }
              }
            }

            if (!isSameCustomer || !isSameItems) {
              throw new Error("İşlem doğrulama hatası: Aynı işlem anahtarı (idempotencyKey) farklı sipariş parametreleriyle kullanılamaz.");
            }

            console.warn(`[FirebaseOrderRepository] Idempotent replay detected in transaction for key: ${idempotencyKey}`);
            isIdempotentHit = true;
            return {
              id: existingSnap.id,
              ...existingData
            } as Order;
          }
        }

        // READ 2: Load all unique products
        const uniqueProductIds = Array.from(new Set(items.map(i => i.productId)));
        const productDocsMap = new Map<string, any>();

        for (const pId of uniqueProductIds) {
          const pRef = doc(this.db, "products", pId);
          const pSnap = await transaction.get(pRef);
          if (!pSnap.exists()) {
            throw new Error(`Ürün veri tabanında bulunamadı (ID: ${pId}).`);
          }
          const pData = pSnap.data();
          const isAuthorized = pData.userId === validUid || (pData.tenantId && pData.tenantId === context.tenantId);
          if (!isAuthorized) {
            throw new Error("Yetkisiz işlem: Bu ürüne erişim izniniz bulunmuyor.");
          }
          productDocsMap.set(pId, { ...pData, id: pSnap.id });
        }

        // READ 3: Load customer if assigned
        let customerData: any = null;
        let customerRef: any = null;
        if (customerId) {
          customerRef = doc(this.db, "customers", customerId);
          const cSnap = await transaction.get(customerRef);
          if (!cSnap.exists()) {
            throw new Error("Seçilen müşteri sistemde bulunamadı.");
          }
          customerData = cSnap.data();
          const isAuthorized = customerData.userId === validUid || (customerData.tenantId && customerData.tenantId === context.tenantId);
          if (!isAuthorized) {
            throw new Error("Yetkisiz işlem: Bu müşteri kaydına erişim izniniz bulunmuyor.");
          }
        }

        // CALCULATE: Working copies & validations
        const workingProducts = new Map<string, any>();
        for (const [pId, pData] of productDocsMap.entries()) {
          workingProducts.set(pId, JSON.parse(JSON.stringify(pData)));
        }

        const resolvedOrderItems: OrderItem[] = [];
        const stockMovementsToCreate: StockMovement[] = [];
        let calculatedTotal = 0;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const prod = workingProducts.get(item.productId);
          if (!prod) continue;

          const qty = roundQty(Number(item.quantity));
          const rollId = item.selectedRollId;
          const cutLen = item.cutLength !== undefined ? roundQty(Number(item.cutLength)) : undefined;
          const qtyToDeduct = cutLen !== undefined ? cutLen : qty;

          if (isNaN(qtyToDeduct) || qtyToDeduct <= 0) {
            throw new Error(`Geçersiz sipariş miktarı: ${prod.name}`);
          }

          const previousStock = roundQty(Number(prod.stock || 0));

          if (rollId && prod.rolls) {
            const roll = prod.rolls.find((r: FabricRoll) => r.id === rollId);
            if (!roll) throw new Error(`Kumaş topu bulunamadı: ID ${rollId}`);
            const currentLen = Number(roll.length);
            if (currentLen < qtyToDeduct) {
              throw new Error(`Seçilen kumaş topunda (${roll.rollNumber}) yeterli miktar yok! Kalan: ${currentLen}m, İstenen: ${qtyToDeduct}m`);
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
              throw new Error(`Yetersiz stok! "${prod.name}" için mevcut stok: ${prod.stock}, İstenen: ${qtyToDeduct}`);
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

          const itemPrice = Number(item.price !== undefined ? item.price : prod.price);
          const lineTotal = round2(itemPrice * qty);
          calculatedTotal = round2(calculatedTotal + lineTotal);

          const cleanOrderItem: any = {
            productId: prod.id,
            productName: prod.name,
            quantity: qty,
            price: itemPrice
          };
          if (rollId) {
            cleanOrderItem.rollId = rollId;
            const rollObj = prod.rolls ? prod.rolls.find((r: FabricRoll) => r.id === rollId) : null;
            if (rollObj?.rollNumber) cleanOrderItem.rollNumber = rollObj.rollNumber;
          }
          if (cutLen !== undefined) cleanOrderItem.cutLength = cutLen;
          resolvedOrderItems.push(cleanOrderItem);

          const movementDocId = `${scopedOrderId}_mov_${i}_${prod.id}`;
          const cleanMovement: any = {
            id: movementDocId,
            tenantId: context.tenantId,
            userId: validUid,
            productId: prod.id,
            productName: prod.name,
            type: rollId ? "roll_cut" : "out",
            quantity: qtyToDeduct,
            previousStock,
            newStock: prod.stock,
            unit: prod.unit || (rollId ? "metre" : "adet"),
            referenceType: "order",
            referenceId: scopedOrderId,
            timestamp: now,
            notes: rollId 
              ? `Sipariş #${scopedOrderId} - Kumaş Topu Kesimi (Top ID: ${rollId})`
              : `Sipariş #${scopedOrderId} - Stok Düşümü`
          };
          if (prod.warehouseId) cleanMovement.warehouseId = prod.warehouseId;
          stockMovementsToCreate.push(cleanMovement);
        }

        const orderNo = `SIP-${Math.floor(1000 + Math.random() * 9000)}`;
        const amountPaidVal = round2(Number(amountPaid || 0));

        const newOrderDocData = {
          userId: validUid,
          tenantId: context.tenantId,
          orderNo,
          customerId: customerId || null,
          customerName: customerDetails?.name || (customerId ? "Kayıtlı Müşteri" : "Anonim Müşteri"),
          customerDetails: customerDetails || null,
          items: resolvedOrderItems,
          totalAmount: calculatedTotal,
          amountPaid: amountPaidVal,
          status: (waybillNo ? "Sevk Edildi" : "Sipariş Alındı") as Order["status"],
          orderDate: now,
          waybillNo: waybillNo || null,
          waybillDate: waybillDate || null,
          shipDate: shipDate || null,
          notes: notes || null,
          stockDeducted: true,
          stockRestored: false,
          idempotencyKey: idempotencyKey || null
        };

        // WRITES: 1. Order document
        transaction.set(orderRef, newOrderDocData);

        // WRITES: 2. Updated Products
        for (const [pId, updatedProd] of workingProducts.entries()) {
          const pDocRef = doc(this.db, "products", pId);
          transaction.update(pDocRef, {
            stock: updatedProd.stock,
            ...(updatedProd.rolls ? { rolls: updatedProd.rolls } : {})
          });
        }

        // WRITES: 3. Stock Movements
        for (const mov of stockMovementsToCreate) {
          const mRef = doc(this.db, "stock_movements", mov.id);
          transaction.set(mRef, mov);
        }

        // WRITES: 4. Customer ledger
        if (customerId && customerRef && customerData) {
          const transactions = [...(customerData.transactions || [])];
          let totalDebt = round2(Number(customerData.totalDebt || 0) + calculatedTotal);
          let totalPaid = round2(Number(customerData.totalPaid || 0));

          transactions.unshift({
            id: `T_ORD_${scopedOrderId}`,
            type: "sale",
            amount: calculatedTotal,
            description: `Sipariş Alımı (No: #${orderNo})`,
            timestamp: now
          });

          if (amountPaidVal > 0) {
            transactions.unshift({
              id: `T_ORD_PAY_${scopedOrderId}`,
              type: "payment",
              amount: amountPaidVal,
              description: `Sipariş Ödemesi (No: #${orderNo})`,
              timestamp: now
            });
            totalDebt = round2(Math.max(0, totalDebt - amountPaidVal));
            totalPaid = round2(totalPaid + amountPaidVal);
          }

          transaction.update(customerRef, {
            totalDebt,
            totalPaid,
            transactions
          });
        }

        return {
          id: orderRef.id,
          ...newOrderDocData
        } as Order;
      });

      if (!isIdempotentHit) {
        await logAuditEvent(validUid, {
          action: "ORDER_CREATED",
          entityType: "order",
          entityId: orderResult.id,
          companyId: context.tenantId,
          details: { 
            orderNo: orderResult.orderNo, 
            totalAmount: orderResult.totalAmount, 
            amountPaid: orderResult.amountPaid, 
            itemsCount: orderResult.items.length,
            customerId 
          }
        }, this.db);

        memoryCache.invalidate("orders_");
        memoryCache.invalidate("products_");
        memoryCache.invalidate("customers_");
        memoryCache.invalidate("stock_movements_");
      }

      return orderResult;
    } catch (err: any) {
      console.error("Firestore createOrderAtomic error:", err);
      if (err.message?.includes("Yetersiz stok") || err.message?.includes("bulunamadı") || err.message?.includes("Yetkisiz") || err.message?.includes("doğrulama hatası")) {
        throw err;
      }
      if (err.code === "failed-precondition" || err.message?.includes("aborted")) {
        throw new Error("Stoklar eşzamanlı olarak başka bir işlem tarafından güncellendi. Lütfen tekrar deneyin.");
      }
      throw new Error(err.message || "Sipariş oluşturulurken beklenmedik bir hata meydana geldi.");
    }
  }

  /**
   * FAZ 13-A9-6-B: Atomic Order Cancellation with Stock Restoration & RBAC
   */
  async cancelOrderAtomic(orderId: string, uidParam?: string, reason?: string, idempotencyKey?: string): Promise<Order> {
    const validUid = uidParam 
      ? assertAuthenticated(uidParam, "OrderRepository.cancelOrderAtomic") 
      : getAuthenticatedUid("OrderRepository.cancelOrderAtomic");
    return this.cancelAtomic(validUid, { orderId, reason, idempotencyKey });
  }

  async cancelAtomic(uid: string, params: CancelOrderParams): Promise<Order> {
    const validUid = assertAuthenticated(uid, "OrderRepository.cancelAtomic");
    const { orderId, reason, idempotencyKey } = params;

    const context = await this.userRepo.getOrCreateContext(validUid);

    // RBAC: Cancellation is restricted strictly to Owner and Admin!
    if (context.role !== "owner" && context.role !== "admin") {
      throw new Error("Yetkilendirme Hatası: Sipariş iptali yalnızca 'owner' veya 'admin' yetkisine sahip kullanıcılar tarafından yapılabilir.");
    }

    const now = new Date().toISOString();

    // -------------------------------------------------------------
    // 1. DEMO MODE EXECUTION
    // -------------------------------------------------------------
    if (isDemoUser(validUid)) {
      const ordersList = getLocal<Order[]>("stokpro_demo_orders", []);
      const orderIndex = ordersList.findIndex(o => o.id === orderId);
      if (orderIndex === -1) {
        throw new Error(`Sipariş bulunamadı: ${orderId}`);
      }

      const order = { ...ordersList[orderIndex] };

      if (order.tenantId && order.tenantId !== context.tenantId) {
        throw new Error("Yetkisiz işlem: Bu sipariş kaydına erişim izniniz bulunmuyor.");
      }

      // Idempotency: If already cancelled, do not increment stocks again!
      if (order.status === "İptal Edildi") {
        console.warn(`[FirebaseOrderRepository] Order already cancelled in demo: ${orderId}`);
        return order;
      }

      if (order.stockRestored === true) {
        console.warn(`[FirebaseOrderRepository] Order stocks already restored in demo: ${orderId}`);
        return order;
      }

      // Special rule: Legacy orders without proven stock deduction
      if (order.stockDeducted !== true) {
        console.warn(`[FirebaseOrderRepository] Legacy order cancel - stock deduction not verified: ${orderId}`);
        order.status = "İptal Edildi";
        order.stockRestored = false;
        order.manualReconciliationRequired = true;
        order.cancelledAt = now;
        order.cancelledBy = validUid;
        order.cancelReason = reason || "Eski sipariş iptali (Manuel stok kontrolü gereklidir)";
        order.cancelIdempotencyKey = idempotencyKey || undefined;

        ordersList[orderIndex] = order;
        setLocal("stokpro_demo_orders", ordersList);
        memoryCache.invalidate("orders_");

        await logAuditEvent(validUid, {
          action: "ORDER_CANCELLED",
          entityType: "order",
          entityId: orderId,
          companyId: context.tenantId,
          details: { orderNo: order.orderNo, unverifiedStock: true }
        });

        return order;
      }

      // Verified order: Restore stocks and fabric rolls atomically
      const productsList = getLocal<Product[]>("stokpro_demo_products", SEED_PRODUCTS);
      const workingProducts: Product[] = JSON.parse(JSON.stringify(productsList));
      const movementsList = getLocal<StockMovement[]>("stokpro_demo_stock_movements", []);
      const reverseMovements: StockMovement[] = [];

      for (let i = 0; i < order.items.length; i++) {
        const item = order.items[i];
        const prod = workingProducts.find(p => p.id === item.productId);
        if (!prod) continue;

        const qtyToRestore = roundQty(item.cutLength !== undefined ? Number(item.cutLength) : Number(item.quantity));
        const previousStock = roundQty(Number(prod.stock || 0));

        if (item.rollId && prod.rolls) {
          const roll = prod.rolls.find(r => r.id === item.rollId);
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
            // Roll missing, restore general stock
            prod.stock = roundQty(previousStock + qtyToRestore);
          }
        } else {
          prod.stock = roundQty(previousStock + qtyToRestore);
        }

        const movementDocId = `${orderId}_cancel_mov_${i}_${prod.id}`;
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
          unit: prod.unit || (item.rollId ? "metre" : "adet"),
          referenceType: "order",
          referenceId: orderId,
          timestamp: now,
          notes: `Sipariş İptali - Stok İadesi (#${order.orderNo})`
        });
      }

      // Reconcile Customer Ledger if customer debt was added
      if (order.customerId) {
        const customersList = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
        const custIndex = customersList.findIndex(c => c.id === order.customerId);
        if (custIndex !== -1) {
          const cust = { ...customersList[custIndex] };
          const hasOrderTx = (cust.transactions || []).some(t => t.id === `T_ORD_${order.id}`);
          if (hasOrderTx) {
            const unpaidOrderDebt = round2(Number(order.totalAmount || 0) - Number(order.amountPaid || 0));
            cust.totalDebt = round2(Math.max(0, (cust.totalDebt || 0) - unpaidOrderDebt));
            cust.transactions = [
              {
                id: `T_ORD_CANCEL_${order.id}`,
                type: "payment",
                amount: unpaidOrderDebt,
                description: `Sipariş İptali - Kalan Borç Düşümü (#${order.orderNo})`,
                timestamp: now
              },
              ...(cust.transactions || [])
            ];
            customersList[custIndex] = cust;
            setLocal("stokpro_demo_customers", customersList);
          }
        }
      }

      // Update Order
      order.status = "İptal Edildi";
      order.stockRestored = true;
      order.cancelledAt = now;
      order.cancelledBy = validUid;
      order.cancelReason = reason || "Kullanıcı talebi ile iptal edildi";
      order.cancelIdempotencyKey = idempotencyKey || undefined;

      ordersList[orderIndex] = order;
      setLocal("stokpro_demo_orders", ordersList);
      setLocal("stokpro_demo_products", workingProducts);

      for (const mov of reverseMovements) {
        movementsList.unshift(mov);
      }
      setLocal("stokpro_demo_stock_movements", movementsList);

      memoryCache.invalidate("orders_");
      memoryCache.invalidate("products_");
      memoryCache.invalidate("customers_");
      memoryCache.invalidate("stock_movements_");

      await logAuditEvent(validUid, {
        action: "ORDER_CANCELLED",
        entityType: "order",
        entityId: orderId,
        companyId: context.tenantId,
        details: { orderNo: order.orderNo, stockRestored: true }
      });

      return order;
    }

    // -------------------------------------------------------------
    // 2. PRODUCTION FIRESTORE ACID TRANSACTION
    // -------------------------------------------------------------
    try {
      const orderRef = doc(this.db, "orders", orderId);

      const updatedOrder = await runTransaction(this.db, async (transaction) => {
        // READ 1: Order document
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error(`Sipariş bulunamadı: ${orderId}`);
        }

        const orderData = orderSnap.data() as Order;
        if (orderData.tenantId && orderData.tenantId !== context.tenantId) {
          throw new Error("Yetkisiz işlem: Bu sipariş kaydına erişim izniniz bulunmuyor.");
        }

        // Idempotency: If already cancelled, do not increment stocks again!
        if (orderData.status === "İptal Edildi") {
          console.warn(`[FirebaseOrderRepository] Order already cancelled: ${orderId}`);
          return { id: orderSnap.id, ...orderData } as Order;
        }

        if (orderData.stockRestored === true) {
          console.warn(`[FirebaseOrderRepository] Order stocks already restored: ${orderId}`);
          return { id: orderSnap.id, ...orderData } as Order;
        }

        // Special rule: Legacy orders without proven stock deduction
        if (orderData.stockDeducted !== true) {
          console.warn(`[FirebaseOrderRepository] Legacy order cancel - stock deduction not verified: ${orderId}`);
          const updates = {
            status: "İptal Edildi" as const,
            stockRestored: false,
            manualReconciliationRequired: true,
            cancelledAt: now,
            cancelledBy: validUid,
            cancelReason: reason || "Eski sipariş iptali (Manuel stok kontrolü gereklidir)",
            cancelIdempotencyKey: idempotencyKey || null
          };
          transaction.update(orderRef, updates);
          return { id: orderSnap.id, ...orderData, ...updates } as Order;
        }

        // READ 2: Unique products
        const uniqueProductIds = Array.from(new Set(orderData.items.map(i => i.productId)));
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
        if (orderData.customerId) {
          customerRef = doc(this.db, "customers", orderData.customerId);
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

        for (let i = 0; i < orderData.items.length; i++) {
          const item = orderData.items[i];
          const prod = workingProducts.get(item.productId);
          if (!prod) continue;

          const qtyToRestore = roundQty(item.cutLength !== undefined ? Number(item.cutLength) : Number(item.quantity));
          const previousStock = roundQty(Number(prod.stock || 0));

          if (item.rollId && prod.rolls) {
            const roll = prod.rolls.find((r: FabricRoll) => r.id === item.rollId);
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

          const movementDocId = `${orderId}_cancel_mov_${i}_${prod.id}`;
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
            unit: prod.unit || (item.rollId ? "metre" : "adet"),
            referenceType: "order",
            referenceId: orderId,
            timestamp: now,
            notes: `Sipariş İptali - Stok İadesi (#${orderData.orderNo})`
          };
          if (prod.warehouseId) revMov.warehouseId = prod.warehouseId;
          reverseMovements.push(revMov);
        }

        const orderUpdates = {
          status: "İptal Edildi" as const,
          stockRestored: true,
          cancelledAt: now,
          cancelledBy: validUid,
          cancelReason: reason || "Kullanıcı talebi ile iptal edildi",
          cancelIdempotencyKey: idempotencyKey || null
        };

        // WRITES: 1. Order document
        transaction.update(orderRef, orderUpdates);

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
        // WRITES: 4. Customer ledger compensating reversal
        if (customerRef && customerData) {
          const hasOrderTx = (customerData.transactions || []).some((t: any) => t.id === `T_ORD_${orderId}`);
          if (hasOrderTx) {
            const unpaidOrderDebt = round2(Number(orderData.totalAmount || 0) - Number(orderData.amountPaid || 0));
            const newDebt = round2(Math.max(0, Number(customerData.totalDebt || 0) - unpaidOrderDebt));
            const updatedTransactions = [
              {
                id: `T_ORD_CANCEL_${orderId}`,
                type: "payment" as const,
                amount: unpaidOrderDebt,
                description: `Sipariş İptali - Kalan Borç Düşümü (#${orderData.orderNo})`,
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
          id: orderRef.id,
          ...orderData,
          ...orderUpdates
        } as Order;
      });

      await logAuditEvent(validUid, {
        action: "ORDER_CANCELLED",
        entityType: "order",
        entityId: orderId,
        companyId: context.tenantId,
        details: { orderNo: updatedOrder.orderNo, stockRestored: updatedOrder.stockRestored }
      }, this.db);

      memoryCache.invalidate("orders_");
      memoryCache.invalidate("products_");
      memoryCache.invalidate("customers_");
      memoryCache.invalidate("stock_movements_");

      return updatedOrder;
    } catch (err: any) {
      console.error("Firestore cancelAtomic error:", err);
      if (err.message?.includes("Yetkilendirme") || err.message?.includes("bulunamadı")) {
        throw err;
      }
      if (err.code === "failed-precondition" || err.message?.includes("aborted")) {
        throw new Error("Sipariş veya stoklar eşzamanlı olarak başka bir işlem tarafından güncellendi. Lütfen tekrar deneyin.");
      }
      throw new Error(err.message || "Sipariş iptal edilirken beklenmedik bir hata meydana geldi.");
    }
  }
}
