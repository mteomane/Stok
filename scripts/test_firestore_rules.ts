/**
 * FAZ 14 - İŞLEM 2: Firestore Güvenlik Kuralları Test Paketi
 *
 * YALNIZCA Firebase Firestore Emulator üzerinde çalışır (Proje: demo-stok-satis-test).
 * CANLI FIRESTORE'A KESİNLİKLE BAĞLANMAZ.
 *
 * Test Kapsamı:
 * 1. Kimlik doğrulanmamış (unauthenticated) erişim engeli.
 * 2. Çok kiracılı (multi-tenant) veri sınırı ve çapraz firma izolasyonu.
 * 3. Yetkisiz personel (staff/cashier) için RBAC kısıtlamaları (soft-delete, rol yükseltme, iptal).
 * 4. Firma sahibi (owner) ve yöneticinin (admin) izin verilen işlemleri.
 * 5. Abonelik belgelerinin istemci tarafından değiştirilemezliği (write: false).
 * 6. Açık borçlu müşteri silme ve stok iadesi yapılmamış satış/sipariş silme korumaları.
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";

const EMULATOR_HOST = "127.0.0.1";
const EMULATOR_PORT = 8088;
const TEST_PROJECT_ID = "demo-stok-satis-test";

/**
 * Checks whether Firestore Emulator is reachable on 127.0.0.1:8088
 */
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

export async function runRulesTests() {
  console.log("=====================================================================");
  console.log("FIRESTORE GÜVENLİK KURALLARI (RULES) EMULATOR TEST PAKETİ");
  console.log(`Hedef Proje: ${TEST_PROJECT_ID} (Yalnızca Yerel Emulator)`);
  console.log(`Emulator Adresi: http://${EMULATOR_HOST}:${EMULATOR_PORT}`);
  console.log("=====================================================================\n");

  const isAvailable = await checkEmulatorAvailable();
  if (!isAvailable) {
    console.warn(`⚠️  UYARI: Firestore Emulator (${EMULATOR_HOST}:${EMULATOR_PORT}) çalışır durumda bulunamadı!`);
    console.warn("   Nedeni: Bu ortamda Java Runtime (JRE 11+) kurulu olmadığı için yerel emulator başlatılamamaktadır.");
    console.warn("   Güvenlik Garantisi: Canlı Firestore'a bağlantı kurma veya canlı veriyi etkileme KESİNLİKLE reddedildi.");
    console.warn("\nEmulator'ı çalıştırmak için:");
    console.warn("   1. Sisteme Java 11+ kurun (örn: apt-get install openjdk-17-jre-headless)");
    console.warn("   2. 'firebase emulators:start --only firestore' komutunu çalıştırın.");
    console.warn("   3. 'npm run test:rules' komutuyla testleri yürütün.\n");
    return {
      executed: false,
      reason: "Emulator not running (Java missing on host environment)"
    };
  }

  let testEnv: RulesTestEnvironment;
  const rulesPath = path.resolve(process.cwd(), "firestore.rules");
  const rulesContent = fs.readFileSync(rulesPath, "utf8");

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
    // -------------------------------------------------------------
    // PREREQUISITE SEEDING (Admin / Security Rules Bypassed for setup)
    // -------------------------------------------------------------
    console.log("--- 0. Test Verilerinin Hazırlanması (Seed) ---");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();

      // Users
      await db.collection("users").doc("user_owner_a").set({
        tenantId: "tenant_A",
        role: "owner",
        email: "owner@tenanta.com",
        createdAt: new Date().toISOString()
      });
      await db.collection("users").doc("user_staff_a").set({
        tenantId: "tenant_A",
        role: "staff",
        email: "staff@tenanta.com",
        createdAt: new Date().toISOString()
      });
      await db.collection("users").doc("user_owner_b").set({
        tenantId: "tenant_B",
        role: "owner",
        email: "owner@tenantb.com",
        createdAt: new Date().toISOString()
      });

      // Tenants
      await db.collection("tenants").doc("tenant_A").set({
        name: "Firma A",
        ownerUid: "user_owner_a",
        plan: "pro",
        createdAt: new Date().toISOString()
      });
      await db.collection("tenants").doc("tenant_B").set({
        name: "Firma B",
        ownerUid: "user_owner_b",
        plan: "free",
        createdAt: new Date().toISOString()
      });

      // Products
      await db.collection("products").doc("prod_a_1").set({
        tenantId: "tenant_A",
        userId: "user_owner_a",
        name: "A Kumaş",
        stock: 100,
        isActive: true
      });
      await db.collection("products").doc("prod_b_1").set({
        tenantId: "tenant_B",
        userId: "user_owner_b",
        name: "B Yedek Parça",
        stock: 50,
        isActive: true
      });

      // Customers
      await db.collection("customers").doc("cust_a_debt").set({
        tenantId: "tenant_A",
        userId: "user_owner_a",
        name: "Borçlu Müşteri",
        totalDebt: 750,
        totalPaid: 250
      });
      await db.collection("customers").doc("cust_a_nodebt").set({
        tenantId: "tenant_A",
        userId: "user_owner_a",
        name: "Borçsuz Müşteri",
        totalDebt: 0,
        totalPaid: 500
      });

      // Sales
      await db.collection("sales").doc("sale_a_active").set({
        tenantId: "tenant_A",
        userId: "user_owner_a",
        status: "Tamamlandı",
        totalAmount: 1200,
        items: [{ productId: "prod_a_1", quantity: 2, price: 600 }],
        stockDeducted: true,
        stockRestored: false
      });
      await db.collection("sales").doc("sale_a_restored").set({
        tenantId: "tenant_A",
        userId: "user_owner_a",
        status: "İptal Edildi",
        totalAmount: 600,
        items: [{ productId: "prod_a_1", quantity: 1, price: 600 }],
        stockDeducted: true,
        stockRestored: true
      });

      // Subscriptions
      await db.collection("subscriptions").doc("sub_a").set({
        tenantId: "tenant_A",
        planId: "pro",
        status: "active",
        startDate: new Date().toISOString()
      });
    });

    console.log("Seed tamamlandı.\n");

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const ownerADb = testEnv.authenticatedContext("user_owner_a", { email: "owner@tenanta.com" }).firestore();
    const staffADb = testEnv.authenticatedContext("user_staff_a", { email: "staff@tenanta.com" }).firestore();
    const ownerBDb = testEnv.authenticatedContext("user_owner_b", { email: "owner@tenantb.com" }).firestore();

    // -------------------------------------------------------------
    // SUITE 1: GİRİŞ YAPMAMIŞ (UNAUTHENTICATED) KULLANICI ERİŞİMİ
    // -------------------------------------------------------------
    console.log("--- BÖLÜM 1: Kimlik Doğrulanmamış Erişim Kısıtlamaları ---");
    try {
      await assertFails(unauthDb.collection("products").doc("prod_a_1").get());
      recordResult(true, "Giriş yapmamış kullanıcı ürünleri okuyamaz");
    } catch (e: any) {
      recordResult(false, "Giriş yapmamış kullanıcı ürünleri okuyamaz", e.message);
    }

    try {
      await assertFails(unauthDb.collection("sales").add({ totalAmount: 100 }));
      recordResult(true, "Giriş yapmamış kullanıcı satış oluşturamaz");
    } catch (e: any) {
      recordResult(false, "Giriş yapmamış kullanıcı satış oluşturamaz", e.message);
    }

    try {
      await assertFails(unauthDb.collection("subscriptions").doc("sub_a").get());
      recordResult(true, "Giriş yapmamış kullanıcı abonelik verisine erişemez");
    } catch (e: any) {
      recordResult(false, "Giriş yapmamış kullanıcı abonelik verisine erişemez", e.message);
    }

    // -------------------------------------------------------------
    // SUITE 2: ÇAPRAZ FİRMA İZOLASYONU (MULTI-TENANT BOUNDARY)
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 2: Çok Kiracılı Veri İzolasyonu (Tenant Sınırları) ---");
    try {
      await assertFails(ownerBDb.collection("products").doc("prod_a_1").get());
      recordResult(true, "Firma B kullanıcısı Firma A'nın ürününü okuyamaz");
    } catch (e: any) {
      recordResult(false, "Firma B kullanıcısı Firma A'nın ürününü okuyamaz", e.message);
    }

    try {
      await assertFails(ownerBDb.collection("products").doc("prod_a_1").update({ stock: 50 }));
      recordResult(true, "Firma B kullanıcısı Firma A'nın stok bilgisini güncelleyemez");
    } catch (e: any) {
      recordResult(false, "Firma B kullanıcısı Firma A'nın stok bilgisini güncelleyemez", e.message);
    }

    try {
      await assertFails(ownerBDb.collection("products").add({
        tenantId: "tenant_A",
        name: "Sahte Firma A Ürünü"
      }));
      recordResult(true, "Firma B kullanıcısı Firma A adına sahte doküman oluşturamaz");
    } catch (e: any) {
      recordResult(false, "Firma B kullanıcısı Firma A adına sahte doküman oluşturamaz", e.message);
    }

    try {
      await assertSucceeds(ownerBDb.collection("products").doc("prod_b_1").get());
      recordResult(true, "Firma B kullanıcısı kendi ürününü başarıyla okur");
    } catch (e: any) {
      recordResult(false, "Firma B kullanıcısı kendi ürününü başarıyla okur", e.message);
    }

    // -------------------------------------------------------------
    // SUITE 3: YETKİSİZ PERSONEL (RBAC) KISITLAMALARI
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 3: Yetkisiz Personel (Staff) Kısıtlamaları ---");
    try {
      await assertFails(staffADb.collection("products").doc("prod_a_1").update({ isActive: false }));
      recordResult(true, "Yetkisiz personel ürünü soft-delete yapamaz (isActive: false)");
    } catch (e: any) {
      recordResult(false, "Yetkisiz personel ürünü soft-delete yapamaz", e.message);
    }

    try {
      await assertFails(staffADb.collection("products").doc("prod_a_1").delete());
      recordResult(true, "Yetkisiz personel ürünü veritabanından silemez (Hard-Delete)");
    } catch (e: any) {
      recordResult(false, "Yetkisiz personel ürünü veritabanından silemez", e.message);
    }

    try {
      await assertFails(staffADb.collection("sales").doc("sale_a_active").update({ status: "İptal Edildi" }));
      recordResult(true, "Yetkisiz personel satışı 'İptal Edildi' durumuna geçiremez");
    } catch (e: any) {
      recordResult(false, "Yetkisiz personel satışı iptal edemez", e.message);
    }

    try {
      await assertFails(staffADb.collection("users").doc("user_staff_a").update({ role: "owner" }));
      recordResult(true, "Yetkisiz personel kendi rolünü 'owner' olarak yükseltemez");
    } catch (e: any) {
      recordResult(false, "Yetkisiz personel kendi rolünü yükseltemez", e.message);
    }

    // -------------------------------------------------------------
    // SUITE 4: İZİN VERİLEN FİRMA SAHİBİ (OWNER) İŞLEMLERİ
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 4: Firma Sahibi ve Yönetici İzinli İşlemleri ---");
    try {
      await assertSucceeds(ownerADb.collection("products").doc("prod_a_1").update({ stock: 95 }));
      recordResult(true, "Firma sahibi stok miktarını güncelleyebilir");
    } catch (e: any) {
      recordResult(false, "Firma sahibi stok miktarını güncelleyebilir", e.message);
    }

    try {
      await assertSucceeds(ownerADb.collection("sales").doc("sale_a_active").update({
        status: "İptal Edildi",
        stockRestored: true
      }));
      recordResult(true, "Firma sahibi satışı iptal durumuna geçirebilir");
    } catch (e: any) {
      recordResult(false, "Firma sahibi satışı iptal durumuna geçirebilir", e.message);
    }

    // -------------------------------------------------------------
    // SUITE 5: ABONELİK BELGELERİNİN İSTEMCİDEN DEĞİŞTİRİLEMEZLİĞİ
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 5: Abonelik ve Plan Haklarının İstemci Koruması ---");
    try {
      await assertSucceeds(ownerADb.collection("subscriptions").doc("sub_a").get());
      recordResult(true, "Firma sahibi kendi abonelik dokümanını okuyabilir");
    } catch (e: any) {
      recordResult(false, "Firma sahibi kendi abonelik dokümanını okuyabilir", e.message);
    }

    try {
      await assertFails(ownerADb.collection("subscriptions").doc("sub_a").update({ planId: "business" }));
      recordResult(true, "Firma sahibi istemci üzerinden abonelik planını değiştiremez (write: false)");
    } catch (e: any) {
      recordResult(false, "Firma sahibi abonelik planını değiştiremez", e.message);
    }

    try {
      await assertFails(ownerADb.collection("subscriptions").doc("sub_fake").set({
        tenantId: "tenant_A",
        planId: "business"
      }));
      recordResult(true, "Firma sahibi sahte abonelik kaydı oluşturamaz (write: false)");
    } catch (e: any) {
      recordResult(false, "Firma sahibi sahte abonelik oluşturamaz", e.message);
    }

    // -------------------------------------------------------------
    // SUITE 6: MÜŞTERİ VE SATIŞ SİLME GÜVENLİK ENGELLERİ
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 6: Açık Borç ve Stok İadesi Güvenlik Engelleri ---");
    try {
      await assertFails(ownerADb.collection("customers").doc("cust_a_debt").delete());
      recordResult(true, "Açık borcu (totalDebt > 0) olan müşteri veritabanından silinemez");
    } catch (e: any) {
      recordResult(false, "Açık borcu olan müşteri silinemez", e.message);
    }

    try {
      await assertSucceeds(ownerADb.collection("customers").doc("cust_a_nodebt").delete());
      recordResult(true, "Borcu bulunmayan (totalDebt == 0) müşteri silinebilir");
    } catch (e: any) {
      recordResult(false, "Borcu bulunmayan müşteri silinebilir", e.message);
    }

    try {
      await assertSucceeds(ownerADb.collection("sales").doc("sale_a_restored").delete());
      recordResult(true, "Stokları iade edilmiş (stockRestored == true) satış kaydı silinebilir");
    } catch (e: any) {
      recordResult(false, "Stokları iade edilmiş satış kaydı silinebilir", e.message);
    }

    console.log(`\n=====================================================================`);
    console.log(`TEST TAMAMLANDI: Başarılı: ${passed} | Başarısız: ${failed}`);
    console.log(`=====================================================================`);
    return { executed: true, passed, failed };
  } finally {
    await testEnv.cleanup();
  }
}

// Direct execution CLI entrypoint
runRulesTests()
  .then((res) => {
    if (!res || !res.executed || res.failed > 0) {
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("Rules test execution error:", err);
    process.exit(1);
  });
