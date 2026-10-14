import { CustomerRepository, ProcessCustomerPaymentParams, ProcessCustomerPaymentResult } from "../interfaces";
import { Customer, Payment, CustomerTransaction } from "../../../types";
import { db } from "../../firebase";
import { 
  Firestore,
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  runTransaction
} from "firebase/firestore";
import { getLocal, setLocal, SEED_CUSTOMERS, round2, logAuditEvent } from "./helpers";
import { FirebaseUserRepository } from "./FirebaseUserRepository";
import { memoryCache } from "../../cache";
import { assertAuthenticated, isDemoUser, getAuthenticatedUid } from "../../authGuard";

export class FirebaseCustomerRepository implements CustomerRepository {
  private userRepo: FirebaseUserRepository;
  private db: Firestore;

  constructor(userRepo?: FirebaseUserRepository, customDb?: Firestore) {
    this.userRepo = userRepo || new FirebaseUserRepository(customDb);
    this.db = customDb || db;
  }

  async getAll(uid: string): Promise<Customer[]> {
    const validUid = assertAuthenticated(uid, "CustomerRepository.getAll");
    const context = await this.userRepo.getOrCreateContext(validUid);
    const tenantId = context.tenantId;

    const cacheKey = `customers_${tenantId}`;
    const cached = memoryCache.get<Customer[]>(cacheKey, 60000);
    if (cached) {
      return cached;
    }

    if (isDemoUser(validUid)) {
      const data = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
      memoryCache.set(cacheKey, data);
      return data;
    }

    try {
      const q = query(collection(this.db, "customers"), where("tenantId", "==", tenantId));
      const snapshot = await getDocs(q);
      const customers: Customer[] = [];
      snapshot.forEach((docSnap) => {
        customers.push({ id: docSnap.id, ...docSnap.data() } as Customer);
      });
      memoryCache.set(cacheKey, customers);
      return customers;
    } catch (err) {
      console.error("FirebaseCustomerRepository getAll error:", err);
      throw err;
    }
  }

  async getById(id: string): Promise<Customer | null> {
    const validUid = getAuthenticatedUid("CustomerRepository.getById");

    if (isDemoUser(validUid)) {
      const list = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
      return list.find(c => c.id === id) || null;
    }

    try {
      const docSnap = await getDoc(doc(this.db, "customers", id));
      if (!docSnap.exists()) return null;
      return { id: docSnap.id, ...docSnap.data() } as Customer;
    } catch (err) {
      console.error("FirebaseCustomerRepository getById error:", err);
      return null;
    }
  }

  async create(uid: string, customer: Omit<Customer, "id">): Promise<Customer> {
    const validUid = assertAuthenticated(uid, "CustomerRepository.create");
    const context = await this.userRepo.getOrCreateContext(validUid);

    if (isDemoUser(validUid)) {
      const list = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
      const newId = "C_" + Math.random().toString(36).substring(2, 9).toUpperCase();
      const newCustomer = { id: newId, ...customer, tenantId: context.tenantId } as Customer;
      list.push(newCustomer);
      setLocal("stokpro_demo_customers", list);
      memoryCache.invalidate("customers_");
      return newCustomer;
    }

    try {
      const docRef = await addDoc(collection(this.db, "customers"), {
        ...customer,
        userId: validUid,
        tenantId: context.tenantId
      });
      memoryCache.invalidate("customers_");
      return { id: docRef.id, ...customer, tenantId: context.tenantId } as Customer;
    } catch (err) {
      console.error("FirebaseCustomerRepository create error:", err);
      throw err;
    }
  }

  async update(customerId: string, updates: Partial<Customer>): Promise<Customer | void> {
    const validUid = getAuthenticatedUid("CustomerRepository.update");
    memoryCache.invalidate("customers_");

    if (isDemoUser(validUid)) {
      const list = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
      const updated = list.map(c => c.id === customerId ? { ...c, ...updates } : c);
      setLocal("stokpro_demo_customers", updated);
      return updated.find(c => c.id === customerId);
    }

    try {
      const docRef = doc(this.db, "customers", customerId);
      await updateDoc(docRef, updates);
    } catch (err) {
      console.error("FirebaseCustomerRepository update error:", err);
      throw err;
    }
  }

  async delete(customerId: string): Promise<void> {
    const validUid = getAuthenticatedUid("CustomerRepository.delete");
    const context = await this.userRepo.getOrCreateContext(validUid);

    // RBAC: Only owner or admin may delete customer
    if (context.role !== "owner" && context.role !== "admin") {
      throw new Error("Yetkilendirme Hatası: Müşteri silme yetkisi yalnızca 'owner' veya 'admin' rollerine aittir.");
    }

    memoryCache.invalidate("customers_");

    if (isDemoUser(validUid)) {
      const list = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
      const existing = list.find(c => c.id === customerId);
      if (existing) {
        const debt = round2(Number(existing.totalDebt || 0));
        if (debt > 0) {
          throw new Error(`Güvenlik Engeli: Açık borcu bulunan müşteri (Borç: ${debt.toFixed(2)} TL) doğrudan silinemez. Lütfen önce cari hesap mutabakatını tamamlayınız.`);
        }
      }
      const filtered = list.filter(c => c.id !== customerId);
      setLocal("stokpro_demo_customers", filtered);
      return;
    }

    try {
      const cRef = doc(this.db, "customers", customerId);
      const snap = await getDoc(cRef);
      if (snap.exists()) {
        const cData = snap.data() as Customer;
        const debt = round2(Number(cData.totalDebt || 0));
        if (debt > 0) {
          throw new Error(`Güvenlik Engeli: Açık borcu bulunan müşteri (Borç: ${debt.toFixed(2)} TL) doğrudan silinemez. Lütfen önce cari hesap mutabakatını tamamlayınız.`);
        }
      }
      await deleteDoc(cRef);
    } catch (err) {
      console.error("FirebaseCustomerRepository delete error:", err);
      throw err;
    }
  }

  /**
   * FAZ 13-A9-4A: Atomic Customer Payment / Ledger Transaction with Idempotency Protection
   * Executes customer debt/paid/transactions updates and independent `payments` record
   * within a single, isolated Firestore ACID transaction.
   */
  async processPaymentTransaction(
    uid: string, 
    params: ProcessCustomerPaymentParams
  ): Promise<ProcessCustomerPaymentResult> {
    const validUid = assertAuthenticated(uid, "CustomerRepository.processPaymentTransaction");
    const context = await this.userRepo.getOrCreateContext(validUid);

    const val = round2(Number(params.amount));
    if (isNaN(val) || val <= 0) {
      throw new Error("Geçersiz işlem miktarı.");
    }

    if (params.type !== "payment" && params.type !== "sale") {
      throw new Error(`Desteklenmeyen işlem türü: ${params.type}`);
    }

    const timestamp = new Date().toISOString();
    const paymentMethod = params.paymentMethod || "nakit";
    const isPayment = params.type === "payment";

    // -----------------------------------------------------------------
    // 1. DEMO MODE EXECUTION
    // -----------------------------------------------------------------
    if (isDemoUser(validUid)) {
      const customersList = getLocal<Customer[]>("stokpro_demo_customers", SEED_CUSTOMERS);
      const customerIndex = customersList.findIndex(c => c.id === params.customerId);
      if (customerIndex === -1) {
        throw new Error(`Müşteri bulunamadı: ${params.customerId}`);
      }
      const customer = { ...customersList[customerIndex] };

      // Overpayment check for CRM tahsilat
      const currentDebt = round2(Number(customer.totalDebt || 0));
      if (isPayment) {
        if (currentDebt <= 0) {
          throw new Error("Müşterinin ödenmemiş borcu bulunmamaktadır.");
        }
        if (val > currentDebt) {
          throw new Error(`Tahsilat tutarı (${val.toFixed(2)} TL) mevcut borçtan (${currentDebt.toFixed(2)} TL) fazla olamaz.`);
        }
      }

      // Idempotency check for demo mode
      if (params.idempotencyKey) {
        const demoPayments = getLocal<Payment[]>("stokpro_demo_payments", []);
        const deterministicPayId = `pay_demo_${context.tenantId}_${params.idempotencyKey}`;
        const existingPayment = demoPayments.find(p => p.id === deterministicPayId);
        const existingTx = (customer.transactions || []).find(
          t => t.id === params.idempotencyKey || t.id === `T_${params.idempotencyKey}`
        );

        if (existingPayment) {
          // Payload validation
          const isSameCustomer = existingPayment.customerId === params.customerId;
          const isSameAmount = round2(Number(existingPayment.amount)) === val;
          const isSameMethod = (existingPayment.paymentMethod || "nakit") === paymentMethod;

          if (!isSameCustomer || !isSameAmount || !isSameMethod) {
            throw new Error("İşlem doğrulama hatası: Aynı işlem anahtarı (idempotencyKey) farklı parametrelerle kullanılamaz.");
          }

          console.warn(`[FirebaseCustomerRepository] Idempotent replay detected in demo for key: ${params.idempotencyKey}`);
          return {
            customer,
            payment: existingPayment,
            isDuplicate: true
          };
        }

        if (existingTx) {
          // Payload validation for customer transaction
          const isSameAmount = round2(Number(existingTx.amount)) === val;
          const isSameType = existingTx.type === params.type;

          if (!isSameAmount || !isSameType) {
            throw new Error("İşlem doğrulama hatası: Aynı işlem anahtarı (idempotencyKey) farklı parametrelerle kullanılamaz.");
          }

          console.warn(`[FirebaseCustomerRepository] Idempotent transaction replay detected in demo for key: ${params.idempotencyKey}`);
          return {
            customer,
            isDuplicate: true
          };
        }
      }

      const transId = params.idempotencyKey 
        ? `T_${params.idempotencyKey}` 
        : `T${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      let newDebt = currentDebt;
      let newPaid = Number(customer.totalPaid || 0);
      let paymentRecord: Payment | undefined = undefined;

      if (isPayment) {
        newDebt = round2(Math.max(0, newDebt - val));
        newPaid = round2(newPaid + val);

        const payId = params.idempotencyKey 
          ? `pay_demo_${context.tenantId}_${params.idempotencyKey}` 
          : `PAY_${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

        paymentRecord = {
          id: payId,
          tenantId: context.tenantId,
          userId: validUid,
          customerId: customer.id,
          customerName: customer.name,
          type: "incoming",
          amount: val,
          paymentMethod,
          timestamp,
          description: params.description?.trim() || "Tahsilat Ödemesi",
          receiptNo: transId
        };

        const demoPayments = getLocal<Payment[]>("stokpro_demo_payments", []);
        demoPayments.push(paymentRecord);
        setLocal("stokpro_demo_payments", demoPayments);
      } else {
        newDebt = round2(newDebt + val);
      }

      const newTx: CustomerTransaction = {
        id: transId,
        type: params.type,
        amount: val,
        description: params.description?.trim() || (isPayment ? "Tahsilat Ödemesi" : "Borç Kaydı"),
        timestamp
      };

      customer.totalDebt = newDebt;
      customer.totalPaid = newPaid;
      customer.transactions = [newTx, ...(customer.transactions || [])];

      customersList[customerIndex] = customer;
      setLocal("stokpro_demo_customers", customersList);

      memoryCache.invalidate("customers_");
      memoryCache.invalidate("payments_");

      await logAuditEvent(validUid, {
        action: isPayment ? "PAYMENT_RECEIVED" : "SALE_CREATED",
        entityType: "customer",
        entityId: customer.id,
        companyId: context.tenantId,
        details: { amount: val, type: params.type, paymentMethod, isPayment }
      });

      return {
        customer,
        payment: paymentRecord,
        isDuplicate: false
      };
    }

    // -----------------------------------------------------------------
    // 2. PRODUCTION MODE: STRICT ATOMIC FIRESTORE RUNTRANSACTION
    // -----------------------------------------------------------------
    try {
      const result = await runTransaction(this.db, async (transaction) => {
        // STEP 1: READ PHASE
        const customerRef = doc(this.db, "customers", params.customerId);
        const customerDoc = await transaction.get(customerRef);

        if (!customerDoc.exists()) {
          throw new Error(`Müşteri bulunamadı: ${params.customerId}`);
        }

        const customerData = customerDoc.data() as Customer;

        // Tenant safety check
        if (customerData.tenantId && customerData.tenantId !== context.tenantId && (customerData as any).userId !== validUid) {
          throw new Error("Bu müşteriye ait işlem yapma yetkiniz bulunmuyor.");
        }

        // Overpayment check for CRM tahsilat
        const currentDebt = round2(Number(customerData.totalDebt || 0));
        if (isPayment) {
          if (currentDebt <= 0) {
            throw new Error("Müşterinin ödenmemiş borcu bulunmamaktadır.");
          }
          if (val > currentDebt) {
            throw new Error(`Tahsilat tutarı (${val.toFixed(2)} TL) mevcut borçtan (${currentDebt.toFixed(2)} TL) fazla olamaz.`);
          }
        }

        // Idempotency check: Read existing payment doc if key provided
        let paymentRef: any = null;

        if (isPayment) {
          if (params.idempotencyKey) {
            const deterministicPaymentId = `pay_${context.tenantId}_${params.idempotencyKey}`;
            paymentRef = doc(this.db, "payments", deterministicPaymentId);
            const existingPaymentDoc = await transaction.get(paymentRef);

            if (existingPaymentDoc.exists()) {
              const existingPayData = (existingPaymentDoc.data() || {}) as Payment;

              // Payload validation
              const isSameCustomer = existingPayData.customerId === customerDoc.id;
              const isSameAmount = round2(Number(existingPayData.amount)) === val;
              const isSameMethod = (existingPayData.paymentMethod || "nakit") === paymentMethod;

              if (!isSameCustomer || !isSameAmount || !isSameMethod) {
                throw new Error("İşlem doğrulama hatası: Aynı işlem anahtarı (idempotencyKey) farklı parametrelerle kullanılamaz.");
              }

              console.warn(`[FirebaseCustomerRepository] Idempotent replay detected in transaction for key: ${params.idempotencyKey}`);
              return {
                customer: { id: customerDoc.id, ...customerData } as Customer,
                payment: { id: existingPaymentDoc.id, ...existingPayData } as Payment,
                isDuplicate: true
              };
            }
          } else {
            paymentRef = doc(collection(this.db, "payments"));
          }
        }

        // Check if customer transaction already contains this transaction/idempotencyKey
        const existingTx = (customerData.transactions || []).find(
          t => (params.idempotencyKey && (t.id === params.idempotencyKey || t.id === `T_${params.idempotencyKey}`))
        );
        if (existingTx) {
          // Payload validation for customer transaction
          const isSameAmount = round2(Number(existingTx.amount)) === val;
          const isSameType = existingTx.type === params.type;

          if (!isSameAmount || !isSameType) {
            throw new Error("İşlem doğrulama hatası: Aynı işlem anahtarı (idempotencyKey) farklı parametrelerle kullanılamaz.");
          }

          console.warn(`[FirebaseCustomerRepository] Transaction already applied to customer: ${params.idempotencyKey}`);
          return {
            customer: { id: customerDoc.id, ...customerData } as Customer,
            isDuplicate: true
          };
        }

        // STEP 2: CALCULATE UPDATES
        const transId = params.idempotencyKey 
          ? `T_${params.idempotencyKey}` 
          : `T${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        let newDebt = currentDebt;
        let newPaid = Number(customerData.totalPaid || 0);
        let paymentRecord: Payment | undefined = undefined;

        if (isPayment) {
          newDebt = round2(Math.max(0, newDebt - val));
          newPaid = round2(newPaid + val);

          const paymentData = {
            tenantId: context.tenantId,
            userId: validUid,
            customerId: customerDoc.id,
            customerName: customerData.name || "",
            type: "incoming" as const,
            amount: val,
            paymentMethod,
            timestamp,
            description: params.description?.trim() || "Tahsilat Ödemesi",
            receiptNo: transId
          };

          // WRITE: payment record in same transaction
          transaction.set(paymentRef, paymentData);

          paymentRecord = {
            id: paymentRef.id,
            ...paymentData
          };
        } else {
          newDebt = round2(newDebt + val);
        }

        const newTx: CustomerTransaction = {
          id: transId,
          type: params.type,
          amount: val,
          description: params.description?.trim() || (isPayment ? "Tahsilat Ödemesi" : "Borç Kaydı"),
          timestamp
        };

        const updatedTransactions = [newTx, ...(customerData.transactions || [])];

        // WRITE: customer record in same transaction
        transaction.update(customerRef, {
          totalDebt: newDebt,
          totalPaid: newPaid,
          transactions: updatedTransactions
        });

        const updatedCustomer: Customer = {
          id: customerDoc.id,
          ...customerData,
          totalDebt: newDebt,
          totalPaid: newPaid,
          transactions: updatedTransactions
        };

        return {
          customer: updatedCustomer,
          payment: paymentRecord,
          isDuplicate: false
        };
      });

      // STEP 3: POST-TRANSACTION CACHE INVALIDATION & AUDITING
      memoryCache.invalidate("customers_");
      memoryCache.invalidate("payments_");

      await logAuditEvent(validUid, {
        action: isPayment ? "PAYMENT_RECEIVED" : "SALE_CREATED",
        entityType: "customer",
        entityId: params.customerId,
        companyId: context.tenantId,
        details: { amount: val, type: params.type, paymentMethod, isPayment }
      }, this.db);

      return result;
    } catch (err) {
      console.error("FirebaseCustomerRepository processPaymentTransaction error:", err);
      throw err;
    }
  }
}
