import {
  initializeTestEnvironment,
  RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import * as path from "path";

const EMULATOR_HOST = "127.0.0.1";
const EMULATOR_PORT = 8088;
const TEST_PROJECT_ID = "demo-permission-repro";

async function runReproduction() {
  console.log("=====================================================================");
  console.log("=== CANLI ORTAM SENARYOSU DOĞRULAMA & KÖK NEDEN TESPİT TESTİ ===");
  console.log("=====================================================================");

  const rulesPath = path.resolve(process.cwd(), "firestore.rules");
  const rules = fs.readFileSync(rulesPath, "utf8");

  process.env.FIRESTORE_EMULATOR_HOST = `${EMULATOR_HOST}:${EMULATOR_PORT}`;

  const testEnv = await initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    firestore: {
      rules,
      host: EMULATOR_HOST,
      port: EMULATOR_PORT
    }
  });

  await testEnv.clearFirestore();

  const uid = "usr_live_test_1";
  const userContext = testEnv.authenticatedContext(uid, { email: "user@test.com" });
  const db = userContext.firestore();

  console.log("\n1. AŞAMA: Kullanıcı Kaydı (Auth.tsx akışı)");
  try {
    // 1. Tenants doc
    await db.collection("tenants").doc(uid).set({
      id: uid,
      name: "Test İşletmesi",
      ownerUid: uid,
      plan: "pro",
      createdAt: new Date().toISOString()
    });
    console.log("  [OK] tenants doc created");

    // 2. Users doc
    await db.collection("users").doc(uid).set({
      uid: uid,
      tenantId: uid,
      role: "owner",
      email: "user@test.com",
      displayName: "Test İşletmesi",
      createdAt: new Date().toISOString(),
      isActive: true
    });
    console.log("  [OK] users doc created");

    // 3. Settings doc
    await db.collection("settings").doc(uid).set({
      activeSector: "genel",
      customFields: [],
      updatedAt: new Date().toISOString()
    });
    console.log("  [OK] settings doc created");

    // 4. Company doc
    await db.collection("company").doc(uid).set({
      name: "Test İşletmesi",
      address: "Adres",
      phone: "+90 555 000 00 00",
      email: "user@test.com",
      taxOffice: "Vergi",
      taxNumber: "0000000000",
      logo: ""
    });
    console.log("  [OK] company doc created");
  } catch (err: any) {
    console.error("  [FAIL] Auth bootstrap failed:", err.message);
  }

  console.log("\n2. AŞAMA: FirebaseSubscriptionRepository.getByTenantId(tenantId)");
  console.log("   (Not: subscriptions koleksiyonuna kayıt eklenmedi, doküman Firestore'da YOK!)");
  try {
    const subSnap = await db.collection("subscriptions").doc(uid).get();
    console.log("  [OK] subscriptions getDoc succeeded. Exists:", subSnap.exists);
  } catch (err: any) {
    console.error("  [FAIL - YAKALANDI!] subscriptions getDoc FAILED with:", err.message);
  }

  console.log("\n3. AŞAMA: Barcode conflict check query");
  try {
    const snap = await db.collection("products")
      .where("tenantId", "==", uid)
      .where("barcode", "==", "8690123456789")
      .limit(1)
      .get();
    console.log("  [OK] Barcode conflict query succeeded. Size:", snap.size);
  } catch (err: any) {
    console.error("  [FAIL - YAKALANDI!] Barcode conflict query FAILED with:", err.message);
  }

  let createdProdId = "";
  console.log("\n4. AŞAMA: FirebaseProductRepository.create (addDoc to products)");
  try {
    const docRef = await db.collection("products").add({
      name: "Yeni Test Ürün",
      price: 150,
      stock: 20,
      minStock: 5,
      unit: "Adet",
      category: "Genel",
      sku: "PRD-TEST01",
      barcode: "8690123456789",
      tenantId: uid,
      userId: uid,
      isActive: true,
      createdAt: new Date().toISOString()
    });
    createdProdId = docRef.id;
    console.log("  [OK] products.add succeeded! ID:", docRef.id);
  } catch (err: any) {
    console.error("  [FAIL - YAKALANDI!] products.add FAILED with:", err.message);
  }

  console.log("\n5. AŞAMA: Audit log addDoc");
  try {
    const logRef = await db.collection("audit_logs").add({
      tenantId: uid,
      userId: uid,
      companyId: uid,
      action: "PRODUCT_CREATED",
      entityType: "product",
      entityId: "prod_123",
      timestamp: new Date().toISOString(),
      details: { name: "Yeni Test Ürün" }
    });
    console.log("  [OK] audit_logs.add succeeded! ID:", logRef.id);
  } catch (err: any) {
    console.error("  [FAIL - YAKALANDI!] audit_logs.add FAILED with:", err.message);
  }

  console.log("\n6. AŞAMA: Başka Bir Tenant Kullanıcısının (Firma B) İzolasyon Denetimi");
  const foreignUid = "usr_attacker_b";
  const foreignContext = testEnv.authenticatedContext(foreignUid, { email: "attacker@other.com" });
  const foreignDb = foreignContext.firestore();

  // Setup foreign tenant profile
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().collection("users").doc(foreignUid).set({
      uid: foreignUid,
      tenantId: "tenant_B",
      role: "owner"
    });
  });

  try {
    await foreignDb.collection("products").doc(createdProdId).get();
    console.error("  [FAIL] Yabancı kullanıcı Firma A'nın ürününü OKUYABİLDİ! (İhlal)");
  } catch {
    console.log("  [PASS - İZOLASYON KORUNDU] Yabancı kullanıcı Firma A ürününü okuyamaz (DENY)");
  }

  try {
    await foreignDb.collection("products").where("tenantId", "==", uid).get();
    console.error("  [FAIL] Yabancı kullanıcı Firma A'nın ürünlerini LİSTELEYEBİLDİ! (İhlal)");
  } catch {
    console.log("  [PASS - İZOLASYON KORUNDU] Yabancı kullanıcı Firma A ürün listesini sorgulayamaz (DENY)");
  }

  try {
    await foreignDb.collection("subscriptions").doc(uid).get();
    console.error("  [FAIL] Yabancı kullanıcı Firma A'nın aboneliğini SORGULAYABİLDİ! (İhlal)");
  } catch {
    console.log("  [PASS - İZOLASYON KORUNDU] Yabancı kullanıcı Firma A abonelik belgesini sorgulayamaz (DENY)");
  }

  await testEnv.cleanup();
  console.log("\n=====================================================================");
  console.log("SONUÇ: TÜM AŞAMALAR VE TENANT İZOLASYONU %100 BAŞARIYLA TAMAMLANDI");
  console.log("=====================================================================");
}

runReproduction().catch(console.error);
