/**
 * FAZ 14 - İŞLEM 3: Üretim Repository Sınıfları Firestore Emulator Test Paketi
 *
 * YALNIZCA Firebase Firestore Emulator üzerinde çalışır (Proje: demo-stok-satis-test).
 * CANLI FIRESTORE'A KESİNLİKLE BAĞLANMAZ.
 *
 * Bu test paketi, doğrudan uygulamanın kendi üretim repository sınıflarını (DI ile) test eder:
 * 1. FirebaseProductRepository (Ürün ekleme, güncelleme, metraj takibi)
 * 2. FirebaseSalesRepository (Atomik satış işlemi, metraj düşümü, cari bakiye)
 * 3. FirebaseSalesRepository.cancelSale (Satış iptali ve mükerrer stok iadesi koruması - Idempotency)
 * 4. FirebaseOrderRepository (createAtomic & cancelOrderAtomic kumaş metraj iadesi)
 * 5. FirebaseCustomerRepository (Borçlu müşterinin silinmesini engelleme ve borç sıfırlama sonrası silme)
 * 6. Multi-Tenant İzolasyonu (Tenant B'nin Tenant A verisine erişememesi/güncelleyememesi)
 * 7. FirebaseSupplierRepository (Tedarikçi yaşam döngüsü)
 */

import {
  initializeTestEnvironment,
  RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import type { Firestore } from "firebase/firestore";

import { FirebaseUserRepository, clearTenantContextCache } from "../src/lib/repositories/firebase/FirebaseUserRepository";
import { FirebaseSubscriptionRepository } from "../src/lib/repositories/firebase/FirebaseSubscriptionRepository";
import { FirebaseProductRepository } from "../src/lib/repositories/firebase/FirebaseProductRepository";
import { FirebaseSalesRepository } from "../src/lib/repositories/firebase/FirebaseSalesRepository";
import { FirebaseOrderRepository } from "../src/lib/repositories/firebase/FirebaseOrderRepository";
import { FirebaseCustomerRepository } from "../src/lib/repositories/firebase/FirebaseCustomerRepository";
import { FirebaseSupplierRepository } from "../src/lib/repositories/firebase/FirebaseSupplierRepository";
import { setTestAuthenticatedUid } from "../src/lib/authGuard";
import { memoryCache } from "../src/lib/cache";
import { roundQty, round2 } from "../src/lib/repositories/firebase/helpers";

const EMULATOR_HOST = "127.0.0.1";
const EMULATOR_PORT = 8088;
const TEST_PROJECT_ID = "demo-stok-satis-test";

function checkEmulatorAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://${EMULATOR_HOST}:${EMULATOR_PORT}/`,
      { timeout: 1500 },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function runProductionRepositoryTests() {
  console.log("=====================================================================");
  console.log("ÜRETİM REPOSITORY SINIFLARI FIRESTORE EMULATOR TEST PAKETİ");
  console.log(`Hedef Proje: ${TEST_PROJECT_ID} (Yalnızca Yerel Emulator)`);
  console.log(`Emulator Adresi: http://${EMULATOR_HOST}:${EMULATOR_PORT}`);
  console.log("=====================================================================\n");

  const isAvailable = await checkEmulatorAvailable();
  if (!isAvailable) {
    console.error(`❌ HATA: Firestore Emulator (${EMULATOR_HOST}:${EMULATOR_PORT}) çalışır durumda bulunamadı!`);
    console.error("   Güvenlik Garantisi: Canlı Firestore'a bağlantı kurma KESİNLİKLE reddedildi.\n");
    process.exit(1);
  }

  const rulesPath = path.resolve(process.cwd(), "firestore.rules");
  const rulesContent = fs.readFileSync(rulesPath, "utf8");

  let testEnv: RulesTestEnvironment;
  try {
    testEnv = await initializeTestEnvironment({
      projectId: TEST_PROJECT_ID,
      firestore: {
        rules: rulesContent,
        host: EMULATOR_HOST,
        port: EMULATOR_PORT
      }
    });
  } catch (err: any) {
    console.error("Emulator test ortamı başlatılamadı:", err.message);
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  function recordResult(success: boolean, title: string, detail?: string) {
    if (success) {
      console.log(`[PASS] ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title} ${detail ? `- ${detail}` : ""}`);
      failed++;
    }
  }

  try {
    console.log("--- 0. Test Kimlikleri ve SaaS Tenant Verilerinin Hazırlanması (Seed) ---");
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // Tenants
      await db.collection("tenants").doc("tenant_repo_a").set({
        id: "tenant_repo_a",
        name: "Firma A Tekstil A.Ş.",
        ownerUid: "usr_repo_owner_a",
        plan: "enterprise",
        createdAt: new Date().toISOString()
      });
      await db.collection("tenants").doc("tenant_repo_b").set({
        id: "tenant_repo_b",
        name: "Firma B Dokuma Ltd.",
        ownerUid: "usr_repo_owner_b",
        plan: "enterprise",
        createdAt: new Date().toISOString()
      });

      // Users (Valid, non-demo UIDs)
      await db.collection("users").doc("usr_repo_owner_a").set({
        uid: "usr_repo_owner_a",
        tenantId: "tenant_repo_a",
        role: "owner",
        email: "owner_a@tekstil.com",
        displayName: "Yönetici A",
        isActive: true,
        createdAt: new Date().toISOString()
      });
      await db.collection("users").doc("usr_repo_staff_a").set({
        uid: "usr_repo_staff_a",
        tenantId: "tenant_repo_a",
        role: "staff",
        email: "staff_a@tekstil.com",
        displayName: "Personel A",
        isActive: true,
        createdAt: new Date().toISOString()
      });
      await db.collection("users").doc("usr_repo_owner_b").set({
        uid: "usr_repo_owner_b",
        tenantId: "tenant_repo_b",
        role: "owner",
        email: "owner_b@dokuma.com",
        displayName: "Yönetici B",
        isActive: true,
        createdAt: new Date().toISOString()
      });

      // Subscriptions (Enterprise Plan - Quota unlimited)
      await db.collection("subscriptions").doc("tenant_repo_a").set({
        id: "tenant_repo_a",
        tenantId: "tenant_repo_a",
        planId: "enterprise",
        status: "active",
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      });
      await db.collection("subscriptions").doc("tenant_repo_b").set({
        id: "tenant_repo_b",
        tenantId: "tenant_repo_b",
        planId: "enterprise",
        status: "active",
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString()
      });
    });

    console.log("Seed tamamlandı.\n");

    // Clear caches
    clearTenantContextCache();
    memoryCache.clear();

    // Authenticated contexts from rules test environment
    const authContextA = testEnv.authenticatedContext("usr_repo_owner_a", {
      email: "owner_a@tekstil.com",
      companyId: "tenant_repo_a"
    });
    const dbA = authContextA.firestore() as unknown as Firestore;

    const authContextB = testEnv.authenticatedContext("usr_repo_owner_b", {
      email: "owner_b@dokuma.com",
      companyId: "tenant_repo_b"
    });
    const dbB = authContextB.firestore() as unknown as Firestore;

    // Instantiate Real Production Repositories with Injected Firestore instances
    const userRepoA = new FirebaseUserRepository(dbA);
    const subRepoA = new FirebaseSubscriptionRepository(userRepoA, dbA);
    const productRepoA = new FirebaseProductRepository(userRepoA, subRepoA, dbA);
    const salesRepoA = new FirebaseSalesRepository(userRepoA, dbA);
    const orderRepoA = new FirebaseOrderRepository(userRepoA, dbA);
    const customerRepoA = new FirebaseCustomerRepository(userRepoA, dbA);
    const supplierRepoA = new FirebaseSupplierRepository(userRepoA, dbA);

    const userRepoB = new FirebaseUserRepository(dbB);
    const subRepoB = new FirebaseSubscriptionRepository(userRepoB, dbB);
    const productRepoB = new FirebaseProductRepository(userRepoB, subRepoB, dbB);
    const salesRepoB = new FirebaseSalesRepository(userRepoB, dbB);
    const customerRepoB = new FirebaseCustomerRepository(userRepoB, dbB);

    // -------------------------------------------------------------
    // SENARYO 1: ÜRÜN VE KUMAŞ TOPU METRAJI YÖNETİMİ
    // -------------------------------------------------------------
    console.log("--- BÖLÜM 1: FirebaseProductRepository ile Ürün ve Kumaş Metraj Yönetimi ---");
    setTestAuthenticatedUid("usr_repo_owner_a");

    const newProduct = await productRepoA.create("usr_repo_owner_a", {
      name: "Saf Kaşmir Kumaş",
      sku: "KAS-900",
      category: "Kumaş",
      unit: "Metre",
      price: 850,
      stock: 40.000,
      minStock: 5,
      isPackaged: true,
      rolls: [
        { id: "roll_kas_1", rollNumber: "Top #1", length: 40.000, initialLength: 40.000, status: "available" }
      ],
      attributes: { "Renk": "Krem", "En": "150cm" }
    });

    const isCreatedOk = newProduct.id && newProduct.tenantId === "tenant_repo_a" && newProduct.stock === 40;
    recordResult(Boolean(isCreatedOk), "Ürün ve top kaydı başarıyla oluşturuldu", `ID: ${newProduct.id}`);

    // Update stock via repository
    await productRepoA.update(newProduct.id, {
      stock: 35.500,
      rolls: [
        { id: "roll_kas_1", rollNumber: "Top #1", length: 35.500, initialLength: 40.000, status: "available" }
      ]
    }, "usr_repo_owner_a");

    const fetchedProduct = await productRepoA.getById(newProduct.id, "usr_repo_owner_a");
    const isUpdatedOk = fetchedProduct?.stock === 35.500 && fetchedProduct?.rolls?.[0]?.length === 35.500;
    recordResult(Boolean(isUpdatedOk), "Ürün stok ve kumaş topu metrajı başarıyla güncellendi", `Stok: ${fetchedProduct?.stock}`);

    // -------------------------------------------------------------
    // SENARYO 2: GERÇEK ATOMİK SATIŞ, METRAJ DÜŞÜMÜ VE CARİ BAKİYE
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 2: FirebaseSalesRepository.processTransaction ile Atomik Satış ve Metraj Düşümü ---");
    // Create Customer
    const customerA = await customerRepoA.create("usr_repo_owner_a", {
      name: "Moda Butik Ltd.",
      phone: "+90 532 111 22 33",
      instagram: "@modabutik",
      totalDebt: 0,
      totalPaid: 0,
      transactions: []
    });
    recordResult(Boolean(customerA.id), "Cari müşteri kaydı oluşturuldu", `Müşteri: ${customerA.name}`);

    // Execute Atomic Sale with Roll Metraj Cut
    const cutAmount = 5.250;
    const saleTotal = round2(cutAmount * 850); // 4462.50
    const upfrontPayment = 1462.50; // Remaining debt: 3000 TL

    const saleTxResult = await salesRepoA.processTransaction("usr_repo_owner_a", {
      customerId: customerA.id,
      items: [
        {
          productId: newProduct.id,
          quantity: cutAmount,
          selectedRollId: "roll_kas_1"
        }
      ],
      amountPaid: upfrontPayment,
      paymentMethod: "kredi_karti",
      idempotencyKey: "sale_tx_repo_001"
    });

    const saleRecord = saleTxResult;
    recordResult(
      Boolean(saleRecord.id && saleRecord.stockDeducted === true && saleRecord.totalAmount === saleTotal),
      "Atomik satış işlemi ve tahsilat başarıyla tamamlandı",
      `Satış ID: ${saleRecord.id}`
    );

    // Verify Product Stock & Roll
    const prodAfterSale = await productRepoA.getById(newProduct.id, "usr_repo_owner_a");
    const expectedRemainingStock = roundQty(35.500 - cutAmount); // 30.250
    const isStockDeductedExact = prodAfterSale?.stock === expectedRemainingStock && prodAfterSale?.rolls?.[0]?.length === expectedRemainingStock;
    recordResult(
      Boolean(isStockDeductedExact),
      "Kumaş topundan 3 basamak hassasiyetle metraj atomik düşüldü",
      `Kalan Metraj: ${prodAfterSale?.stock}m (Beklenen: ${expectedRemainingStock}m)`
    );

    // Verify Customer Ledger & Outstanding Debt
    const custAfterSale = await customerRepoA.getById(customerA.id);
    const expectedDebt = round2(saleTotal - upfrontPayment); // 3000.00
    const isCustomerDebtOk = round2(Number(custAfterSale?.totalDebt)) === expectedDebt && round2(Number(custAfterSale?.totalPaid)) === upfrontPayment;
    recordResult(
      Boolean(isCustomerDebtOk),
      "Satış sonrası cari borç ve tahsilat tutarları eksiksiz yansıdı",
      `Kalan Borç: ${custAfterSale?.totalDebt} TL, Ödenen: ${custAfterSale?.totalPaid} TL`
    );

    // -------------------------------------------------------------
    // SENARYO 3: SATIŞ İPTALİ VE MÜKERRER STOK İADESİ KORUMASI (IDEMPOTENCY)
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 3: FirebaseSalesRepository.cancelSale ve Mükerrer İptal Koruması ---");
    const cancelResult1 = await salesRepoA.cancelSale(
      saleRecord.id,
      "usr_repo_owner_a",
      "Müşteri siparişten vazgeçti",
      "cancel_idemp_key_001"
    );

    recordResult(
      Boolean(cancelResult1.status === "İptal Edildi" && cancelResult1.stockRestored === true),
      "İlk satış iptali başarıyla tamamlandı ve stok iadesi işaretlendi"
    );

    const prodAfterCancel1 = await productRepoA.getById(newProduct.id, "usr_repo_owner_a");
    const isStockRestoredExact = prodAfterCancel1?.stock === 35.500 && prodAfterCancel1?.rolls?.[0]?.length === 35.500;
    recordResult(
      Boolean(isStockRestoredExact),
      "Satış iptalinde kumaş metrajı tam olarak geri yüklendi",
      `Restored Metraj: ${prodAfterCancel1?.stock}m (Beklenen: 35.500m)`
    );

    // Replay Cancel (Idempotent test)
    const cancelResult2 = await salesRepoA.cancelSale(
      saleRecord.id,
      "usr_repo_owner_a",
      "Müşteri siparişten vazgeçti (Tekrar çağrı)",
      "cancel_idemp_key_001"
    );

    const prodAfterCancel2 = await productRepoA.getById(newProduct.id, "usr_repo_owner_a");
    const isDoubleStockPrevented = prodAfterCancel2?.stock === 35.500;
    recordResult(
      Boolean(isDoubleStockPrevented),
      "Tekrar eden iptal çağrısında mükerrer stok iadesi engellendi (Idempotency Garantisi)",
      `Stok Sabit: ${prodAfterCancel2?.stock}m`
    );

    // -------------------------------------------------------------
    // SENARYO 4: SİPARİŞ OLUŞTURMA VE ATOMİK İPTAL İLE METRAJ İADESİ
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 4: FirebaseOrderRepository (createAtomic & cancelOrderAtomic) ---");
    const orderQty = 10.000;
    const orderItemPrice = 850;
    const orderTotal = round2(orderQty * orderItemPrice); // 8500.00

    const orderCreated = await orderRepoA.createAtomic("usr_repo_owner_a", {
      customerId: customerA.id,
      items: [
        {
          productId: newProduct.id,
          quantity: orderQty,
          cutLength: orderQty,
          price: orderItemPrice,
          selectedRollId: "roll_kas_1"
        }
      ],
      amountPaid: 0,
      idempotencyKey: "order_tx_repo_001",
      notes: "Özel üretim kumaş siparişi"
    });

    recordResult(
      Boolean(orderCreated.id && orderCreated.stockDeducted === true),
      "Atomik sipariş kaydı başarıyla oluşturuldu ve stok düşüldü",
      `Sipariş ID: ${orderCreated.id}`
    );

    const prodAfterOrder = await productRepoA.getById(newProduct.id, "usr_repo_owner_a");
    const expectedAfterOrderStock = roundQty(35.500 - orderQty); // 25.500
    recordResult(
      Boolean(prodAfterOrder?.stock === expectedAfterOrderStock),
      "Sipariş miktar kadar kumaş metrajı rezerve edilip düşüldü",
      `Kalan Metraj: ${prodAfterOrder?.stock}m`
    );

    // Atomic Order Cancellation
    const orderCancelled = await orderRepoA.cancelOrderAtomic(
      orderCreated.id,
      "usr_repo_owner_a",
      "Müşteri kumaş rengini değiştirecek",
      "order_cancel_idemp_001"
    );

    recordResult(
      Boolean(orderCancelled.status === "İptal Edildi" && orderCancelled.stockRestored === true),
      "Sipariş başarıyla iptal edildi ve iade statüsüne geçti"
    );

    const prodAfterOrderCancel = await productRepoA.getById(newProduct.id, "usr_repo_owner_a");
    const isOrderStockRestored = prodAfterOrderCancel?.stock === 35.500;
    recordResult(
      Boolean(isOrderStockRestored),
      "Sipariş iptali sonrası kumaş topu metrajı tam olarak iade edildi",
      `Stok: ${prodAfterOrderCancel?.stock}m (Beklenen: 35.500m)`
    );

    // Repeated order cancel check
    await orderRepoA.cancelOrderAtomic(
      orderCreated.id,
      "usr_repo_owner_a",
      "Mükerrer iptal çağrısı",
      "order_cancel_idemp_001"
    );
    const prodAfterOrderCancel2 = await productRepoA.getById(newProduct.id, "usr_repo_owner_a");
    recordResult(
      Boolean(prodAfterOrderCancel2?.stock === 35.500),
      "Mükerrer sipariş iptalinde çift stok iadesi engellendi",
      `Stok Sabit: ${prodAfterOrderCancel2?.stock}m`
    );

    // -------------------------------------------------------------
    // SENARYO 5: CARİ BORÇ KORUMASI VE MÜŞTERİ SİLME KONTROLÜ
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 5: FirebaseCustomerRepository Açık Borç Güvenlik Engeli ---");
    // Create a customer with debt
    const debtCustomer = await customerRepoA.create("usr_repo_owner_a", {
      name: "Borçlu Konfeksiyon Ltd.",
      phone: "+90 533 999 88 77",
      instagram: "@borclukonfeksiyon",
      totalDebt: 1500,
      totalPaid: 0,
      transactions: []
    });

    let deleteBlocked = false;
    try {
      await customerRepoA.delete(debtCustomer.id);
    } catch (err: any) {
      if (err.message?.includes("Açık borcu bulunan müşteri") || err.message?.includes("Güvenlik Engeli")) {
        deleteBlocked = true;
      }
    }
    recordResult(
      deleteBlocked,
      "Açık borcu olan müşteri doğrudan silinemez (Güvenlik Kuralı & Repository Engeli)"
    );

    // Pay off customer debt
    const payResult = await customerRepoA.processPaymentTransaction("usr_repo_owner_a", {
      customerId: debtCustomer.id,
      amount: 1500,
      type: "payment",
      paymentMethod: "nakit",
      description: "Borcun Tamamı Nakit Kapatıldı",
      idempotencyKey: "pay_close_debt_001"
    });

    const isDebtCleared = round2(Number(payResult.customer.totalDebt)) === 0;
    recordResult(
      isDebtCleared,
      "Tahsilat transaction'ı ile müşterinin açık borcu başarıyla sıfırlandı",
      `Kalan Borç: ${payResult.customer.totalDebt} TL`
    );

    // Now delete should succeed
    let deleteSucceeded = false;
    try {
      await customerRepoA.delete(debtCustomer.id);
      const checkDeleted = await customerRepoA.getById(debtCustomer.id);
      deleteSucceeded = checkDeleted === null;
    } catch (err: any) {
      deleteSucceeded = false;
    }
    recordResult(
      deleteSucceeded,
      "Borcu sıfırlanan müşteri başarıyla silindi"
    );

    // -------------------------------------------------------------
    // SENARYO 6: ÇOK KİRACILI (MULTI-TENANT) VERİ İZOLASYONU
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 6: Çok Kiracılı (Multi-Tenant) Firma Sınırları ve İzolasyon ---");
    setTestAuthenticatedUid("usr_repo_owner_b");

    // Tenant B attempts to read Tenant A's product
    let tenantBReadCrossBlocked = false;
    try {
      const crossProd = await productRepoB.getById(newProduct.id, "usr_repo_owner_b");
      tenantBReadCrossBlocked = (crossProd === null);
    } catch {
      tenantBReadCrossBlocked = true;
    }
    recordResult(
      tenantBReadCrossBlocked,
      "Firma B, Firma A'nın ürün dokümanını okuyamaz (İzole Sınır)"
    );

    // Tenant B attempts to update Tenant A's product
    let tenantBUpdateCrossBlocked = false;
    try {
      await productRepoB.update(newProduct.id, { stock: 9999 }, "usr_repo_owner_b");
    } catch (err: any) {
      tenantBUpdateCrossBlocked = true;
    }
    recordResult(
      tenantBUpdateCrossBlocked,
      "Firma B, Firma A'nın ürün stokunu güncelleyemez (Erişim Reddedildi)"
    );

    // Tenant B attempts to cancel Tenant A's sale
    let tenantBCancelCrossBlocked = false;
    try {
      await salesRepoB.cancelSale(saleRecord.id, "usr_repo_owner_b", "Yetkisiz İptal Denemesi");
    } catch (err: any) {
      tenantBCancelCrossBlocked = true;
    }
    recordResult(
      tenantBCancelCrossBlocked,
      "Firma B, Firma A'nın satış kaydını iptal edemez"
    );

    // Tenant B creates their own isolated product
    const prodB = await productRepoB.create("usr_repo_owner_b", {
      name: "Firma B Pamuklu Gabardin",
      sku: "GAB-100",
      category: "Kumaş",
      unit: "Metre",
      price: 220,
      stock: 100,
      minStock: 10
    });
    recordResult(
      Boolean(prodB.id && prodB.tenantId === "tenant_repo_b"),
      "Firma B kendi izole veri alanında başarıyla ürün oluşturdu",
      `Ürün ID: ${prodB.id}`
    );

    // -------------------------------------------------------------
    // SENARYO 7: TEDARİKÇİ (SUPPLIER) YÖNETİMİ
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 7: FirebaseSupplierRepository Yaşam Döngüsü ---");
    setTestAuthenticatedUid("usr_repo_owner_a");

    const newSupplier = await supplierRepoA.create("usr_repo_owner_a", {
      name: "Bursa Dokuma & Boya A.Ş.",
      contactPerson: "Kemal Bey",
      phone: "+90 224 999 11 22",
      email: "siparis@bursadokuma.com",
      address: "Bursa OSB 2. Cadde No: 5",
      category: "Kumaş",
      balance: 0
    });

    recordResult(
      Boolean(newSupplier.id && newSupplier.tenantId === "tenant_repo_a"),
      "Tedarikçi kaydı başarıyla oluşturuldu",
      `ID: ${newSupplier.id}`
    );

    await supplierRepoA.update(newSupplier.id, {
      contactPerson: "Kemal Demir",
      balance: -12500
    });

    const fetchedSupplier = await supplierRepoA.getById(newSupplier.id);
    recordResult(
      Boolean(fetchedSupplier?.contactPerson === "Kemal Demir" && fetchedSupplier?.balance === -12500),
      "Tedarikçi bilgileri ve bakiye başarıyla güncellendi"
    );

    await supplierRepoA.delete(newSupplier.id);
    const supplierAfterDelete = await supplierRepoA.getById(newSupplier.id);
    recordResult(
      supplierAfterDelete === null,
      "Tedarikçi kaydı başarıyla silindi"
    );

    console.log("\n=====================================================================");
    console.log(`REPOSITORY TESTLERİ TAMAMLANDI: Başarılı: ${passed} | Başarısız: ${failed}`);
    console.log("=====================================================================\n");

    await testEnv.cleanup();

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err: any) {
    console.error("Beklenmeyen test hatası:", err);
    await testEnv.cleanup();
    process.exit(1);
  }
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes("test_production_repositories")) {
  runProductionRepositoryTests().catch((err) => {
    console.error("Test paketi çalıştırılamadı:", err);
    process.exit(1);
  });
}
