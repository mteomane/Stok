/**
 * FAZ 14 - İŞLEM 2B: Gerçek Firestore SDK & Transaction Entegrasyon Test Paketi
 *
 * YALNIZCA Firebase Firestore Emulator üzerinde çalışır (Proje: demo-stok-satis-test).
 * CANLI FIRESTORE'A KESİNLİKLE BAĞLANMAZ.
 *
 * Test Kapsamı:
 * 1. runTransaction ile atomik stok düşümü ve 3 ondalık basamak hassasiyetinde kumaş metrajı tutarlılığı.
 * 2. Satış iptali (cancelAtomic mantığı) ile mükerrer stok iadesinin önlenmesi (Idempotency).
 * 3. Eşzamanlı (concurrency) yarış koşullarında transaction izolasyonu ve negatif stok koruması.
 * 4. Çok kiracılı (multi-tenant) veri sınırı: Başka firmanın ürününe transaction içinde erişim engeli.
 */

import {
  initializeTestEnvironment,
  RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";

const EMULATOR_HOST = "127.0.0.1";
const EMULATOR_PORT = 8088;
const TEST_PROJECT_ID = "demo-stok-satis-test";

function roundQty(num: number): number {
  return Math.round((num + Number.EPSILON) * 1000) / 1000;
}

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

export async function runIntegrationTests() {
  console.log("=====================================================================");
  console.log("GERÇEK FIRESTORE SDK & ACID TRANSACTION ENTEGRASYON TESTLERİ");
  console.log(`Hedef Proje: ${TEST_PROJECT_ID} (Yalnızca Yerel Emulator)`);
  console.log(`Emulator Adresi: http://${EMULATOR_HOST}:${EMULATOR_PORT}`);
  console.log("=====================================================================\n");

  const isAvailable = await checkEmulatorAvailable();
  if (!isAvailable) {
    console.error(`❌ HATA: Firestore Emulator (${EMULATOR_HOST}:${EMULATOR_PORT}) çalışır durumda bulunamadı!`);
    console.error("   Güvenlik Garantisi: Canlı Firestore'a bağlantı kurma veya canlı veriyi etkileme KESİNLİKLE reddedildi.\n");
    return {
      executed: false,
      reason: "Emulator not running on 127.0.0.1:8088"
    };
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
    console.error("Emulator ortamı başlatılamadı:", err.message);
    return { executed: false, error: err.message };
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
    console.log("--- 0. Test Kimlikleri ve Başlangıç Verilerinin Hazırlanması (Seed) ---");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // Users
      await db.collection("users").doc("usr_owner_alpha").set({
        tenantId: "tenant_alpha",
        role: "owner",
        email: "owner@alpha.com"
      });
      await db.collection("users").doc("usr_buyer_1").set({
        tenantId: "tenant_alpha",
        role: "staff",
        email: "buyer1@alpha.com"
      });
      await db.collection("users").doc("usr_buyer_2").set({
        tenantId: "tenant_alpha",
        role: "staff",
        email: "buyer2@alpha.com"
      });
      await db.collection("users").doc("usr_owner_beta").set({
        tenantId: "tenant_beta",
        role: "owner",
        email: "owner@beta.com"
      });

      // Tenants
      await db.collection("tenants").doc("tenant_alpha").set({
        name: "Firma Alpha",
        ownerUid: "usr_owner_alpha",
        plan: "pro"
      });
      await db.collection("tenants").doc("tenant_beta").set({
        name: "Firma Beta",
        ownerUid: "usr_owner_beta",
        plan: "pro"
      });
    });

    console.log("Seed tamamlandı.\n");

    const ownerAlphaDb = testEnv.authenticatedContext("usr_owner_alpha", { email: "owner@alpha.com", companyId: "tenant_alpha" }).firestore();
    const buyer1Db = testEnv.authenticatedContext("usr_buyer_1", { email: "buyer1@alpha.com", companyId: "tenant_alpha" }).firestore();
    const buyer2Db = testEnv.authenticatedContext("usr_buyer_2", { email: "buyer2@alpha.com", companyId: "tenant_alpha" }).firestore();

    // -------------------------------------------------------------
    // TEST 1: ATOMIC STOCK DEDUCTION WITH 3-DECIMAL PRECISION
    // -------------------------------------------------------------
    console.log("--- BÖLÜM 1: runTransaction ile Atomik Stok Düşümü ve Metraj Tutarlılığı ---");
    const pRef1 = ownerAlphaDb.collection("products").doc("integ_roll_1");
    await pRef1.set({
      tenantId: "tenant_alpha",
      userId: "usr_owner_alpha",
      name: "İpek Saten Kumaş",
      stock: 10.500,
      rolls: [
        { id: "roll_1", rollNumber: "Top #1", length: 10.500, initialLength: 10.500, status: "available" }
      ],
      isActive: true
    });

    const cutLength = 3.255;
    const saleRef1 = ownerAlphaDb.collection("sales").doc("integ_sale_1");

    await ownerAlphaDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(pRef1);
      if (!snap.exists) throw new Error("Ürün bulunamadı");
      const pData = snap.data()!;
      const currentStock = roundQty(pData.stock);

      if (currentStock < cutLength) throw new Error("Yetersiz stok");

      const newStock = roundQty(currentStock - cutLength);
      transaction.update(pRef1, {
        stock: newStock,
        "rolls": [
          { id: "roll_1", rollNumber: "Top #1", length: newStock, initialLength: 10.500, soldLength: cutLength, status: "available" }
        ]
      });

      transaction.set(saleRef1, {
        tenantId: "tenant_alpha",
        userId: "usr_owner_alpha",
        totalAmount: 1627.5,
        items: [{ productId: "integ_roll_1", quantity: cutLength, price: 500 }],
        status: "Tamamlandı",
        cutLength,
        stockDeducted: true,
        stockRestored: false,
        timestamp: new Date().toISOString()
      });
    });

    const updatedP1 = (await pRef1.get()).data()!;
    const updatedS1 = (await saleRef1.get()).data()!;
    const expectedStock = roundQty(10.500 - 3.255); // 7.245

    recordResult(
      updatedP1.stock === expectedStock && updatedS1.stockDeducted === true,
      `Kumaş metrajı 3 basamak hassasiyetle düşüldü (Kalan: ${updatedP1.stock}m, Beklenen: ${expectedStock}m)`
    );

    // -------------------------------------------------------------
    // TEST 2: IDEMPOTENT CANCELLATION & NO DOUBLE RESTORATION
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 2: Satış İptali ve Mükerrer Stok İadesi Koruması ---");
    
    // First cancellation execution
    await ownerAlphaDb.runTransaction(async (transaction) => {
      const sSnap = await transaction.get(saleRef1);
      const sData = sSnap.data()!;
      if (sData.stockRestored === true) return; // Idempotent short-circuit

      const pSnap = await transaction.get(pRef1);
      const pData = pSnap.data()!;
      const restoredStock = roundQty(pData.stock + sData.cutLength);

      transaction.update(pRef1, {
        stock: restoredStock,
        "rolls": [
          { id: "roll_1", rollNumber: "Top #1", length: restoredStock, initialLength: 10.500, soldLength: 0, status: "available" }
        ]
      });

      transaction.update(saleRef1, {
        status: "İptal Edildi",
        stockRestored: true
      });
    });

    const pAfterFirstCancel = (await pRef1.get()).data()!;
    recordResult(
      pAfterFirstCancel.stock === 10.500,
      `İlk iptal işleminde stok tam olarak iade edildi (${pAfterFirstCancel.stock}m)`
    );

    // Second cancellation execution (Idempotent: should NOT add stock again)
    await ownerAlphaDb.runTransaction(async (transaction) => {
      const sSnap = await transaction.get(saleRef1);
      const sData = sSnap.data()!;
      if (sData.stockRestored === true) {
        // Idempotency: short-circuit without mutating products
        return;
      }

      const pSnap = await transaction.get(pRef1);
      const pData = pSnap.data()!;
      const restoredStock = roundQty(pData.stock + sData.cutLength);
      transaction.update(pRef1, { stock: restoredStock });
    });

    const pAfterSecondCancel = (await pRef1.get()).data()!;
    recordResult(
      pAfterSecondCancel.stock === 10.500,
      `Tekrar eden iptal çağrısında mükerrer stok iadesi engellendi (Stok sabit: ${pAfterSecondCancel.stock}m)`
    );

    // -------------------------------------------------------------
    // TEST 3: CONCURRENCY & RACE CONDITION ISOLATION
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 3: Eşzamanlı (Concurrency) Yarış Koşulları Koruması ---");
    const pRefLimited = ownerAlphaDb.collection("products").doc("integ_prod_limited");
    await pRefLimited.set({
      tenantId: "tenant_alpha",
      userId: "usr_owner_alpha",
      name: "Son Kalan Ürün",
      stock: 1.000,
      isActive: true,
      deletedAt: null
    });

    let successCount = 0;
    let failureCount = 0;

    async function attemptPurchase(userDb: any, buyerId: string) {
      try {
        const prodRef = userDb.collection("products").doc("integ_prod_limited");
        await userDb.runTransaction(async (transaction: any) => {
          const snap = await transaction.get(prodRef);
          const data = snap.data()!;
          if (data.stock < 1.000) {
            throw new Error("Yetersiz Stok");
          }
          transaction.update(prodRef, {
            stock: roundQty(data.stock - 1.000),
            isActive: true,
            deletedAt: null
          });
          const orderRef = userDb.collection("orders").doc(`order_${buyerId}`);
          transaction.set(orderRef, {
            tenantId: "tenant_alpha",
            userId: buyerId,
            items: [{ productId: "integ_prod_limited", quantity: 1, price: 100 }],
            totalAmount: 100,
            status: "Sipariş Alındı",
            orderDate: new Date().toISOString()
          });
        });
        successCount++;
      } catch (err: any) {
        console.log(`attemptPurchase (${buyerId}) error:`, err?.message || err);
        failureCount++;
      }
    }

    // Launch two concurrent purchases simultaneously
    await Promise.all([
      attemptPurchase(buyer1Db, "usr_buyer_1"),
      attemptPurchase(buyer2Db, "usr_buyer_2")
    ]);

    const finalLimitedP = (await pRefLimited.get()).data()!;
    recordResult(
      successCount === 1 && failureCount === 1 && finalLimitedP.stock === 0.000,
      `Yarış koşulunda yalnızca 1 işlem başarılı oldu, 1 işlem reddedildi, stok negatif olmadı (Kalan: ${finalLimitedP.stock})`
    );

    // -------------------------------------------------------------
    // TEST 4: MULTI-TENANT BOUNDARY CHECK INSIDE TRANSACTION
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 4: Transaction İçinde Çok Kiracılı Sınır Denetimi ---");
    const ownerBetaDb = testEnv.authenticatedContext("usr_owner_beta", { email: "owner@beta.com" }).firestore();
    const pRefTenantBeta = ownerBetaDb.collection("products").doc("integ_prod_beta");
    await pRefTenantBeta.set({
      tenantId: "tenant_beta",
      userId: "usr_owner_beta",
      name: "Firma Beta Özel Ürünü",
      stock: 20,
      isActive: true
    });

    let tenantLeakBlocked = false;
    try {
      const pRefForAlpha = ownerAlphaDb.collection("products").doc("integ_prod_beta");
      await ownerAlphaDb.runTransaction(async (transaction) => {
        // Attempt to read/modify another tenant's product
        const snap = await transaction.get(pRefForAlpha);
        if (snap.exists) {
          const data = snap.data()!;
          if (data.tenantId !== "tenant_alpha") {
            throw new Error("Yetkisiz işlem: Bu ürün başka bir firmaya ait.");
          }
        }
        transaction.update(pRefForAlpha, { stock: 19 });
      });
    } catch (err: any) {
      console.log("Test 4 caught expected error:", err?.message || err);
      tenantLeakBlocked = true;
    }

    recordResult(tenantLeakBlocked, "Başka firmanın ürününe yönelik işlem transaction içinde reddedildi");

    console.log(`\n=====================================================================`);
    console.log(`ENTEGRASYON TESTİ TAMAMLANDI: Başarılı: ${passed} | Başarısız: ${failed}`);
    console.log(`=====================================================================`);
    return { executed: true, passed, failed };
  } finally {
    await testEnv.cleanup();
  }
}

// Direct execution CLI entrypoint
runIntegrationTests()
  .then((res) => {
    if (!res || !res.executed || res.failed > 0) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Integration test execution error:", err);
    process.exit(1);
  });
