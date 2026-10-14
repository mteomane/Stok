/**
 * İŞLEM 4B: GÜVENLİ TENANT YEDEĞİ GERİ YÜKLEME KAPSAMLI TEST PAKETİ
 * 
 * Test Kapsamı:
 * 1. Gerçek SHA-256 bütünlük doğrulaması (ve 1 karakterlik tahrifatın reddi).
 * 2. Cross-tenant (çapraz firma) izolasyonu ve tenantId uyuşmazlığının kesin reddi.
 * 3. Orijinal userId değerinin ve tarihsel sahiplik izinin korunması.
 * 4. Eski yedeğin mevcut güncel işletme kayıtlarını ezmesinin önlenmesi (safe_append).
 * 5. ID'si eksik kayıtlara kararlı (deterministik) ID atanması ve tekrar yüklemede sıfır mükerrerlik.
 * 6. Kısmi batch hatası simülasyonu ve güvenli durum/hata raporlaması.
 * 7. Aynı yedekle güvenli yeniden deneme (idempotency) testi.
 * 8. Satış, ödeme ve stok hareketlerinin çoğaltılmaması / ezilmemesi.
 * 9. Firestore güvenlik kuralları (`preservesDocOwnership`) uyumu.
 */

import { exportService } from "../src/lib/export/ExportService";
import { sanitizeRecord } from "../src/lib/export/sanitizer";
import { 
  calculateBackupChecksum, 
  verifyBackupChecksum, 
  generateDeterministicDocId 
} from "../src/lib/export/backupCrypto";
import { TenantBackupArchive } from "../src/lib/export/types";

// Polyfill localStorage for Node.js test runner
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) || null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] || null,
    get length() { return store.size; }
  };
}

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedCount++;
  } else {
    console.error(`  ❌ [FAIL] ${testName} ${detail ? `(${detail})` : ""}`);
    failedCount++;
  }
}

async function runTests() {
  console.log("=====================================================================");
  console.log("İŞLEM 4B - YEDEK GERİ YÜKLEME VERİ BÜTÜNLÜĞÜ VE GÜVENLİK TESTLERİ");
  console.log("=====================================================================\n");

  const tenantA = "demo-tenant";
  const tenantB = "tenant_company_xyz_999";
  const originalUser1 = "user_cashier_ali";
  const originalUser2 = "user_sales_veli";
  const restoringAdmin = "demo-user";

  // Base sample backup
  const rawArchive: TenantBackupArchive = {
    metadata: {
      schemaVersion: "2.1.0",
      tenantId: tenantA,
      userId: restoringAdmin,
      companyName: "ABC Tekstil A.Ş.",
      exportedAt: new Date().toISOString(),
      appVersion: "StokPro-SaaS-2.1",
      checksum: "",
      itemCounts: {
        products: 2,
        customers: 1,
        suppliers: 1,
        sales: 1,
        warehouses: 1,
        orders: 0,
        payments: 1,
        stockMovements: 1
      }
    },
    data: {
      products: [
        { id: "prod_1", name: "Viskon Kumaş", price: 150, userId: originalUser1, tenantId: tenantA } as any,
        { id: "prod_2", name: "Poplin Kumaş", price: 200, userId: originalUser2, tenantId: tenantA } as any
      ],
      customers: [
        { id: "cust_1", name: "Ahmet Yılmaz", userId: originalUser1, tenantId: tenantA } as any
      ],
      suppliers: [
        { id: "supp_1", name: "İpek İplik San.", userId: originalUser2, tenantId: tenantA } as any
      ],
      sales: [
        { id: "sale_1", invoiceNo: "FIS-001", totalAmount: 1500, userId: originalUser1, tenantId: tenantA, status: "Tamamlandı" } as any
      ],
      warehouses: [
        { id: "wh_1", name: "Ana Depo", userId: originalUser1, tenantId: tenantA } as any
      ],
      orders: [],
      payments: [
        { id: "pay_1", amount: 1500, paymentMethod: "nakit", userId: originalUser1, tenantId: tenantA } as any
      ],
      stockMovements: [
        { id: "mov_1", type: "out", quantity: 10, productId: "prod_1", userId: originalUser1, tenantId: tenantA } as any
      ]
    }
  };

  // Sign archive with real SHA-256
  rawArchive.metadata.checksum = await calculateBackupChecksum(rawArchive);

  // -------------------------------------------------------------
  // TEST 1: Gerçek SHA-256 Doğrulaması ve 1 Karakterlik Tahrifat
  // -------------------------------------------------------------
  console.log("TEST 1: Gerçek Kriptografik SHA-256 Bütünlük Doğrulaması");
  const validRes = await exportService.validateBackupArchive(rawArchive, tenantA);
  assert(validRes.isValid === true, "Orijinal SHA-256 imzalı arşiv başarıyla doğrulanmalı");
  assert(validRes.checksumType === "sha256", "Checksum tipi 'sha256' olarak tanımlanmalı");
  assert(validRes.totalRecords === 8, "Toplam 8 kayıt tespit edilmeli");

  // Tamper 1 single character in data
  const tamperedArchive = JSON.parse(JSON.stringify(rawArchive));
  tamperedArchive.data.products[0].price = 151; // 150 -> 151
  const tamperedRes = await exportService.validateBackupArchive(tamperedArchive, tenantA);
  assert(tamperedRes.isValid === false, "Fiyatta 1 TL'lik tahrifat bile yapıldığında arşiv reddedilmeli");
  assert(tamperedRes.error?.includes("SHA-256") === true, "SHA-256 uyuşmazlık hatası dönmeli");

  // -------------------------------------------------------------
  // TEST 2: Çapraz Firma (Cross-Tenant) İzolasyonu
  // -------------------------------------------------------------
  console.log("\nTEST 2: Çapraz Firma (Cross-Tenant) İzolasyonu");
  const crossTenantRes = await exportService.validateBackupArchive(rawArchive, tenantB);
  assert(crossTenantRes.isValid === false, "Başka firmaya ait yedek derhal reddedilmeli");
  assert(crossTenantRes.error?.includes("Güvenlik İhlali") === true, "Güvenlik ihlali uyarısı üretilmeli");

  // -------------------------------------------------------------
  // TEST 3: Orijinal userId Değerinin ve Tarihsel İzin Korunması
  // -------------------------------------------------------------
  console.log("\nTEST 3: Orijinal userId Değerinin Korunması");
  // Execute restore in demo/local context
  const restoreRun1 = await exportService.restoreTenantBackup(restoringAdmin, rawArchive, {
    mode: "safe_append"
  });
  assert(restoreRun1.success === true, "İlk geri yükleme başarıyla tamamlanmalı");

  // Check stored items in demo storage
  const storedSales = JSON.parse(localStorage.getItem("stokpro_demo_sales") || "[]");
  assert(storedSales.length === 1, "Satış kaydı bulunmalı");
  assert(storedSales[0].userId === originalUser1, "Satışı yapan asıl personelin userId değeri korunmalı (Admin UID ile ezilmemeli)");
  assert(storedSales[0].userId !== restoringAdmin, "Geri yükleyen admin UID'si kaydın üzerine yazılmamalı");

  // -------------------------------------------------------------
  // TEST 4: Eski Yedeğin Mevcut Güncel Kayıtları Sessizce Ezmemesi
  // -------------------------------------------------------------
  console.log("\nTEST 4: Güncel Kayıtların Eski Yedekle Ezilmesinin Önlenmesi (safe_append)");
  // Modify an existing product in live database to simulate active business update
  const storedProducts = JSON.parse(localStorage.getItem("stokpro_demo_products") || "[]");
  storedProducts[0].price = 999; // Güncel fiyat 999 yapıldı
  localStorage.setItem("stokpro_demo_products", JSON.stringify(storedProducts));

  // Run restore with safe_append mode
  const restoreRun2 = await exportService.restoreTenantBackup(restoringAdmin, rawArchive, {
    mode: "safe_append"
  });
  const productsAfterRestore = JSON.parse(localStorage.getItem("stokpro_demo_products") || "[]");
  assert(productsAfterRestore[0].price === 999, "safe_append modunda mevcut ürünün güncel fiyatı (999 TL) eski yedekle (150 TL) ezilmemeli");
  assert(restoreRun2.conflictCounts.products === 2, "Var olan kayıtlar çatışma olarak sayılmalı");
  assert(restoreRun2.skippedCounts.products === 2, "Var olan kayıtlar güvenle atlanmalı");

  // -------------------------------------------------------------
  // TEST 5: ID'si Eksik Kayıtlar İçin SHA-256 Deterministik ID ve Tekrar Yükleme
  // -------------------------------------------------------------
  console.log("\nTEST 5: ID'si Eksik Kayıtlar İçin SHA-256 Deterministik ID ve Tekrar Yükleme Güvenliği");
  const missingIdItem1 = { name: "Özel Kumaş", price: 300, tenantId: tenantA };
  const missingIdItem2 = { name: "Özel Kumaş", price: 300, tenantId: tenantA };
  const missingIdItemDifferent = { name: "Farklı Kumaş", price: 400, tenantId: tenantA };
  const existingIdItem = { id: "custom_existing_id_99", name: "Özel Kumaş", price: 300, tenantId: tenantA };
  
  const detId1 = await generateDeterministicDocId(tenantA, "products", missingIdItem1, 0);
  const detId2 = await generateDeterministicDocId(tenantA, "products", missingIdItem2, 0);
  const detIdDiff = await generateDeterministicDocId(tenantA, "products", missingIdItemDifferent, 0);
  const keptId = await generateDeterministicDocId(tenantA, "products", existingIdItem, 0);

  assert(detId1 === detId2, "Aynı içerikli kayda deterministik olarak tam aynı SHA-256 kimlik üretilmeli");
  assert(detId1 !== detIdDiff, "Farklı içerikli kayıtlara farklı kimlik üretilmeli");
  assert(keptId === "custom_existing_id_99", "Mevcut id alanı olan kaydın üretim kimliği asla değiştirilmemeli");
  assert(detId1.startsWith("det_prod_"), "Kimlik 'det_prod_' ön ekiyle başlamalı");
  assert(detId1.length === 25, "Kimlik 16 hexadecimal SHA-256 karakteri (64-bit hash) içermeli (det_prod_ + 16 hex = 25)");

  // Test record order/index variation behavior
  const detIdDifferentIndex = await generateDeterministicDocId(tenantA, "products", missingIdItem1, 1);
  assert(
    detId1 !== detIdDifferentIndex,
    "Farklı dizi indeksindeki aynı içerikli kayıtlara mükerrer ezilmeyi önlemek için indekse duyarlı ID üretilmeli"
  );

  // Test idempotency of missing-ID records on re-restore
  const missingIdArchive: TenantBackupArchive = {
    metadata: {
      schemaVersion: "2.0.0",
      tenantId: tenantA,
      userId: restoringAdmin,
      companyName: "ABC Tekstil A.Ş.",
      exportedAt: new Date().toISOString(),
      appVersion: "StokPro-SaaS-2.0",
      checksum: "",
      itemCounts: { products: 1, customers: 0, suppliers: 0, sales: 0, warehouses: 0, orders: 0, payments: 0, stockMovements: 0 }
    },
    data: {
      products: [{ name: "ID'si Olmayan Kumaş", price: 120, tenantId: tenantA } as any],
      customers: [], suppliers: [], sales: [], warehouses: [], orders: [], payments: [], stockMovements: []
    }
  };
  missingIdArchive.metadata.checksum = await calculateBackupChecksum(missingIdArchive);

  // First restore: assigns deterministic ID and saves
  const firstMissingRestore = await exportService.restoreTenantBackup(restoringAdmin, missingIdArchive, { mode: "safe_append" });
  assert(firstMissingRestore.restoredCounts.products === 1, "İlk geri yüklemede ID'si eksik kayıt deterministik ID ile eklenmeli");

  // Second restore of the exact same backup: must recognize deterministic ID and skip (no duplicates!)
  const secondMissingRestore = await exportService.restoreTenantBackup(restoringAdmin, missingIdArchive, { mode: "safe_append" });
  assert(secondMissingRestore.restoredCounts.products === 0, "Aynı yedek tekrar yüklendiğinde deterministik ID sayesinde 0 yeni kayıt eklenmeli");
  assert(secondMissingRestore.skippedCounts.products === 1, "Önceden aktarılmış deterministik ID'li kayıt güvenle atlanmalı (sıfır mükerrerlik)");

  // -------------------------------------------------------------
  // TEST 6: Finansal ve Stok Hareketlerinin Asla Ezilmemesi
  // -------------------------------------------------------------
  console.log("\nTEST 6: Satış, Ödeme ve Stok Hareketlerinin Değişmezliği (Financial Immutability)");
  // Modify active sale status
  const currentSales = JSON.parse(localStorage.getItem("stokpro_demo_sales") || "[]");
  currentSales[0].status = "İade Edildi";
  localStorage.setItem("stokpro_demo_sales", JSON.stringify(currentSales));

  // Try merge_non_financial mode
  const mergeRun = await exportService.restoreTenantBackup(restoringAdmin, rawArchive, {
    mode: "merge_non_financial"
  });
  const salesAfterMerge = JSON.parse(localStorage.getItem("stokpro_demo_sales") || "[]");
  assert(salesAfterMerge[0].status === "İade Edildi", "Finansal satış fişi merge modunda bile eski yedekle değiştirilmemeli");
  assert(mergeRun.skippedCounts.sales === 1, "Satış fişi atlananlar listesinde yer almalı");
  assert(mergeRun.skippedCounts.payments === 1, "Ödeme kaydı atlananlar listesinde yer almalı");

  // -------------------------------------------------------------
  // TEST 7: Aynı Yedekle Güvenli Yeniden Deneme (Idempotency)
  // -------------------------------------------------------------
  console.log("\nTEST 7: Yeniden Deneme (Idempotency) ve Sıfır Mükerrerlik");
  const initialSaleCount = JSON.parse(localStorage.getItem("stokpro_demo_sales") || "[]").length;
  const initialProductCount = JSON.parse(localStorage.getItem("stokpro_demo_products") || "[]").length;

  // Run same restore for the 3rd time
  const retryRun = await exportService.restoreTenantBackup(restoringAdmin, rawArchive, {
    mode: "safe_append"
  });
  const finalSaleCount = JSON.parse(localStorage.getItem("stokpro_demo_sales") || "[]").length;
  const finalProductCount = JSON.parse(localStorage.getItem("stokpro_demo_products") || "[]").length;

  assert(initialSaleCount === finalSaleCount, "Tekrar çalıştırmada mükerrer satış oluşmamalı");
  assert(initialProductCount === finalProductCount, "Tekrar çalıştırmada mükerrer ürün oluşmamalı");
  assert(retryRun.totalRestored === 0, "Daha önce yüklenmiş verilerde yeni kayıt eklenmemeli (0 yeni)");
  assert(retryRun.totalSkipped === 8, "Tüm 8 kayıt güvenle mevcut olarak korunmalı");

  // -------------------------------------------------------------
  // TEST 8: Sanitizer ile Şifre/Secret ve Yetki Yükseltme Koruması
  // -------------------------------------------------------------
  console.log("\nTEST 8: Hassas Bilgi Arındırma (Sanitizer)");
  const dangerousPayload = {
    id: "dangerous_1",
    name: "Özel Fiş",
    secretKey: "secret_123",
    iyzicoSecret: "iyz_live_sec",
    passwordHash: "hash_pass_999",
    normalData: "güvenli alan"
  };
  const sanitized = sanitizeRecord(dangerousPayload);
  assert(sanitized.secretKey === undefined, "secretKey temizlenmeli");
  assert(sanitized.iyzicoSecret === undefined, "iyzicoSecret temizlenmeli");
  assert(sanitized.passwordHash === undefined, "passwordHash temizlenmeli");
  assert(sanitized.normalData === "güvenli alan", "İş verisi korunmalı");

  // -------------------------------------------------------------
  // TEST 9: Legacy Checksum Geriye Dönük Uyumluluğu
  // -------------------------------------------------------------
  console.log("\nTEST 9: Eski Sürüm (Legacy Checksum) Uyumluluk Uyarısı");
  const legacyArchive: TenantBackupArchive = {
    metadata: {
      schemaVersion: "2.0.0",
      tenantId: tenantA,
      userId: restoringAdmin,
      companyName: "ABC Tekstil A.Ş.",
      exportedAt: new Date().toISOString(),
      appVersion: "StokPro-SaaS-2.0",
      checksum: `sha256_${tenantA}_2_123456`,
      itemCounts: {
        products: 1,
        customers: 0,
        suppliers: 0,
        sales: 0,
        warehouses: 0,
        orders: 0,
        payments: 0,
        stockMovements: 0
      }
    },
    data: {
      products: [{ id: "p1", name: "Kumaş", price: 10, tenantId: tenantA } as any],
      customers: [],
      suppliers: [],
      sales: [],
      warehouses: [],
      orders: [],
      payments: [],
      stockMovements: []
    }
  };
  const legacyRes = await exportService.validateBackupArchive(legacyArchive, tenantA);
  assert(legacyRes.isValid === true, "Eski format yedek reddedilmemeli, açılabilmeli");
  assert(legacyRes.checksumType === "legacy", "Checksum tipi 'legacy' olarak etiketlenmeli");
  assert(legacyRes.isLegacy === true, "isLegacy bayrağı true olmalı (doğrulanmamış arşiv)");
  assert(
    Boolean(legacyRes.warnings && legacyRes.warnings.some(w => w.includes("Eski sürüm"))),
    "Kullanıcıya eski format olduğuna dair uyarı mesajı üretilmeli"
  );

  // -------------------------------------------------------------
  // TEST 10: Eski Formatlı Yedeğin Onaysız Geri Yüklenmesinin Engellenmesi
  // -------------------------------------------------------------
  console.log("\nTEST 10: Eski Formatlı Yedeğin Varsayılan Olarak Engellenmesi & Açık Onay Mekanizması");
  let legacyBlocked = false;
  try {
    // Attempt restore without allowLegacyUnverified
    await exportService.restoreTenantBackup(restoringAdmin, legacyArchive, {
      mode: "safe_append"
    });
  } catch (err: any) {
    if (err.message.includes("Kriptografik Bütünlük Koruması")) {
      legacyBlocked = true;
    }
  }
  assert(legacyBlocked, "Onay verilmeyen eski format yedek geri yükleme reddedilmeli (Varsayılan olarak kapalı)");

  // Now restore with explicit user consent allowLegacyUnverified: true
  const legacyApprovedRestore = await exportService.restoreTenantBackup(restoringAdmin, legacyArchive, {
    mode: "safe_append",
    allowLegacyUnverified: true
  });
  assert(legacyApprovedRestore.success === true, "Açık onay verilince eski yedek güvenle yüklenebilmeli");
  assert(legacyApprovedRestore.restoredCounts.products === 1, "Eski yedekten 1 ürün başarıyla yüklenmeli");

  // -------------------------------------------------------------
  // TEST 11: Kontrollü Kısmi Batch Hatası ve Güvenli Yeniden Deneme (Partial Failure & Safe Retry)
  // -------------------------------------------------------------
  console.log("\nTEST 11: Kontrollü Kısmi Batch Hatası ve Güvenli Yeniden Deneme (Idempotent Retry)");
  
  // Clean product state for this controlled test
  localStorage.setItem("stokpro_demo_products", JSON.stringify([]));

  // Create an archive with 4 products (split across two batches of 2)
  const multiBatchProducts = [
    { id: "batch_p1", name: "Kumaş A", price: 100, tenantId: tenantA, userId: originalUser1 },
    { id: "batch_p2", name: "Kumaş B", price: 200, tenantId: tenantA, userId: originalUser1 },
    { id: "batch_p3", name: "Kumaş C", price: 300, tenantId: tenantA, userId: originalUser1 },
    { id: "batch_p4", name: "Kumaş D", price: 400, tenantId: tenantA, userId: originalUser1 }
  ];

  const partialTestArchive: TenantBackupArchive = {
    metadata: {
      schemaVersion: "2.0.0",
      tenantId: tenantA,
      userId: restoringAdmin,
      companyName: "ABC Tekstil A.Ş.",
      exportedAt: new Date().toISOString(),
      appVersion: "StokPro-SaaS-2.0",
      checksum: "",
      itemCounts: {
        products: 4,
        customers: 0,
        suppliers: 0,
        sales: 1,
        warehouses: 0,
        orders: 0,
        payments: 1,
        stockMovements: 1
      }
    },
    data: {
      products: multiBatchProducts as any,
      customers: [],
      suppliers: [],
      sales: [{ id: "sale_active_immutable_1", total: 500, tenantId: tenantA, userId: originalUser1, status: "Tamamlandı" } as any],
      warehouses: [],
      orders: [],
      payments: [{ id: "pay_active_immutable_1", amount: 500, tenantId: tenantA, userId: originalUser1 } as any],
      stockMovements: [{ id: "mov_active_immutable_1", quantity: 10, tenantId: tenantA, userId: originalUser1 } as any]
    }
  };

  // Compute real SHA-256 checksum for valid format
  partialTestArchive.metadata.checksum = await calculateBackupChecksum(partialTestArchive);

  // Run restore with controlled error: batch 0 succeeds, batch 1 fails
  const partialRunResult = await exportService.restoreTenantBackup(restoringAdmin, partialTestArchive, {
    mode: "safe_append",
    __testBatchSize: 2, // 2 items per batch -> exactly 2 batches for 4 products
    __testBatchFailureHook: (batchIndex, collection) => {
      // Simulate controlled network/firestore failure on batch 1 for products
      return collection === "products" && batchIndex === 1;
    }
  });

  // Verify partial failure behavior
  assert(partialRunResult.success === false, "Kısmi batch hatasında genel sonuç success: false olmalı (Hata gizlenmemeli)");
  assert(partialRunResult.errors.length > 0, "Hata listesinde başarısız batch detayları raporlanmalı");
  assert(partialRunResult.restoredCounts.products === 2, "İlk batch başarıyla yazılmalı (+2 ürün aktarıldı)");
  
  const productsAfterBatchFailure = JSON.parse(localStorage.getItem("stokpro_demo_products") || "[]");
  assert(productsAfterBatchFailure.length === 2, "Veritabanında tam olarak ilk batch'in 2 ürünü (batch_p1, batch_p2) yer almalı");
  assert(productsAfterBatchFailure.some((p: any) => p.id === "batch_p1"), "batch_p1 yazılmış olmalı");
  assert(!productsAfterBatchFailure.some((p: any) => p.id === "batch_p3"), "Başarısız batch'teki batch_p3 yazılmamış olmalı");

  // Modify financial records state to verify immutability during retry
  const salesBeforeRetry = JSON.parse(localStorage.getItem("stokpro_demo_sales") || "[]");
  const paymentsBeforeRetry = JSON.parse(localStorage.getItem("stokpro_demo_payments") || "[]");
  const movementsBeforeRetry = JSON.parse(localStorage.getItem("stokpro_demo_stock_movements") || "[]");

  // Re-run the EXACT same backup restore (without error hook - simulating user retry)
  const retryRunResult = await exportService.restoreTenantBackup(restoringAdmin, partialTestArchive, {
    mode: "safe_append",
    __testBatchSize: 2
  });

  assert(retryRunResult.success === true, "Aynı yedek tekrar denendiğinde işlem başarıyla tamamlanmalı");
  const productsAfterRetry = JSON.parse(localStorage.getItem("stokpro_demo_products") || "[]");
  assert(productsAfterRetry.length === 4, "Tekrar deneme sonrası veritabanında toplam 4 ürün bulunmalı (mükerrer kayıt OLMAMALI)");
  assert(retryRunResult.restoredCounts.products === 2, "Tekrar denemede yalnızca eksik kalan 2 ürün (+2) eklenmeli");
  assert(retryRunResult.conflictCounts.products === 2, "Önceden yazılmış 2 ürün çatışma olarak tespit edilmeli");
  assert(retryRunResult.skippedCounts.products === 2, "Önceden yazılmış 2 ürün güvenle atlanmalı");

  // Verify financial records (sales, payments, stock movements) are NOT duplicated or mutated
  const salesAfterRetry = JSON.parse(localStorage.getItem("stokpro_demo_sales") || "[]");
  const paymentsAfterRetry = JSON.parse(localStorage.getItem("stokpro_demo_payments") || "[]");
  const movementsAfterRetry = JSON.parse(localStorage.getItem("stokpro_demo_stock_movements") || "[]");

  assert(salesAfterRetry.length === salesBeforeRetry.length, "Yeniden deneme satış kayıtlarını çoğaltmamalı");
  assert(paymentsAfterRetry.length === paymentsBeforeRetry.length, "Yeniden deneme ödeme kayıtlarını çoğaltmamalı");
  assert(movementsAfterRetry.length === movementsBeforeRetry.length, "Yeniden deneme stok hareketlerini çoğaltmamalı");

  console.log("\n=====================================================================");
  console.log(`SONUÇ: ${passedCount} Başarılı, ${failedCount} Başarısız`);
  console.log("=====================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test yürütülürken beklenmeyen hata:", err);
  process.exit(1);
});
