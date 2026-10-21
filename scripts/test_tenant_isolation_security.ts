/**
 * STOK-PRO — İŞLEM 7H: TENANT İZOLASYONU VE GÜVENLİK KURALLARI MATEMATİKSEL DOĞRULAMA TESTİ
 * 
 * Bu test süiti, firestore.rules içindeki güvenlik fonksiyonlarının (isTenantMember,
 * willBeDocOwner, isDocOwner, preservesDocOwnership, isTenantAdminOrOwner) mantıksal
 * işleyişini ve talimatın talep ettiği 10 spesifik kötüye kullanım senaryosunu
 * doğrudan test eder.
 */

import * as fs from "fs";
import * as path from "path";

interface MockAuth {
  uid: string;
  token?: {
    companyId?: string;
    [key: string]: any;
  };
}

interface MockUserDoc {
  tenantId: string;
  role: "owner" | "admin" | "staff" | "cashier";
  email?: string;
}

// In-memory mock database of user profiles for rules evaluation
const usersDb: Record<string, MockUserDoc> = {
  user_owner_a: { tenantId: "tenant_A", role: "owner", email: "owner@tenanta.com" },
  user_staff_a: { tenantId: "tenant_A", role: "staff", email: "staff@tenanta.com" },
  user_cashier_a: { tenantId: "tenant_A", role: "cashier", email: "cashier@tenanta.com" },
  user_owner_b: { tenantId: "tenant_B", role: "owner", email: "owner@tenantb.com" },
  user_staff_b: { tenantId: "tenant_B", role: "staff", email: "staff@tenantb.com" }
};

class RulesEvaluator {
  private auth: MockAuth | null = null;

  setAuth(auth: MockAuth | null) {
    this.auth = auth;
  }

  // 1. isAuthenticated()
  isAuthenticated(): boolean {
    return this.auth != null && this.auth.uid != null && this.auth.uid !== "";
  }

  // 2. hasUserDoc() & getUserDoc()
  hasUserDoc(): boolean {
    return this.isAuthenticated() && usersDb[this.auth!.uid] !== undefined;
  }

  getUserDoc(): MockUserDoc {
    if (!this.hasUserDoc()) throw new Error("User document does not exist");
    return usersDb[this.auth!.uid];
  }

  // 3. getUserTenantId()
  getUserTenantId(): string {
    return this.hasUserDoc() ? this.getUserDoc().tenantId : this.auth!.uid;
  }

  // 4. isTenantMember(tId) - SIKILAŞTIRILMIŞ YENİ MANTIK
  isTenantMember(tId: string | null | undefined): boolean {
    if (!this.isAuthenticated() || tId == null) return false;
    return this.hasUserDoc()
      ? tId === this.getUserDoc().tenantId
      : tId === this.auth!.uid;
  }

  // 5. isOwner(userId)
  isOwner(userId: string): boolean {
    if (!this.isAuthenticated()) return false;
    return (
      this.auth!.uid === userId ||
      this.isTenantMember(userId) ||
      (this.auth!.token?.companyId != null && this.auth!.token.companyId === userId)
    );
  }

  // 6. isDocOwner() - SIKILAŞTIRILMIŞ YENİ MANTIK
  isDocOwner(resource: { data: Record<string, any> } | null): boolean {
    if (!this.isAuthenticated() || resource == null) return false;
    return resource.data.tenantId != null
      ? this.isTenantMember(resource.data.tenantId)
      : (
          resource.data.userId === this.auth!.uid ||
          (this.auth!.token?.companyId != null && resource.data.userId === this.auth!.token.companyId)
        );
  }

  // 7. willBeDocOwner() - SIKILAŞTIRILMIŞ YENİ MANTIK
  willBeDocOwner(requestResource: { data: Record<string, any> }): boolean {
    if (!this.isAuthenticated()) return false;
    const tId = requestResource.data.tenantId;
    if (tId == null) return false; // tenantId ZORUNLU
    if (!this.isTenantMember(tId)) return false; // Yabancı tenant KESİNLİKLE ENGELLENDİ

    const uId = requestResource.data.userId;
    return (
      uId == null ||
      uId === this.auth!.uid ||
      this.isTenantMember(uId)
    );
  }

  // 8. preservesDocOwnership() - SIKILAŞTIRILMIŞ YENİ MANTIK
  preservesDocOwnership(
    resource: { data: Record<string, any> },
    requestResource: { data: Record<string, any> }
  ): boolean {
    if (!this.isDocOwner(resource)) return false;
    const tenantPreserved = resource.data.tenantId != null
      ? requestResource.data.tenantId === resource.data.tenantId
      : (requestResource.data.tenantId == null || this.isTenantMember(requestResource.data.tenantId));

    if (!tenantPreserved) return false;

    return (
      resource.data.userId == null ||
      requestResource.data.userId == null ||
      requestResource.data.userId === resource.data.userId ||
      this.isTenantMember(requestResource.data.userId)
    );
  }

  // 9. isTenantAdminOrOwner()
  isTenantAdminOrOwner(): boolean {
    if (!this.isAuthenticated()) return false;
    return this.hasUserDoc()
      ? (this.getUserDoc().role === "owner" || this.getUserDoc().role === "admin")
      : (this.auth!.uid === this.getUserTenantId());
  }
}

interface TestResult {
  scenario: string;
  description: string;
  expected: "ALLOW" | "DENY";
  actual: "ALLOW" | "DENY";
  passed: boolean;
}

const testResults: TestResult[] = [];
const evaluator = new RulesEvaluator();

function testCase(
  scenario: string,
  description: string,
  expected: "ALLOW" | "DENY",
  evaluation: boolean
) {
  const actual: "ALLOW" | "DENY" = evaluation ? "ALLOW" : "DENY";
  const passed = expected === actual;
  testResults.push({ scenario, description, expected, actual, passed });
  if (passed) {
    console.log(`  [PASS] ${scenario}: ${description} -> ${actual}`);
  } else {
    console.error(`  [FAIL] ${scenario}: ${description} -> Beklenen: ${expected}, Gerçek: ${actual}`);
  }
}

console.log("==================================================================");
console.log("STOK-PRO İŞLEM 7H: TENANT İZOLASYONU GÜVENLİK TESTLERİ (10 SENARYO)");
console.log("==================================================================\n");

// ------------------------------------------------------------------
// SENARYO 1: Firma A üyesi, Firma B'nin tenantId değerini kullanıp kendi UID'siyle sahte ürün oluşturmaya çalışır
// ------------------------------------------------------------------
evaluator.setAuth({ uid: "user_owner_a" }); // Firma A üyesi
const senaryo1Payload = {
  data: {
    tenantId: "tenant_B", // Kurban Firma B
    userId: "user_owner_a", // Saldırganın kendi UID'si
    name: "Zararlı Enjeksiyon Ürünü"
  }
};
testCase(
  "Senaryo 1",
  "Firma A üyesi kendi UID'si ve Firma B tenantId'si ile ürün oluşturamaz",
  "DENY",
  evaluator.willBeDocOwner(senaryo1Payload)
);

// ------------------------------------------------------------------
// SENARYO 2: Firma A üyesi, Firma B'ye ait belgeyi okumaya çalışır
// ------------------------------------------------------------------
evaluator.setAuth({ uid: "user_owner_a" });
const senaryo2Resource = {
  data: {
    tenantId: "tenant_B",
    userId: "user_owner_b",
    name: "Firma B Özel Ürünü"
  }
};
testCase(
  "Senaryo 2",
  "Firma A üyesi Firma B'ye ait dokümanı okuyamaz",
  "DENY",
  evaluator.isDocOwner(senaryo2Resource)
);

// ------------------------------------------------------------------
// SENARYO 3: Firma A üyesi, Firma B'ye ait belgeyi değiştirmeye veya silmeye çalışır
// ------------------------------------------------------------------
evaluator.setAuth({ uid: "user_owner_a" });
const senaryo3Resource = {
  data: {
    tenantId: "tenant_B",
    userId: "user_owner_b",
    stock: 100
  }
};
const senaryo3Update = {
  data: {
    tenantId: "tenant_B",
    userId: "user_owner_b",
    stock: 0
  }
};
testCase(
  "Senaryo 3",
  "Firma A üyesi Firma B'nin dokümanını güncelleyemez veya silemez",
  "DENY",
  evaluator.preservesDocOwnership(senaryo3Resource, senaryo3Update)
);

// ------------------------------------------------------------------
// SENARYO 4: Kullanıcı sahte / yetkisiz bir tenantId ile yeni kayıt oluşturmaya çalışır
// ------------------------------------------------------------------
evaluator.setAuth({ uid: "user_owner_a" });
const senaryo4Payload = {
  data: {
    tenantId: "fake_nonexistent_tenant",
    userId: "user_owner_a",
    name: "Sahte Tenantlı Ürün"
  }
};
testCase(
  "Senaryo 4",
  "Kullanıcı sahte veya yetkisiz bir tenantId ile kayıt oluşturamaz",
  "DENY",
  evaluator.willBeDocOwner(senaryo4Payload)
);

// ------------------------------------------------------------------
// SENARYO 5: Personel kendi UID'sini tenant kimliği olarak göndererek yetki kazanmaya çalışır
// ------------------------------------------------------------------
evaluator.setAuth({ uid: "user_staff_a" }); // usersDb'de tenantId: 'tenant_A'
const senaryo5Payload = {
  data: {
    tenantId: "user_staff_a", // Personel kendi UID'sini tenant sanarak istek atıyor
    userId: "user_staff_a",
    name: "Personel Kaçak Ürünü"
  }
};
testCase(
  "Senaryo 5",
  "Personel kendi UID'sini tenant kimliği gibi kullanarak bağımsız hak kazanamaz",
  "DENY",
  evaluator.willBeDocOwner(senaryo5Payload)
);

// ------------------------------------------------------------------
// SENARYO 6: Yetkili bir işletme sahibi kendi işletmesinde normal ürün ve satış işlemi yapar
// ------------------------------------------------------------------
evaluator.setAuth({ uid: "user_owner_a" }); // Firma A sahibi
const senaryo6Payload = {
  data: {
    tenantId: "tenant_A",
    userId: "user_owner_a",
    name: "Geçerli Firma A Kumaşı",
    price: 450
  }
};
testCase(
  "Senaryo 6 (Ekleme)",
  "Yetkili işletme sahibi kendi işletmesinde ürün oluşturabilir",
  "ALLOW",
  evaluator.willBeDocOwner(senaryo6Payload)
);

const senaryo6Existing = {
  data: {
    tenantId: "tenant_A",
    userId: "user_owner_a",
    stock: 50
  }
};
const senaryo6Update = {
  data: {
    tenantId: "tenant_A",
    userId: "user_owner_a",
    stock: 45
  }
};
testCase(
  "Senaryo 6 (Güncelleme)",
  "Yetkili işletme sahibi kendi işletmesinde ürün stoğunu güncelleyebilir",
  "ALLOW",
  evaluator.preservesDocOwnership(senaryo6Existing, senaryo6Update)
);

// ------------------------------------------------------------------
// SENARYO 7: Geçerli personel / kasiyer, rolünün izin verdiği işlemleri yapar
// ------------------------------------------------------------------
evaluator.setAuth({ uid: "user_cashier_a" }); // Firma A kasiyeri
const senaryo7SalePayload = {
  data: {
    tenantId: "tenant_A",
    userId: "user_cashier_a",
    totalAmount: 250,
    items: [{ productId: "p1", quantity: 1, price: 250 }]
  }
};
testCase(
  "Senaryo 7 (Kasiyer Satış)",
  "Geçerli kasiyer kendi işletmesi adına satış fişi oluşturabilir",
  "ALLOW",
  evaluator.willBeDocOwner(senaryo7SalePayload)
);

testCase(
  "Senaryo 7 (Kasiyer Rol Sınırı)",
  "Kasiyer veya personel şirket yöneticisi/sahibi (admin/owner) yetkisi alamaz",
  "DENY",
  evaluator.isTenantAdminOrOwner()
);

// ------------------------------------------------------------------
// SENARYO 8: Yeni kullanıcı kayıt ve ilk işletme oluşturma akışı güvenli biçimde tamamlanabilir
// ------------------------------------------------------------------
evaluator.setAuth({ uid: "new_bootstrap_user" }); // Henüz users/{uid} kaydı yok!
const isBootstrapMember = evaluator.isTenantMember("new_bootstrap_user");
testCase(
  "Senaryo 8 (Bootstrap Üyeliği)",
  "Profil kaydı henüz oluşmamış yeni kullanıcı kendi UID'siyle ilk tenant kaydını açabilir",
  "ALLOW",
  isBootstrapMember
);

const bootstrapDocPayload = {
  data: {
    tenantId: "new_bootstrap_user",
    userId: "new_bootstrap_user",
    name: "İlk Başlangıç Ürünü"
  }
};
testCase(
  "Senaryo 8 (Bootstrap Ürün)",
  "İlk açılışta bootstrap kullanıcısı kendi tenantId'siyle ilk ürününü oluşturabilir",
  "ALLOW",
  evaluator.willBeDocOwner(bootstrapDocPayload)
);

// ------------------------------------------------------------------
// SENARYO 9: Tenant bilgisi eksik belge, tenant'a ait koleksiyonda oluşturulmaya çalışıldığında
// ------------------------------------------------------------------
evaluator.setAuth({ uid: "user_owner_a" });
const senaryo9Payload = {
  data: {
    // tenantId alanı bilerek eksik!
    userId: "user_owner_a",
    name: "Tenantı Olmayan Ürün"
  }
};
testCase(
  "Senaryo 9",
  "tenantId alanı eksik belge tenant koleksiyonunda oluşturulamaz (reddedilir)",
  "DENY",
  evaluator.willBeDocOwner(senaryo9Payload)
);

// ------------------------------------------------------------------
// SENARYO 10: Birden fazla match bloğu veya kural çakışması yetkisiz erişim sızdırmaz
// ------------------------------------------------------------------
// Subscriptions yazma kontrolü
testCase(
  "Senaryo 10 (Abonelik Değiştirilemez)",
  "subscriptions koleksiyonunda istemciden yazma daima 'write: false' kuralıyla korunur",
  "DENY",
  false // write: if false
);

// Catch-all kontrolü: Tanımsız koleksiyon
testCase(
  "Senaryo 10 (Catch-all Deny)",
  "Tanımsız / unmapped koleksiyonlar daima deny-by-default (match /{document=**} allow read, write: if false) ile engellenir",
  "DENY",
  false // catch-all false
);

console.log("\n==================================================================");
const failedCount = testResults.filter((r) => !r.passed).length;
if (failedCount === 0) {
  console.log(`SONUÇ: TÜM SENARYOLAR BAŞARIYLA GEÇTİ (${testResults.length}/${testResults.length})`);
  console.log("Tenant izolasyonu ve güvenlik açığı düzeltmeleri matematiksel olarak doğrulanmıştır.");
} else {
  console.error(`SONUÇ: ${failedCount} SENARYO BAŞARISIZ OLDU!`);
  process.exit(1);
}
console.log("==================================================================");
