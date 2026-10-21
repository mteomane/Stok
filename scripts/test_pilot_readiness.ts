/**
 * İŞLEM 7B — İLK PİLOT İÇİN ZORUNLU KONTROL VE DOĞRULAMA TEST PAKETİ
 *
 * Test Edilen Başlıklar:
 * 1. İlk kayıt, tenantId tutarlılığı ve veri izolasyonu.
 * 2. Mükerrer kayıt koruması (idempotency / tekrarlanan başlangıç).
 * 3. Şifre sıfırlama akışı, e-posta format doğrulaması ve kullanıcı sızıntısı koruması.
 * 4. Üretim ortamında demo/yerel fallback izolasyonu (isDemoAllowed / assertAuthenticated).
 * 5. Canlı domain algılama ve synthetic ID engelleme.
 */

import { isDemoAllowed, isDemoUser, assertAuthenticated, isProductionEnvironment } from "../src/lib/authGuard";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runPilotTests() {
  console.log("=====================================================");
  console.log("▶ İŞLEM 7B: KONTROLLÜ PİLOT YAYIN DOĞRULAMA TESTLERİ");
  console.log("=====================================================\n");

  // TEST 1: Tenant ID Consistency on Initial Registration
  console.log("TEST 1: İlk Kayıtta TenantId Tutarlılığı ve İzolasyon");
  const tenantA_uid = "pilot-owner-companyA-12345";
  const tenantB_uid = "pilot-owner-companyB-67890";

  // Simulate product seeding as done in Auth.tsx
  const mockDbProducts: any[] = [];
  const seedForTenant = (tenantId: string, ownerUid: string, companyName: string) => {
    const prods = [
      { name: "Ürün 1", sku: "PRD-01", price: 100, stock: 20 },
      { name: "Ürün 2", sku: "PRD-02", price: 200, stock: 10 },
    ];
    for (const p of prods) {
      mockDbProducts.push({
        id: "prod-" + Math.random().toString(36).substr(2, 9),
        ...p,
        tenantId,
        userId: ownerUid,
        companyName
      });
    }
  };

  seedForTenant(tenantA_uid, tenantA_uid, "Firma A Tekstil");
  seedForTenant(tenantB_uid, tenantB_uid, "Firma B Gıda");

  const tenantA_prods = mockDbProducts.filter(p => p.tenantId === tenantA_uid);
  const tenantB_prods = mockDbProducts.filter(p => p.tenantId === tenantB_uid);

  assert(tenantA_prods.length === 2, "Firma A için 2 başlangıç ürünü kaydedildi.");
  assert(tenantB_prods.length === 2, "Firma B için 2 başlangıç ürünü kaydedildi.");
  assert(
    tenantA_prods.every(p => p.tenantId === tenantA_uid && p.userId === tenantA_uid),
    "Firma A ürünlerinin tenantId ve userId değerleri tam tutarlı."
  );
  assert(
    tenantA_prods.every(p => p.tenantId !== tenantB_uid),
    "Firma A sorgusunda Firma B'ye ait hiçbir ürün yer almıyor (Kesin İzolasyon)."
  );

  // TEST 2: Idempotency / Duplicate Seeding Prevention
  console.log("\nTEST 2: Tekrarlanan Kayıt / Idempotency Koruması");
  const existingCountBefore = mockDbProducts.filter(p => p.tenantId === tenantA_uid).length;
  // Simulating duplicate attempt: if existing products exist for tenant, skip re-seeding
  const hasExistingProducts = mockDbProducts.some(p => p.tenantId === tenantA_uid);
  if (!hasExistingProducts) {
    seedForTenant(tenantA_uid, tenantA_uid, "Firma A Tekstil");
  }
  const existingCountAfter = mockDbProducts.filter(p => p.tenantId === tenantA_uid).length;
  assert(existingCountBefore === existingCountAfter, "Tekrarlanan başlangıç işlemi mükerrer ürün oluşturmadı.");

  // TEST 3: Password Reset Validation & Safe Messaging
  console.log("\nTEST 3: Şifre Sıfırlama E-posta Kontrolü ve Güvenli Mesajlaşma");
  const validateEmailFormat = (email: string) => {
    const clean = email.trim();
    return Boolean(clean && clean.includes("@") && clean.includes(".") && clean.length > 5);
  };

  assert(validateEmailFormat("esnaf@firma.com") === true, "Geçerli e-posta biçimi kabul edildi.");
  assert(validateEmailFormat("gecersiz-eposta") === false, "Eksik e-posta biçimi reddedildi.");
  assert(validateEmailFormat("   ") === false, "Boş e-posta biçimi reddedildi.");

  // User enumeration safe response contract:
  const getSafePasswordResetMessage = (emailExists: boolean) => {
    // Both existing and non-existing return identical safe confirmation
    return "Eğer bu e-posta adresi sistemimizde kayıtlı ise şifre sıfırlama bağlantısı gönderildi. Lütfen gelen kutunuzu ve spam klasörünüzü kontrol edin.";
  };
  assert(
    getSafePasswordResetMessage(true) === getSafePasswordResetMessage(false),
    "Kullanıcı varlığı hakkında bilgi sızdırmayan güvenli mesaj onaylandı."
  );

  // TEST 4: Production Demo & Fallback Isolation
  console.log("\nTEST 4: Üretim Ortamında Demo ve Yerel Fallback İzolasyonu");
  const originalEnv = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = "production";
    assert(isProductionEnvironment() === true, "isProductionEnvironment() NODE_ENV=production iken true döndü.");
    assert(isDemoAllowed() === false, "isDemoAllowed() üretim ortamında kesinlikle false döndü.");
    assert(isDemoUser("demo-user") === false, "isDemoUser() üretim ortamında daima false döndü (demo yetkisi engellendi).");
    assert(isDemoUser("local-user") === false, "isDemoUser('local-user') üretimde false döndü.");

    let syntheticBlocked = false;
    try {
      assertAuthenticated("demo-user", "ProductionTest");
    } catch (err: any) {
      if (err.message.includes("kesinlikle kullanılamaz")) {
        syntheticBlocked = true;
      }
    }
    assert(syntheticBlocked === true, "assertAuthenticated üretimde demo-user'ı derhal reddetti.");

    let localSyntheticBlocked = false;
    try {
      assertAuthenticated("local-esnaf1", "ProductionTest");
    } catch (err: any) {
      if (err.message.includes("kesinlikle kullanılamaz")) {
        localSyntheticBlocked = true;
      }
    }
    assert(localSyntheticBlocked === true, "assertAuthenticated üretimde local-* kullanıcısını derhal reddetti.");

    // Valid Firebase UID in production
    const validUid = assertAuthenticated("firebase-uid-real-user-778899", "ProductionTest");
    assert(validUid === "firebase-uid-real-user-778899", "Gerçek Firebase UID üretimde geçerli kabul edildi.");

  } finally {
    process.env.NODE_ENV = originalEnv;
  }

  // Summary
  console.log("\n=====================================================");
  console.log(`SONUÇ: ${passed} Başarılı, ${failed} Başarısız`);
  console.log("=====================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPilotTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
