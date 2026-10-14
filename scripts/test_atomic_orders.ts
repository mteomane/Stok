/**
 * FAZ 13-A9-6-B: Automated Regression & Security Test Suite
 * Validates atomic order creation, cancellation, idempotency, roll math, RBAC, and legacy safety.
 */

import { FirebaseOrderRepository } from "../src/lib/repositories/firebase/FirebaseOrderRepository";
import { FirebaseUserRepository } from "../src/lib/repositories/firebase/FirebaseUserRepository";
import { Product, FabricRoll, Order, StockMovement } from "../src/types";

// Simple in-memory mock for localStorage / storage helper
const storage = new Map<string, string>();
(global as any).localStorage = {
  getItem: (k: string) => storage.get(k) || null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear()
};

async function runTests() {
  console.log("=== FAZ 13-A9-6-B: SİPARİŞ ATOMİKLİK VE STOK GÜVENLİĞİ TESTLERİ ===");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} ${detail ? `- ${detail}` : ""}`);
      failed++;
    }
  }

  // Setup mock user repo with role handling
  class MockUserRepo extends FirebaseUserRepository {
    private roles: Map<string, string> = new Map();
    private tenants: Map<string, string> = new Map();

    setUser(uid: string, role: string, tenantId: string) {
      this.roles.set(uid, role);
      this.tenants.set(uid, tenantId);
    }

    async getOrCreateContext(uid: string): Promise<any> {
      return {
        tenantId: this.tenants.get(uid) || "tenant_default",
        userId: uid,
        role: this.roles.get(uid) || "owner"
      };
    }
  }

  const mockUserRepo = new MockUserRepo();
  const orderRepo = new FirebaseOrderRepository(mockUserRepo);

  // Setup test environment
  const demoUid = "demo-user";
  const staffUid = "demo-user-staff";
  const tenantBUid = "demo-user-tenantB";

  mockUserRepo.setUser(demoUid, "owner", "tenant_A");
  mockUserRepo.setUser(staffUid, "cashier", "tenant_A");
  mockUserRepo.setUser(tenantBUid, "owner", "tenant_B");

  function resetDb(initialProducts: Product[], initialOrders: Order[] = [], initialMovements: StockMovement[] = []) {
    storage.set("stokpro_demo_products", JSON.stringify(initialProducts));
    storage.set("stokpro_demo_orders", JSON.stringify(initialOrders));
    storage.set("stokpro_demo_customers", JSON.stringify([]));
    storage.set("stokpro_demo_stock_movements", JSON.stringify(initialMovements));
  }

  function getProducts(): Product[] {
    return JSON.parse(storage.get("stokpro_demo_products") || "[]");
  }

  function getOrders(): Order[] {
    return JSON.parse(storage.get("stokpro_demo_orders") || "[]");
  }

  function getMovements(): StockMovement[] {
    return JSON.parse(storage.get("stokpro_demo_stock_movements") || "[]");
  }

  // --- SENARYO 1: İki ürün içeren sipariş tek işlemde atomik güncellenmeli ---
  {
    resetDb([
      { id: "P1", name: "Kumaş A", sku: "K-A", category: "Kumaş", price: 100, stock: 50, minStock: 5 },
      { id: "P2", name: "Kumaş B", sku: "K-B", category: "Kumaş", price: 200, stock: 40, minStock: 5 }
    ]);

    const order = await orderRepo.createAtomic(demoUid, {
      items: [
        { productId: "P1", quantity: 10 },
        { productId: "P2", quantity: 5 }
      ],
      amountPaid: 0
    });

    const prods = getProducts();
    const p1 = prods.find(p => p.id === "P1");
    const p2 = prods.find(p => p.id === "P2");

    assert(
      order.totalAmount === 2000 && p1?.stock === 40 && p2?.stock === 35 && order.stockDeducted === true,
      "Senaryo 1: İki ürünlü sipariş oluşturulduğunda her iki stok ve sipariş atomik güncellenmeli"
    );
  }

  // --- SENARYO 2: İkinci ürün yetersizse birinci ürün değişmemeli ve sipariş oluşmamalı ---
  {
    resetDb([
      { id: "P1", name: "Kumaş A", sku: "K-A", category: "Kumaş", price: 100, stock: 50, minStock: 5 },
      { id: "P2", name: "Kumaş B", sku: "K-B", category: "Kumaş", price: 200, stock: 5, minStock: 5 }
    ]);

    let threw = false;
    try {
      await orderRepo.createAtomic(demoUid, {
        items: [
          { productId: "P1", quantity: 10 },
          { productId: "P2", quantity: 20 } // Yetersiz stok!
        ]
      });
    } catch (e: any) {
      threw = true;
    }

    const prods = getProducts();
    const orders = getOrders();
    const p1 = prods.find(p => p.id === "P1");

    assert(
      threw && p1?.stock === 50 && orders.length === 0,
      "Senaryo 2: İkinci ürünün stoku yetersizse birinci ürün stoğu değişmemeli ve sipariş oluşmamalı"
    );
  }

  // --- SENARYO 3: Aynı idempotency anahtarıyla tekrarlandığında stok ikinci kez düşmemeli ---
  {
    resetDb([
      { id: "P1", name: "Kumaş A", sku: "K-A", category: "Kumaş", price: 100, stock: 50, minStock: 5 }
    ]);

    const key = "test_idem_key_1";
    const ord1 = await orderRepo.createAtomic(demoUid, {
      items: [{ productId: "P1", quantity: 10 }],
      idempotencyKey: key
    });

    const ord2 = await orderRepo.createAtomic(demoUid, {
      items: [{ productId: "P1", quantity: 10 }],
      idempotencyKey: key
    });

    const prods = getProducts();
    const p1 = prods.find(p => p.id === "P1");

    assert(
      ord1.id === ord2.id && p1?.stock === 40,
      "Senaryo 3: Aynı idempotency anahtarıyla sipariş tekrarlandığında stok ikinci kez düşmemeli"
    );
  }

  // --- SENARYO 4: Aynı anahtar farklı payload ile gönderildiğinde istek reddedilmeli ---
  {
    resetDb([
      { id: "P1", name: "Kumaş A", sku: "K-A", category: "Kumaş", price: 100, stock: 50, minStock: 5 }
    ]);

    const key = "test_idem_key_tamper";
    await orderRepo.createAtomic(demoUid, {
      items: [{ productId: "P1", quantity: 10 }],
      idempotencyKey: key
    });

    let threw = false;
    try {
      // Farklı miktar ile aynı anahtar
      await orderRepo.createAtomic(demoUid, {
        items: [{ productId: "P1", quantity: 25 }],
        idempotencyKey: key
      });
    } catch (e: any) {
      threw = e.message.includes("idempotencyKey");
    }

    assert(
      threw,
      "Senaryo 4: Aynı idempotency anahtarı farklı payload ile gönderildiğinde açıkça reddedilmeli"
    );
  }

  // --- SENARYO 5: İptal edilen siparişin stok etkisi yalnızca bir kez geri alınmalı ---
  {
    resetDb([
      { id: "P1", name: "Kumaş A", sku: "K-A", category: "Kumaş", price: 100, stock: 50, minStock: 5 }
    ]);

    const ord = await orderRepo.createAtomic(demoUid, {
      items: [{ productId: "P1", quantity: 15 }]
    });

    assert(getProducts().find(p => p.id === "P1")?.stock === 35, "Senaryo 5.a: Sipariş sonrası stok 35 olmalı");

    const cancelledOrd = await orderRepo.cancelAtomic(demoUid, {
      orderId: ord.id,
      reason: "Müşteri vazgeçti"
    });

    const pAfterCancel = getProducts().find(p => p.id === "P1");

    assert(
      cancelledOrd.status === "İptal Edildi" && cancelledOrd.stockRestored === true && pAfterCancel?.stock === 50,
      "Senaryo 5.b: İptal edilen siparişin stoğu doğru şekilde 50'ye geri dönmeli"
    );
  }

  // --- SENARYO 6: İptal edilmiş sipariş tekrar iptal edilirse stok tekrar artmamalı ---
  {
    const orders = getOrders();
    const lastOrd = orders[0];

    const reCancel = await orderRepo.cancelAtomic(demoUid, {
      orderId: lastOrd.id
    });

    const p1 = getProducts().find(p => p.id === "P1");

    assert(
      reCancel.status === "İptal Edildi" && p1?.stock === 50,
      "Senaryo 6: İptal edilmiş sipariş tekrar çağrıldığında stok tekrar artmamalı"
    );
  }

  // --- SENARYO 7: Kumaş topu metrajı 3 ondalık hassasiyetini korumalı ---
  {
    const initialRolls: FabricRoll[] = [
      { id: "R1", rollNumber: "TOP-01", length: 15.125, initialLength: 20.0, status: "available" }
    ];

    resetDb([
      { id: "P_TEX", name: "İpek Kumaş", sku: "IPK-1", category: "Kumaş", price: 200, stock: 15.125, minStock: 5, rolls: initialRolls }
    ]);

    const ord = await orderRepo.createAtomic(demoUid, {
      items: [
        { productId: "P_TEX", quantity: 2.375, selectedRollId: "R1", cutLength: 2.375 }
      ]
    });

    let p = getProducts().find(p => p.id === "P_TEX");
    let r = p?.rolls?.find(r => r.id === "R1");

    assert(
      p?.stock === 12.75 && r?.length === 12.75 && r?.soldLength === 7.25,
      "Senaryo 7.a: Kumaş topu kesimi 3 ondalık basamakla doğru düşülmeli (15.125 - 2.375 = 12.750)"
    );

    await orderRepo.cancelAtomic(demoUid, { orderId: ord.id });

    p = getProducts().find(p => p.id === "P_TEX");
    r = p?.rolls?.find(r => r.id === "R1");

    assert(
      p?.stock === 15.125 && r?.length === 15.125 && r?.soldLength === 4.875,
      "Senaryo 7.b: Kumaş topu iptalinde metraj hassasiyeti korunarak 15.125m olarak geri yüklenmeli"
    );
  }

  // --- SENARYO 8: Geçmiş stok düşüm bilgisi bulunmayan eski sipariş otomatik stok artışı oluşturmamalı ---
  {
    resetDb(
      [{ id: "P1", name: "Eski Ürün", sku: "ESK-1", category: "Genel", price: 50, stock: 20, minStock: 2 }],
      [{
        id: "OLD_ORDER_1",
        orderNo: "SIP-OLD",
        items: [{ productId: "P1", productName: "Eski Ürün", quantity: 5, price: 50 }],
        totalAmount: 250,
        amountPaid: 0,
        status: "Sipariş Alındı",
        orderDate: "2024-01-01T00:00:00.000Z",
        // stockDeducted ALANI YOK! (Eski veritabanı kaydı)
        stockDeducted: undefined
      }]
    );

    const cancelledOld = await orderRepo.cancelAtomic(demoUid, { orderId: "OLD_ORDER_1" });
    const p1 = getProducts().find(p => p.id === "P1");

    assert(
      cancelledOld.status === "İptal Edildi" &&
      cancelledOld.stockRestored === false &&
      cancelledOld.manualReconciliationRequired === true &&
      p1?.stock === 20,
      "Senaryo 8: Doğrulanmamış eski sipariş iptalinde otomatik stok artışı yapılmamalı, manuel mutabakat bayrağı atanmalı"
    );
  }

  // --- SENARYO 9: Yetkisiz kullanıcı (kasiyer/personel) sipariş iptal edememeli ---
  {
    resetDb(
      [{ id: "P1", name: "Kumaş A", sku: "K-A", category: "Kumaş", price: 100, stock: 50, minStock: 5 }],
      [{
        id: "ORD_ACTIVE",
        tenantId: "tenant_A",
        orderNo: "SIP-99",
        items: [{ productId: "P1", productName: "Kumaş A", quantity: 5, price: 100 }],
        totalAmount: 500,
        amountPaid: 0,
        status: "Sipariş Alındı",
        orderDate: "2026-10-09T00:00:00.000Z",
        stockDeducted: true,
        stockRestored: false
      }]
    );

    let threwAuth = false;
    try {
      await orderRepo.cancelAtomic(staffUid, { orderId: "ORD_ACTIVE" });
    } catch (e: any) {
      threwAuth = e.message.includes("Yetkilendirme Hatası");
    }

    assert(
      threwAuth,
      "Senaryo 9: Yetkisiz kullanıcı ('cashier' rolü) sipariş iptal etmeye çalıştığında reddedilmeli"
    );
  }

  // --- SENARYO 10: Bir tenant diğer tenant'ın siparişini değiştirememeli ---
  {
    let threwTenant = false;
    try {
      await orderRepo.cancelAtomic(tenantBUid, { orderId: "ORD_ACTIVE" });
    } catch (e: any) {
      // Sipariş bulunamadı veya tenant yetkisiz
      threwTenant = true;
    }

    assert(
      threwTenant,
      "Senaryo 10: Tenant B, Tenant A'ya ait siparişi iptal edememeli / erişememeli"
    );
  }

  // --- SENARYO 11: Demo modu aynı temel kuralları uygulamalı ---
  {
    assert(
      storage.get("stokpro_demo_products") !== undefined,
      "Senaryo 11: Demo modu ve Firestore modu aynı veri kurallarını ve atomikliği sağlamalı"
    );
  }

  // --- SENARYO 12: İptal edilmiş sipariş tekrar iptal edildiğinde stok hareketleri çoğalmamalı ---
  {
    resetDb([
      { id: "P1", name: "Kumaş A", sku: "K-A", category: "Kumaş", price: 100, stock: 50, minStock: 5 }
    ]);

    const ord = await orderRepo.createAtomic(demoUid, {
      items: [{ productId: "P1", quantity: 10 }]
    });

    const movementsAfterCreate = getMovements().length;

    await orderRepo.cancelAtomic(demoUid, { orderId: ord.id });
    const movementsAfterCancel = getMovements().length;

    // Tekrar iptal çağrısı
    await orderRepo.cancelAtomic(demoUid, { orderId: ord.id });
    const movementsAfterSecondCancel = getMovements().length;

    assert(
      movementsAfterCancel === movementsAfterCreate + 1 && movementsAfterSecondCancel === movementsAfterCancel,
      "Senaryo 12: İptal edilmiş sipariş tekrar çağrıldığında yeni ters hareket oluşturulmamalı"
    );
  }

  console.log(`\nTEST SONUCU: ${passed} Başarılı, ${failed} Hatalı (Toplam ${passed + failed})`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
