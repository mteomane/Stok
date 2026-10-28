/**
 * STOK-PRO — İŞLEM 7U: packageUnitsCount VE UNDEFINED ALAN REGRESYON TEST PAKETİ
 *
 * YALNIZCA Firebase Firestore Emulator üzerinde çalışır.
 * CANLI FIRESTORE'A KESİNLİKLE BAĞLANMAZ.
 *
 * Kapsam:
 * 1. packageUnitsCount verilmeden / undefined olarak ürün başarıyla kaydedilmeli (addDoc hatası üretmemeli).
 * 2. packageUnitsCount geçerli bir pozitif sayıyla gönderildiğinde (isPackaged: true, packageUnitsCount: 24) değer tam olarak saklanmalı.
 * 3. Ürün güncelleme (update) ve toplu içe aktarma (batchCreate) akışlarında undefined alanlar olsa bile hata oluşmamalı.
 * 4. Tenant izolasyonu ve yetkilendirme muhafazası doğrulanmalı.
 */

import {
  initializeTestEnvironment,
  RulesTestEnvironment
} from "@firebase/rules-unit-testing";
import * as fs from "fs";
import * as path from "path";
import { FirebaseProductRepository } from "../src/lib/repositories/firebase/FirebaseProductRepository";
import { FirebaseUserRepository } from "../src/lib/repositories/firebase/FirebaseUserRepository";
import { FirebaseSubscriptionRepository } from "../src/lib/repositories/firebase/FirebaseSubscriptionRepository";

const EMULATOR_HOST = "127.0.0.1";
const EMULATOR_PORT = 8088;
const TEST_PROJECT_ID = "demo-package-units-test";

async function runRegressionTests() {
  console.log("=====================================================================");
  console.log("STOK-PRO: packageUnitsCount & UNDEFINED PAYLOAD REGRESYON TESTLERİ");
  console.log(`Hedef Proje: ${TEST_PROJECT_ID} (Yalnızca Yerel Emulator)`);
  console.log("=====================================================================\n");

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

  const tenantA = "tenant_pkg_A";
  const userA = "usr_pkg_A";
  const tenantB = "tenant_pkg_B";
  const userB = "usr_pkg_B";

  // Bootstrap tenant & user profiles via admin context
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await adminDb.collection("tenants").doc(tenantA).set({
      id: tenantA,
      name: "Firma A Ambalaj",
      ownerUid: userA,
      plan: "pro",
      createdAt: new Date().toISOString()
    });
    await adminDb.collection("users").doc(userA).set({
      uid: userA,
      tenantId: tenantA,
      role: "owner",
      email: "firmaA@stokpro.test",
      displayName: "Firma A Yönetici",
      createdAt: new Date().toISOString(),
      isActive: true
    });

    await adminDb.collection("tenants").doc(tenantB).set({
      id: tenantB,
      name: "Firma B Tekstil",
      ownerUid: userB,
      plan: "pro",
      createdAt: new Date().toISOString()
    });
    await adminDb.collection("users").doc(userB).set({
      uid: userB,
      tenantId: tenantB,
      role: "owner",
      email: "firmaB@stokpro.test",
      displayName: "Firma B Yönetici",
      createdAt: new Date().toISOString(),
      isActive: true
    });
  });

  const authCtxA = testEnv.authenticatedContext(userA, { email: "firmaA@stokpro.test" });
  const dbA = authCtxA.firestore() as any;

  const authCtxB = testEnv.authenticatedContext(userB, { email: "firmaB@stokpro.test" });
  const dbB = authCtxB.firestore() as any;

  const userRepoA = new FirebaseUserRepository(dbA);
  const subRepoA = new FirebaseSubscriptionRepository(userRepoA, dbA);
  const prodRepoA = new FirebaseProductRepository(userRepoA, subRepoA, dbA);

  const userRepoB = new FirebaseUserRepository(dbB);
  const subRepoB = new FirebaseSubscriptionRepository(userRepoB, dbB);
  const prodRepoB = new FirebaseProductRepository(userRepoB, subRepoB, dbB);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${msg}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // SENARYO 1: packageUnitsCount verilmeden / undefined olarak ürün ekleme
  // -------------------------------------------------------------
  console.log("--- SENARYO 1: packageUnitsCount Verilmeden (veya undefined) Ürün Ekleme ---");
  let createdProduct1: any;
  try {
    createdProduct1 = await prodRepoA.create(userA, {
      name: "Standart Düğme Paketsiz",
      price: 25,
      stock: 500,
      minStock: 50,
      unit: "Adet",
      category: "Aksesuar",
      isPackaged: false,
      packageUnitsCount: undefined,
      packageUnitName: undefined,
      subUnitStock: undefined
    } as any);

    assert(createdProduct1 && !!createdProduct1.id, "Ürün addDoc() hatası olmadan başarıyla kaydedildi");
    assert(createdProduct1.isPackaged === false, "isPackaged false olarak kaydedildi");

    // Firestore dokümanında doğrudan alan kontrolü
    const snap = await dbA.collection("products").doc(createdProduct1.id).get();
    const data = snap.data();
    assert(data.packageUnitsCount === undefined, "Firestore belgesinde packageUnitsCount alanı undefined (hiç yok)");
    assert(data.subUnitStock === undefined, "Firestore belgesinde subUnitStock alanı undefined (hiç yok)");
  } catch (err: any) {
    console.error("  [FAIL] Senaryo 1 Hatası:", err);
    failed++;
  }

  // -------------------------------------------------------------
  // SENARYO 2: packageUnitsCount geçerli bir sayıyla gönderildiğinde saklanması
  // -------------------------------------------------------------
  console.log("\n--- SENARYO 2: packageUnitsCount Sayısal Değerle Gönderildiğinde ---");
  let createdProduct2: any;
  try {
    createdProduct2 = await prodRepoA.create(userA, {
      name: "Koli İçi İçecek 24'lü",
      sku: "PKG-24",
      price: 240,
      stock: 20,
      minStock: 5,
      unit: "Koli",
      category: "İçecek",
      isPackaged: true,
      packageUnitsCount: 24,
      packageUnitName: "Şişe",
      subUnitStock: 24
    });

    assert(createdProduct2 && !!createdProduct2.id, "Paketli ürün başarıyla kaydedildi");
    assert(createdProduct2.isPackaged === true, "isPackaged true olarak kaydedildi");

    const snap = await dbA.collection("products").doc(createdProduct2.id).get();
    const data = snap.data();
    assert(data.packageUnitsCount === 24, "packageUnitsCount değeri Firestore'a tam 24 olarak yazıldı");
    assert(data.packageUnitName === "Şişe", "packageUnitName 'Şişe' olarak yazıldı");
    assert(data.subUnitStock === 24, "subUnitStock 24 olarak yazıldı");
  } catch (err: any) {
    console.error("  [FAIL] Senaryo 2 Hatası:", err);
    failed++;
  }

  // -------------------------------------------------------------
  // SENARYO 3: Ürün Güncelleme ve Toplu İçe Aktarma (batchCreate)
  // -------------------------------------------------------------
  console.log("\n--- SENARYO 3: Ürün Güncelleme (updateDoc) ve Toplu Kayıt (batch.set) ---");
  try {
    // 3.1: Update with undefined fields
    await prodRepoA.update(createdProduct1.id, {
      price: 30,
      packageUnitsCount: undefined,
      packageUnitName: undefined,
      subUnitStock: undefined
    } as any, userA);

    const updatedSnap = await dbA.collection("products").doc(createdProduct1.id).get();
    assert(updatedSnap.data()?.price === 30, "updateDoc() çağrısı undefined alanlar içerse dahi başarıyla güncelledi");

    // 3.2: batchCreate with undefined fields (Excel import simulation)
    const batchList = await prodRepoA.batchCreate(userA, [
      {
        name: "İthal Fermuar #1",
        price: 15,
        stock: 100,
        minStock: 10,
        unit: "Adet",
        category: "Tekstil",
        isPackaged: false,
        packageUnitsCount: undefined,
        packageUnitName: undefined,
        costPrice: undefined
      } as any,
      {
        name: "Kutu İçi İğne 100'lü",
        price: 85,
        stock: 50,
        minStock: 5,
        unit: "Kutu",
        category: "Hırdavat",
        isPackaged: true,
        packageUnitsCount: 100,
        packageUnitName: "Adet"
      }
    ]);

    assert(batchList.length === 2, "batchCreate() ile 2 ürün başarıyla yazıldı");
    const batchSnap1 = await dbA.collection("products").doc(batchList[0].id).get();
    assert(batchSnap1.data()?.packageUnitsCount === undefined, "Paketsiz batch ürün Firestore'a undefined hatası olmadan yazıldı");
    const batchSnap2 = await dbA.collection("products").doc(batchList[1].id).get();
    assert(batchSnap2.data()?.packageUnitsCount === 100, "Paketli batch ürün packageUnitsCount=100 olarak yazıldı");
  } catch (err: any) {
    console.error("  [FAIL] Senaryo 3 Hatası:", err);
    failed++;
  }

  // -------------------------------------------------------------
  // SENARYO 4: Tenant İzolasyonu ve Güvenlik Denetimleri
  // -------------------------------------------------------------
  console.log("\n--- SENARYO 4: Tenant İzolasyonu ve Güvenlik Sınırları ---");
  try {
    // Firma B, Firma A'nın eklediği ürünü okuyamaz
    let couldRead = false;
    try {
      await dbB.collection("products").doc(createdProduct1.id).get();
      couldRead = true;
    } catch {
      couldRead = false;
    }
    assert(!couldRead, "Firma B, Firma A'nın ürününü okuyamaz (Tenant İzolasyonu Aktif)");

    // Firma B, Firma A'nın ürününü güncelleyemez
    let couldUpdate = false;
    try {
      await prodRepoB.update(createdProduct1.id, { name: "Hack Denemesi" }, userB);
      couldUpdate = true;
    } catch {
      couldUpdate = false;
    }
    assert(!couldUpdate, "Firma B, Firma A'nın ürününü güncelleyemez (DENY)");
  } catch (err: any) {
    console.error("  [FAIL] Senaryo 4 Hatası:", err);
    failed++;
  }

  await testEnv.cleanup();

  console.log("\n=====================================================================");
  console.log(`TEST TAMAMLANDI: Toplam Başarılı: ${passed} | Başarısız: ${failed}`);
  console.log("=====================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionTests().catch((err) => {
  console.error("Regression test error:", err);
  process.exit(1);
});
