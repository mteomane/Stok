/**
 * STOK-PRO — İŞLEM 7I: FIRESTORE RULES EMULATOR TEST VE BOOTSTRAP DOĞRULAMA PAKETİ
 *
 * YALNIZCA Firebase Firestore Emulator üzerinde çalışır.
 * CANLI FIRESTORE'A KESİNLİKLE BAĞLANMAZ.
 *
 * Test Kapsamı:
 * 1. Kimlik doğrulanmamış (unauthenticated) erişim engeli.
 * 2. 10 Kritik Tenant İzolasyonu Senaryosunun Gerçek Emulator Üzerinde Doğrulanması:
 *    - Senaryo 1: Kendi UID'si ile yabancı tenantId enjeksiyonu engeli.
 *    - Senaryo 2: Başka bir firmanın dokümanını okuma engeli.
 *    - Senaryo 3: Başka bir firmanın dokümanını güncelleme/silme engeli.
 *    - Senaryo 4: Sahte / yetkisiz tenantId ile kayıt oluşturma engeli.
 *    - Senaryo 5: Personelin kendi UID'sini tenantId yaparak sahte işletme açma engeli.
 *    - Senaryo 6: Firma sahibinin kendi işletmesinde ürün ve stok yönetimi (ALLOW).
 *    - Senaryo 7: Kasiyerin satış oluşturabilmesi (ALLOW) fakat admin yetkisi alamaması (DENY).
 *    - Senaryo 8: Bootstrap Akışı — Yeni kayıt olan kullanıcının tenant, user profile, settings,
 *                 company ve başlangıç verilerini kural engeline takılmadan kurabilmesi (ALLOW),
 *                 ancak başka kullanıcı adına profil/tenant oluşturamaması (DENY).
 *    - Senaryo 9: tenantId alanı eksik belge ekleme engeli.
 *    - Senaryo 10: Subscriptions write:false kuralı ve tanımsız koleksiyonlar catch-all koruması.
 * 3. Yetkisiz personel (staff/cashier) için RBAC kısıtlamaları (soft-delete, rol yükseltme, iptal).
 * 4. Firma sahibi (owner) ve yöneticinin (admin) izin verilen işlemleri.
 * 5. Abonelik belgelerinin istemci tarafından değiştirilemezliği (write: false).
 * 6. Açık borçlu müşteri silme ve stok iadesi yapılmamış satış silme korumaları.
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
const TEST_PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-stok-pro-rules-test";

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
  console.log("STOK-PRO: FIRESTORE GÜVENLİK KURALLARI & BOOTSTRAP EMULATOR TESTİ");
  console.log(`Hedef Proje: ${TEST_PROJECT_ID} (Yalnızca Yerel Emulator)`);
  console.log(`Emulator Adresi: http://${EMULATOR_HOST}:${EMULATOR_PORT}`);
  console.log("=====================================================================\n");

  const isAvailable = await checkEmulatorAvailable();
  if (!isAvailable) {
    console.error(`❌ HATA: Firestore Emulator (${EMULATOR_HOST}:${EMULATOR_PORT}) çalışır durumda bulunamadı!`);
    console.error("   Testler 'firebase emulators:exec' ile emülatör içinde çalıştırılmalıdır.");
    return {
      executed: false,
      reason: "Emulator not running"
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
        uid: "user_owner_a",
        tenantId: "tenant_A",
        role: "owner",
        email: "owner@tenanta.com",
        createdAt: new Date().toISOString()
      });
      await db.collection("users").doc("user_staff_a").set({
        uid: "user_staff_a",
        tenantId: "tenant_A",
        role: "staff",
        email: "staff@tenanta.com",
        createdAt: new Date().toISOString()
      });
      await db.collection("users").doc("user_cashier_a").set({
        uid: "user_cashier_a",
        tenantId: "tenant_A",
        role: "cashier",
        email: "cashier@tenanta.com",
        createdAt: new Date().toISOString()
      });
      await db.collection("users").doc("user_owner_b").set({
        uid: "user_owner_b",
        tenantId: "tenant_B",
        role: "owner",
        email: "owner@tenantb.com",
        createdAt: new Date().toISOString()
      });
      await db.collection("users").doc("user_staff_b").set({
        uid: "user_staff_b",
        tenantId: "tenant_B",
        role: "staff",
        email: "staff@tenantb.com",
        createdAt: new Date().toISOString()
      });

      // Tenants
      await db.collection("tenants").doc("tenant_A").set({
        id: "tenant_A",
        name: "Firma A",
        ownerUid: "user_owner_a",
        plan: "pro",
        createdAt: new Date().toISOString()
      });
      await db.collection("tenants").doc("tenant_B").set({
        id: "tenant_B",
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

      // Customers (Tenant B)
      await db.collection("customers").doc("cust_b_1").set({
        tenantId: "tenant_B",
        userId: "user_owner_b",
        name: "Firma B Müşterisi",
        totalDebt: 0,
        totalPaid: 100
      });

      // Sales (Tenant B)
      await db.collection("sales").doc("sale_b_1").set({
        tenantId: "tenant_B",
        userId: "user_owner_b",
        status: "Tamamlandı",
        totalAmount: 500,
        items: [{ productId: "prod_b_1", quantity: 1, price: 500 }]
      });

      // Orders
      await db.collection("orders").doc("order_a_1").set({
        tenantId: "tenant_A",
        userId: "user_owner_a",
        orderNumber: "ORD-A-001",
        status: "Hazırlanıyor",
        totalAmount: 1500
      });
      await db.collection("orders").doc("order_b_1").set({
        tenantId: "tenant_B",
        userId: "user_owner_b",
        orderNumber: "ORD-B-001",
        status: "Hazırlanıyor",
        totalAmount: 800
      });

      // Stock Movements
      await db.collection("stock_movements").doc("mov_a_1").set({
        tenantId: "tenant_A",
        userId: "user_owner_a",
        productId: "prod_a_1",
        type: "in",
        quantity: 50
      });
      await db.collection("stock_movements").doc("mov_b_1").set({
        tenantId: "tenant_B",
        userId: "user_owner_b",
        productId: "prod_b_1",
        type: "in",
        quantity: 25
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
    const cashierADb = testEnv.authenticatedContext("user_cashier_a", { email: "cashier@tenanta.com" }).firestore();
    const ownerBDb = testEnv.authenticatedContext("user_owner_b", { email: "owner@tenantb.com" }).firestore();

    // -------------------------------------------------------------
    // BÖLÜM 1: GİRİŞ YAPMAMIŞ (UNAUTHENTICATED) KULLANICI ERİŞİMİ
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
    // BÖLÜM 2: 10 KRİTİK GÜVENLİK VE TENANT İZOLASYONU SENARYOSU
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 2: 10 Kritik Tenant İzolasyonu Senaryosu ---");

    // Senaryo 1: Firma B üyesi, Firma A'nın tenantId değerini kullanıp kendi UID'siyle sahte ürün eklemeye çalışır
    try {
      await assertFails(ownerBDb.collection("products").add({
        tenantId: "tenant_A",
        userId: "user_owner_b",
        name: "Saldırgan Ürünü",
        price: 999
      }));
      recordResult(true, "Senaryo 1: Firma B üyesi kendi UID'si ve Firma A tenantId'si ile sahte ürün ekleyemez");
    } catch (e: any) {
      recordResult(false, "Senaryo 1: Firma B üyesi kendi UID'si ve Firma A tenantId'si ile sahte ürün ekleyemez", e.message);
    }

    // Senaryo 2: Firma B kullanıcısı, Firma A'ya ait belgeyi okumaya çalışır
    try {
      await assertFails(ownerBDb.collection("products").doc("prod_a_1").get());
      recordResult(true, "Senaryo 2: Firma B üyesi Firma A'nın ürün belgesini okuyamaz");
    } catch (e: any) {
      recordResult(false, "Senaryo 2: Firma B üyesi Firma A'nın ürün belgesini okuyamaz", e.message);
    }

    // Senaryo 3: Firma B kullanıcısı Firma A'nın belgesini güncelleyemez veya silemez
    try {
      await assertFails(ownerBDb.collection("products").doc("prod_a_1").update({ stock: 50 }));
      recordResult(true, "Senaryo 3 (Update): Firma B üyesi Firma A'nın ürün stoğunu güncelleyemez");
    } catch (e: any) {
      recordResult(false, "Senaryo 3 (Update): Firma B üyesi Firma A'nın ürün stoğunu güncelleyemez", e.message);
    }

    try {
      await assertFails(ownerBDb.collection("products").doc("prod_a_1").delete());
      recordResult(true, "Senaryo 3 (Delete): Firma B üyesi Firma A'nın ürününü silemez");
    } catch (e: any) {
      recordResult(false, "Senaryo 3 (Delete): Firma B üyesi Firma A'nın ürününü silemez", e.message);
    }

    // Senaryo 4: Kullanıcı sahte / var olmayan tenantId ile yeni kayıt oluşturmaya çalışır
    try {
      await assertFails(ownerBDb.collection("products").add({
        tenantId: "fake_nonexistent_tenant",
        userId: "user_owner_b",
        name: "Sahte Tenant Ürünü"
      }));
      recordResult(true, "Senaryo 4: Kullanıcı sahte/yetkisiz bir tenantId ile yeni kayıt oluşturamaz");
    } catch (e: any) {
      recordResult(false, "Senaryo 4: Kullanıcı sahte/yetkisiz bir tenantId ile yeni kayıt oluşturamaz", e.message);
    }

    // Senaryo 5: Personel kendi UID'sini tenantId olarak göndererek sahte işletme açmaya çalışır
    try {
      await assertFails(staffADb.collection("products").add({
        tenantId: "user_staff_a",
        userId: "user_staff_a",
        name: "Personel Bağımsız Ürünü"
      }));
      recordResult(true, "Senaryo 5: Personel kendi UID'sini tenantId olarak göndererek bağımsız yetki kazanamaz");
    } catch (e: any) {
      recordResult(false, "Senaryo 5: Personel kendi UID'sini tenantId olarak göndererek bağımsız yetki kazanamaz", e.message);
    }

    // Senaryo 6: Yetkili bir işletme sahibi kendi işletmesinde normal ürün ve stok işlemi yapar (ALLOW)
    try {
      await assertSucceeds(ownerADb.collection("products").add({
        tenantId: "tenant_A",
        userId: "user_owner_a",
        name: "Firma A Yeni Kumaş",
        stock: 50,
        price: 200,
        isActive: true
      }));
      recordResult(true, "Senaryo 6 (Ekleme): Yetkili işletme sahibi kendi şirketinde ürün ekleyebilir");
    } catch (e: any) {
      recordResult(false, "Senaryo 6 (Ekleme): Yetkili işletme sahibi kendi şirketinde ürün ekleyebilir", e.message);
    }

    try {
      await assertSucceeds(ownerADb.collection("products").doc("prod_a_1").update({ stock: 95 }));
      recordResult(true, "Senaryo 6 (Güncelleme): Yetkili işletme sahibi kendi şirketinde stok güncelleyebilir");
    } catch (e: any) {
      recordResult(false, "Senaryo 6 (Güncelleme): Yetkili işletme sahibi kendi şirketinde stok güncelleyebilir", e.message);
    }

    // Senaryo 7: Geçerli kasiyer kendi işletmesinde satış fişi oluşturur (ALLOW), fakat yönetici yetkisi alamaz (DENY)
    try {
      await assertSucceeds(cashierADb.collection("sales").add({
        tenantId: "tenant_A",
        userId: "user_cashier_a",
        totalAmount: 300,
        items: [{ productId: "prod_a_1", quantity: 1, price: 300 }],
        status: "Tamamlandı",
        stockDeducted: true,
        stockRestored: false,
        createdAt: new Date().toISOString()
      }));
      recordResult(true, "Senaryo 7 (Kasiyer Satış): Kasiyer kendi şirketi adına satış fişi oluşturabilir");
    } catch (e: any) {
      recordResult(false, "Senaryo 7 (Kasiyer Satış): Kasiyer kendi şirketi adına satış fişi oluşturabilir", e.message);
    }

    try {
      await assertFails(cashierADb.collection("users").doc("user_cashier_a").update({ role: "owner" }));
      recordResult(true, "Senaryo 7 (Kasiyer Rol Sınırı): Kasiyer kendi rolünü 'owner' olarak yükseltemez");
    } catch (e: any) {
      recordResult(false, "Senaryo 7 (Kasiyer Rol Sınırı): Kasiyer kendi rolünü 'owner' olarak yükseltemez", e.message);
    }

    // Senaryo 8: BOOTSTRAP AKIŞI — Yeni kullanıcı kayıt ve ilk şirket kurulum akışı
    console.log("\n--- BÖLÜM 2.8: Bootstrap Denetimi (Yeni Kullanıcı ve İlk Şirket Kurulumu) ---");
    const newBootstrapUid = "user_new_signup_999";
    const newBootstrapDb = testEnv.authenticatedContext(newBootstrapUid, { email: "yeni@isletme.com" }).firestore();

    // 8.1 Yeni kullanıcı kendi UID'siyle tenant kaydı oluşturabilir (ALLOW)
    try {
      await assertSucceeds(newBootstrapDb.collection("tenants").doc(newBootstrapUid).set({
        id: newBootstrapUid,
        name: "Yeni Pilot Şirketim",
        ownerUid: newBootstrapUid,
        plan: "pro",
        createdAt: new Date().toISOString()
      }));
      recordResult(true, "Senaryo 8.1 (Bootstrap Tenant): Yeni kullanıcı kendi UID'siyle ilk tenant kaydını açabilir");
    } catch (e: any) {
      recordResult(false, "Senaryo 8.1 (Bootstrap Tenant): Yeni kullanıcı kendi UID'siyle ilk tenant kaydını açabilir", e.message);
    }

    // 8.2 Yeni kullanıcı kendi kullanıcı profili dokümanını oluşturabilir (ALLOW)
    try {
      await assertSucceeds(newBootstrapDb.collection("users").doc(newBootstrapUid).set({
        uid: newBootstrapUid,
        tenantId: newBootstrapUid,
        role: "owner",
        email: "yeni@isletme.com",
        displayName: "Yeni Pilot Şirketim",
        createdAt: new Date().toISOString(),
        isActive: true
      }));
      recordResult(true, "Senaryo 8.2 (Bootstrap User): Yeni kullanıcı 'owner' rolüyle kendi profiline yazabilir");
    } catch (e: any) {
      recordResult(false, "Senaryo 8.2 (Bootstrap User): Yeni kullanıcı 'owner' rolüyle kendi profiline yazabilir", e.message);
    }

    // 8.3 Yeni kullanıcı ayar (settings) ve firma (company) bilgilerini oluşturabilir (ALLOW)
    try {
      await assertSucceeds(newBootstrapDb.collection("settings").doc(newBootstrapUid).set({
        activeSector: "tekstil",
        updatedAt: new Date().toISOString()
      }));
      recordResult(true, "Senaryo 8.3 (Bootstrap Settings): Yeni kullanıcı sektör ayarlarını oluşturabilir");
    } catch (e: any) {
      recordResult(false, "Senaryo 8.3 (Bootstrap Settings): Yeni kullanıcı sektör ayarlarını oluşturabilir", e.message);
    }

    try {
      await assertSucceeds(newBootstrapDb.collection("company").doc(newBootstrapUid).set({
        name: "Yeni Pilot Şirketim",
        phone: "+90 555 123 45 67",
        email: "yeni@isletme.com"
      }));
      recordResult(true, "Senaryo 8.4 (Bootstrap Company): Yeni kullanıcı firma profil dokümanını oluşturabilir");
    } catch (e: any) {
      recordResult(false, "Senaryo 8.4 (Bootstrap Company): Yeni kullanıcı firma profil dokümanını oluşturabilir", e.message);
    }

    // 8.5 Yeni kullanıcı başlangıç demo ürününü ve müşterisini ekleyebilir (ALLOW)
    try {
      await assertSucceeds(newBootstrapDb.collection("products").add({
        tenantId: newBootstrapUid,
        userId: newBootstrapUid,
        name: "İlk Demo Kumaş",
        stock: 50,
        price: 150,
        isActive: true,
        createdAt: new Date().toISOString()
      }));
      recordResult(true, "Senaryo 8.5 (Bootstrap Ürün): Yeni kullanıcı ilk demo ürününü ekleyebilir");
    } catch (e: any) {
      recordResult(false, "Senaryo 8.5 (Bootstrap Ürün): Yeni kullanıcı ilk demo ürününü ekleyebilir", e.message);
    }

    // 8.6 Kötü niyetli kullanıcı: Yeni bir kullanıcı başkası adına tenant açamaz (DENY)
    try {
      await assertFails(newBootstrapDb.collection("tenants").doc("tenant_stolen").set({
        id: "tenant_stolen",
        name: "Ele Geçirilen Şirket",
        ownerUid: "victim_uid",
        plan: "enterprise"
      }));
      recordResult(true, "Senaryo 8.6 (Bootstrap Güvenlik): Kullanıcı yabancı bir UID adına tenant açamaz");
    } catch (e: any) {
      recordResult(false, "Senaryo 8.6 (Bootstrap Güvenlik): Kullanıcı yabancı bir UID adına tenant açamaz", e.message);
    }

    // 8.7 Kötü niyetli kullanıcı: Başka bir kullanıcının profilini yazamaz/değiştiremez (DENY)
    try {
      await assertFails(newBootstrapDb.collection("users").doc("user_owner_a").set({
        uid: "user_owner_a",
        tenantId: "tenant_A",
        role: "owner"
      }));
      recordResult(true, "Senaryo 8.7 (Bootstrap Güvenlik): Kullanıcı başka bir kullanıcının profilini yazamaz");
    } catch (e: any) {
      recordResult(false, "Senaryo 8.7 (Bootstrap Güvenlik): Kullanıcı başka bir kullanıcının profilini yazamaz", e.message);
    }

    // Senaryo 9: tenantId alanı eksik belge tenant koleksiyonunda oluşturulamaz (DENY)
    console.log("\n--- BÖLÜM 2.9 & 2.10: Veri Bütünlüğü ve Catch-all ---");
    try {
      await assertFails(ownerADb.collection("products").add({
        userId: "user_owner_a",
        name: "Tenant Bilgisi Eksik Ürün"
      }));
      recordResult(true, "Senaryo 9: tenantId alanı eksik belge tenant koleksiyonunda oluşturulamaz");
    } catch (e: any) {
      recordResult(false, "Senaryo 9: tenantId alanı eksik belge tenant koleksiyonunda oluşturulamaz", e.message);
    }

    // Senaryo 10: subscriptions write:false ve tanımsız koleksiyonlar catch-all koruması (DENY)
    try {
      await assertFails(ownerADb.collection("subscriptions").doc("sub_a").update({ planId: "enterprise" }));
      recordResult(true, "Senaryo 10.1: Subscriptions koleksiyonu istemciden güncellenemez (write: false)");
    } catch (e: any) {
      recordResult(false, "Senaryo 10.1: Subscriptions koleksiyonu istemciden güncellenemez", e.message);
    }

    try {
      await assertFails(ownerADb.collection("subscriptions").doc("sub_new").set({
        tenantId: "tenant_A",
        planId: "pro"
      }));
      recordResult(true, "Senaryo 10.2: Subscriptions koleksiyonuna istemciden yeni kayıt eklenemez (write: false)");
    } catch (e: any) {
      recordResult(false, "Senaryo 10.2: Subscriptions koleksiyonuna istemciden yeni kayıt eklenemez", e.message);
    }

    try {
      await assertFails(ownerADb.collection("random_unmapped_collection").doc("doc1").set({ foo: "bar" }));
      recordResult(true, "Senaryo 10.3: Tanımsız/eşleşmeyen koleksiyonlar catch-all (deny by default) ile engellenir");
    } catch (e: any) {
      recordResult(false, "Senaryo 10.3: Tanımsız koleksiyonlar engellenir", e.message);
    }

    // -------------------------------------------------------------
    // BÖLÜM 3: YETKİSİZ PERSONEL (RBAC) KISITLAMALARI
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
    // BÖLÜM 4: İZİN VERİLEN FİRMA SAHİBİ (OWNER) İŞLEMLERİ
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
    // BÖLÜM 5: ABONELİK BELGELERİNİN İSTEMCİDEN DEĞİŞTİRİLEMEZLİĞİ
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 5: Abonelik ve Plan Haklarının İstemci Koruması ---");
    try {
      await assertSucceeds(ownerADb.collection("subscriptions").doc("sub_a").get());
      recordResult(true, "Firma sahibi kendi abonelik dokümanını okuyabilir");
    } catch (e: any) {
      recordResult(false, "Firma sahibi kendi abonelik dokümanını okuyabilir", e.message);
    }

    // -------------------------------------------------------------
    // BÖLÜM 6: MÜŞTERİ VE SATIŞ SİLME GÜVENLİK ENGELLERİ
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

    // -------------------------------------------------------------
    // BÖLÜM 7: FIRESTORE SORGULARINDA (QUERIES) TENANT İZOLASYONU
    // (Security Rules Are Not Filters Güvencesi)
    // -------------------------------------------------------------
    console.log("\n--- BÖLÜM 7: Firestore Sorgularında (Queries) Tenant İzolasyonu ---");

    // 7.1 Products Koleksiyonu Sorgu İzolasyonu
    try {
      await assertSucceeds(ownerADb.collection("products").where("tenantId", "==", "tenant_A").get());
      recordResult(true, "Firma A kendi tenantId filtresi ile ürünleri başarıyla sorgular (where tenantId == tenant_A)");
    } catch (e: any) {
      recordResult(false, "Firma A kendi tenantId filtresi ile ürünleri sorgulayabilmelidir", e.message);
    }

    try {
      await assertFails(ownerADb.collection("products").doc("prod_b_1").get());
      recordResult(true, "Firma A başka bir tenant'ın bilinen ürün belge kimliğini okuyamaz (prod_b_1)");
    } catch (e: any) {
      recordResult(false, "Firma A başka bir tenant'ın ürününü okuyamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("products").where("tenantId", "==", "tenant_B").get());
      recordResult(true, "Firma A Firma B belgelerini listelemeye yönelik sorgu yapamaz (where tenantId == tenant_B)");
    } catch (e: any) {
      recordResult(false, "Firma A Firma B sorgusu yapamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("products").get());
      recordResult(true, "Tenant filtresi olmadan tüm ürünleri çeken filtresiz sorgu reddedilir (Rules are not filters)");
    } catch (e: any) {
      recordResult(false, "Filtresiz ürün sorgusu reddedilmelidir", e.message);
    }

    // 7.2 Customers Koleksiyonu Sorgu İzolasyonu
    try {
      await assertSucceeds(ownerADb.collection("customers").where("tenantId", "==", "tenant_A").get());
      recordResult(true, "Firma A kendi müşterilerini tenantId filtresi ile başarıyla listeler");
    } catch (e: any) {
      recordResult(false, "Firma A kendi müşterilerini listeleyebilmelidir", e.message);
    }

    try {
      await assertFails(ownerADb.collection("customers").doc("cust_b_1").get());
      recordResult(true, "Firma A Firma B'nin bilinen müşteri belgesini okuyamaz (cust_b_1)");
    } catch (e: any) {
      recordResult(false, "Firma A Firma B'nin müşterisini okuyamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("customers").where("tenantId", "==", "tenant_B").get());
      recordResult(true, "Firma A Firma B müşterilerini listelemeye yönelik sorgu yapamaz");
    } catch (e: any) {
      recordResult(false, "Firma A Firma B müşteri sorgusu yapamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("customers").get());
      recordResult(true, "Tenant filtresi olmadan tüm müşterileri çeken filtresiz sorgu reddedilir");
    } catch (e: any) {
      recordResult(false, "Filtresiz müşteri sorgusu reddedilmelidir", e.message);
    }

    // 7.3 Sales Koleksiyonu Sorgu İzolasyonu
    try {
      await assertSucceeds(ownerADb.collection("sales").where("tenantId", "==", "tenant_A").get());
      recordResult(true, "Firma A kendi satış kayıtlarını tenantId filtresi ile başarıyla listeler");
    } catch (e: any) {
      recordResult(false, "Firma A kendi satışlarını listeleyebilmelidir", e.message);
    }

    try {
      await assertFails(ownerADb.collection("sales").doc("sale_b_1").get());
      recordResult(true, "Firma A Firma B'nin bilinen satış fişi belgesini okuyamaz (sale_b_1)");
    } catch (e: any) {
      recordResult(false, "Firma A Firma B'nin satışını okuyamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("sales").where("tenantId", "==", "tenant_B").get());
      recordResult(true, "Firma A Firma B satış fişlerini listelemeye yönelik sorgu yapamaz");
    } catch (e: any) {
      recordResult(false, "Firma A Firma B satış sorgusu yapamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("sales").get());
      recordResult(true, "Tenant filtresi olmadan tüm satışları çeken filtresiz sorgu reddedilir");
    } catch (e: any) {
      recordResult(false, "Filtresiz satış sorgusu reddedilmelidir", e.message);
    }

    // 7.4 Orders Koleksiyonu Sorgu İzolasyonu
    try {
      await assertSucceeds(ownerADb.collection("orders").where("tenantId", "==", "tenant_A").get());
      recordResult(true, "Firma A kendi siparişlerini tenantId filtresi ile başarıyla listeler");
    } catch (e: any) {
      recordResult(false, "Firma A kendi siparişlerini listeleyebilmelidir", e.message);
    }

    try {
      await assertFails(ownerADb.collection("orders").doc("order_b_1").get());
      recordResult(true, "Firma A Firma B'nin bilinen sipariş belgesini okuyamaz (order_b_1)");
    } catch (e: any) {
      recordResult(false, "Firma A Firma B'nin siparişini okuyamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("orders").where("tenantId", "==", "tenant_B").get());
      recordResult(true, "Firma A Firma B siparişlerini listelemeye yönelik sorgu yapamaz");
    } catch (e: any) {
      recordResult(false, "Firma A Firma B sipariş sorgusu yapamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("orders").get());
      recordResult(true, "Tenant filtresi olmadan tüm siparişleri çeken filtresiz sorgu reddedilir");
    } catch (e: any) {
      recordResult(false, "Filtresiz sipariş sorgusu reddedilmelidir", e.message);
    }

    // 7.5 Stock Movements Koleksiyonu Sorgu İzolasyonu
    try {
      await assertSucceeds(ownerADb.collection("stock_movements").where("tenantId", "==", "tenant_A").get());
      recordResult(true, "Firma A kendi stok hareketlerini tenantId filtresi ile başarıyla listeler");
    } catch (e: any) {
      recordResult(false, "Firma A kendi stok hareketlerini listeleyebilmelidir", e.message);
    }

    try {
      await assertFails(ownerADb.collection("stock_movements").doc("mov_b_1").get());
      recordResult(true, "Firma A Firma B'nin bilinen stok hareketi belgesini okuyamaz (mov_b_1)");
    } catch (e: any) {
      recordResult(false, "Firma A Firma B'nin stok hareketini okuyamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("stock_movements").where("tenantId", "==", "tenant_B").get());
      recordResult(true, "Firma A Firma B stok hareketlerini listelemeye yönelik sorgu yapamaz");
    } catch (e: any) {
      recordResult(false, "Firma A Firma B stok hareketi sorgusu yapamaz", e.message);
    }

    try {
      await assertFails(ownerADb.collection("stock_movements").get());
      recordResult(true, "Tenant filtresi olmadan tüm stok hareketlerini çeken filtresiz sorgu reddedilir");
    } catch (e: any) {
      recordResult(false, "Filtresiz stok hareketi sorgusu reddedilmelidir", e.message);
    }

    // -------------------------------------------------------------
    // 8. İŞLEM 7L: DAR KAPSAMLI GET İZNİ VE AUDIT LOG DÜZELTMELERİ
    // -------------------------------------------------------------
    console.log("\n--- 8. İşlem 7L: Dar Kapsamlı Get İzni ve Audit Log Denetimi ---");

    // 8.1 products ve customers koleksiyonlarında bulunmayan rastgele belgelerin okunması engellenir
    try {
      await assertFails(ownerADb.collection("products").doc("prod_random_nonexistent_xyz").get());
      recordResult(true, "products koleksiyonunda bulunmayan belgeyi genel okuma girişimi engellenir (resource==null kaldırıldı)");
    } catch (e: any) {
      recordResult(false, "products bulunmayan belge okuması engellenmelidir", e.message);
    }

    try {
      await assertFails(ownerADb.collection("customers").doc("cust_random_nonexistent_xyz").get());
      recordResult(true, "customers koleksiyonunda bulunmayan belgeyi genel okuma girişimi engellenir (resource==null kaldırıldı)");
    } catch (e: any) {
      recordResult(false, "customers bulunmayan belge okuması engellenmelidir", e.message);
    }

    try {
      await assertFails(ownerADb.collection("suppliers").doc("sup_random_nonexistent_xyz").get());
      recordResult(true, "suppliers koleksiyonunda bulunmayan belgeyi genel okuma girişimi engellenir (resource==null kaldırıldı)");
    } catch (e: any) {
      recordResult(false, "suppliers bulunmayan belge okuması engellenmelidir", e.message);
    }

    // 8.2 Satış Idempotency Denetimi: Kendi tenant ön ekli bulunmayan belgeye get izni verilir
    try {
      await assertSucceeds(ownerADb.collection("sales").doc("tenant_A_idem_sale_new_001").get());
      recordResult(true, "Satış Idempotency: Kendi tenantId ön ekine sahip henüz mevcut olmayan belge başarıyla kontrol edilir (ALLOW)");
    } catch (e: any) {
      recordResult(false, "Kendi tenantId ön ekli satış idempotency get işlemi başarılı olmalıdır", e.message);
    }

    // 8.3 Satış Idempotency Denetimi: Yabancı tenant ön eki veya rastgele ID ile bulunmayan belge okunamaz
    try {
      await assertFails(ownerADb.collection("sales").doc("tenant_B_idem_sale_new_001").get());
      recordResult(true, "Satış Idempotency: Yabancı tenantId ön ekli bulunmayan belge kontrolü reddedilir (DENY)");
    } catch (e: any) {
      recordResult(false, "Yabancı tenant ön ekli satış get reddedilmelidir", e.message);
    }

    try {
      await assertFails(ownerADb.collection("sales").doc("random_arbitrary_sale_id").get());
      recordResult(true, "Satış Idempotency: Tenant ön eki taşımayan rastgele bulunmayan satış belgesi reddedilir (DENY)");
    } catch (e: any) {
      recordResult(false, "Rastgele satış get işlemi reddedilmelidir", e.message);
    }

    // 8.4 Sipariş Idempotency Denetimi
    try {
      await assertSucceeds(ownerADb.collection("orders").doc("tenant_A_idem_ord_new_001").get());
      recordResult(true, "Sipariş Idempotency: Kendi tenantId ön ekine sahip bulunmayan sipariş belgesi kontrol edilir (ALLOW)");
    } catch (e: any) {
      recordResult(false, "Kendi tenant ön ekli sipariş get işlemi başarılı olmalıdır", e.message);
    }

    try {
      await assertFails(ownerADb.collection("orders").doc("tenant_B_idem_ord_new_001").get());
      recordResult(true, "Sipariş Idempotency: Yabancı tenant ön ekli bulunmayan sipariş kontrolü reddedilir (DENY)");
    } catch (e: any) {
      recordResult(false, "Yabancı tenant ön ekli sipariş get reddedilmelidir", e.message);
    }

    // 8.5 Ödeme Idempotency Denetimi
    try {
      await assertSucceeds(ownerADb.collection("payments").doc("pay_tenant_A_idem_pay_new_001").get());
      recordResult(true, "Ödeme Idempotency: pay_{tenantId}_ ön ekli bulunmayan ödeme belgesi kontrol edilir (ALLOW)");
    } catch (e: any) {
      recordResult(false, "pay_{tenantId}_ ön ekli ödeme get işlemi başarılı olmalıdır", e.message);
    }

    try {
      await assertFails(ownerADb.collection("payments").doc("pay_tenant_B_idem_pay_new_001").get());
      recordResult(true, "Ödeme Idempotency: Yabancı tenant ön ekli bulunmayan ödeme kontrolü reddedilir (DENY)");
    } catch (e: any) {
      recordResult(false, "Yabancı tenant ön ekli ödeme get reddedilmelidir", e.message);
    }

    // 8.6 Yetkili Staff ve Cashier Audit Log Yazımı
    try {
      await assertSucceeds(staffADb.collection("audit_logs").add({
        tenantId: "tenant_A",
        userId: "user_staff_a",
        companyId: "tenant_A",
        action: "PRODUCT_UPDATED",
        entityType: "product",
        entityId: "prod_a_1",
        timestamp: new Date().toISOString(),
        details: { summary: "Personel stok güncelledi" }
      }));
      recordResult(true, "Yetkili Personel (staff) kendi tenantId'siyle başarıyla audit log kaydı oluşturur (ALLOW)");
    } catch (e: any) {
      recordResult(false, "Personel audit log yazabilmelidir", e.message);
    }

    try {
      await assertSucceeds(cashierADb.collection("audit_logs").add({
        tenantId: "tenant_A",
        userId: "user_cashier_a",
        companyId: "tenant_A",
        action: "SALE_CREATED",
        entityType: "sale",
        entityId: "sale_a_cashier_1",
        timestamp: new Date().toISOString(),
        details: { summary: "Kasiyer satış fişi kesti" }
      }));
      recordResult(true, "Yetkili Kasiyer (cashier) kendi tenantId'siyle başarıyla audit log kaydı oluşturur (ALLOW)");
    } catch (e: any) {
      recordResult(false, "Kasiyer audit log yazabilmelidir", e.message);
    }

    // 8.7 Personelin eksik/hatalı tenantId (fallback olarak kendi UID'si) ile audit log yazma girişimi engellenir
    try {
      await assertFails(staffADb.collection("audit_logs").add({
        tenantId: "user_staff_a", // YANLIŞ: companyId yerine personelin kendi UID'si kullanılmış fallback hatası simülasyonu
        userId: "user_staff_a",
        companyId: "user_staff_a",
        action: "PRODUCT_UPDATED",
        entityType: "product",
        entityId: "prod_a_1",
        timestamp: new Date().toISOString()
      }));
      recordResult(true, "Personelin kendi UID'sini tenantId yaparak sahte audit log yazma denemesi engellenir (DENY)");
    } catch (e: any) {
      recordResult(false, "Personelin UID'sini tenantId yapması engellenmelidir", e.message);
    }

    console.log(`\n=====================================================================`);
    console.log(`TEST TAMAMLANDI: Toplam Başarılı: ${passed} | Başarısız: ${failed}`);
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
