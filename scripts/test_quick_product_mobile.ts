/**
 * İŞLEM 6A - HIZLI ÜRÜN EKLEME VE MOBİL KULLANIM DOĞRULAMA TEST PAKETİ
 *
 * Test Edilen Senaryolar:
 * 1. EAN-13 Kontrol Basamağı Doğrulaması (Mathematical Modulo-10 Checksum) & Global vs Dahili Barkod Ayrımı.
 * 2. Kayıtlı geçerli barkodun (Örn: 8690555001120) mevcut ürünü bulması.
 * 3. Bilinmeyen barkodla yeni ürün formu açılması ve barkodun korunması.
 * 4. Barkodsuz ürünün başarıyla oluşturulması (Dahili PRD-XXXXXX SKU ile).
 * 5. GS1 Dahili Mağaza Barkodu (Prefix 200.. ile 299..) üretimi ve doğrulanması.
 * 6. Aynı barkodla mükerrer ürün oluşmasının engellenmesi veya açık çakışma uyarısı verilmesi.
 * 7. Kayıtlı ürünün stok miktarının artırılması ve stock_movements denetim kaydının yazılması.
 * 8. Yetkisiz kullanıcının stok değiştirememesi (Auth / tenant koruması).
 * 9. Firma A'nın Firma B ürünlerine erişememesi (Tenant izolasyonu).
 * 10. Mobil kullanım: Adet, paket, koli, kg, litre, metre birim desteği ve hızlı mobil giriş.
 */

import { BarcodeConflictResult, ReplenishStockParams } from "../src/lib/repositories/interfaces";
import { Product } from "../src/types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedCount++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    failedCount++;
  }
}

/**
 * Validates official GS1 EAN-13 Modulo-10 checksum algorithm
 */
function validateEan13Checksum(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(barcode[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const expectedCheckDigit = (10 - (sum % 10)) % 10;
  return parseInt(barcode[12], 10) === expectedCheckDigit;
}

/**
 * Calculates correct EAN-13 check digit for 12 digits
 */
function calculateEan13CheckDigit(first12Digits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(first12Digits[i], 10);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10;
}

// In-Memory Domain Product Repository simulating FirebaseProductRepository logic for testing
class MockDomainProductRepository {
  private products: Map<string, Product & { tenantId: string }> = new Map();
  public stockMovements: any[] = [];

  async create(uid: string, data: Partial<Product> & { name: string; price: number }, tenantId: string): Promise<Product> {
    if (!uid) throw new Error("Kimlik doğrulaması zorunludur.");

    // Conflict check if barcode provided
    if (data.barcode && data.barcode.trim()) {
      const cleanBarcode = data.barcode.trim();
      for (const p of this.products.values()) {
        if (p.tenantId === tenantId && p.isActive !== false && p.barcode && p.barcode.trim() === cleanBarcode) {
          throw new Error(`Barkod Çakışması: '${cleanBarcode}' barkodu '${p.name}' adlı üründe zaten kayıtlı.`);
        }
      }
    }

    const id = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const sku = data.sku && data.sku.trim() ? data.sku.trim() : `PRD-${Date.now().toString().slice(-6)}`;
    const newProduct: Product & { tenantId: string } = {
      id,
      name: data.name,
      price: data.price,
      costPrice: data.costPrice,
      stock: data.stock !== undefined ? data.stock : 0,
      minStock: data.minStock !== undefined ? data.minStock : 5,
      category: data.category || "Genel",
      unit: data.unit || "Adet",
      barcode: data.barcode,
      sku,
      tenantId,
      isActive: data.isActive !== false
    };

    this.products.set(id, newProduct);
    return newProduct;
  }

  async getByBarcode(barcode: string, tenantId: string): Promise<Product | null> {
    if (!barcode || !barcode.trim()) return null;
    const clean = barcode.trim().toLowerCase();

    for (const p of this.products.values()) {
      if (p.tenantId === tenantId && p.isActive !== false) {
        if (
          (p.barcode && p.barcode.trim().toLowerCase() === clean) ||
          (p.sku && p.sku.trim().toLowerCase() === clean) ||
          p.id.toLowerCase() === clean
        ) {
          return p;
        }
      }
    }
    return null;
  }

  async checkBarcodeConflict(barcode: string, tenantId: string, excludeProductId?: string): Promise<BarcodeConflictResult> {
    if (!barcode || !barcode.trim()) {
      return { hasConflict: false };
    }
    const clean = barcode.trim().toLowerCase();

    for (const p of this.products.values()) {
      if (p.tenantId === tenantId && p.isActive !== false && p.id !== excludeProductId) {
        if (p.barcode && p.barcode.trim().toLowerCase() === clean) {
          return { hasConflict: true, conflictingProduct: p };
        }
      }
    }
    return { hasConflict: false };
  }

  async replenishStock(productId: string, params: ReplenishStockParams, uid: string, tenantId: string): Promise<Product> {
    if (!uid) throw new Error("Yetkilendirme Hatası: Oturum açılmamış.");
    if (params.quantityToAdd <= 0) throw new Error("Geçersiz Miktar: Eklenecek stok pozitif olmalıdır.");

    const product = this.products.get(productId);
    if (!product || product.tenantId !== tenantId) {
      throw new Error("Ürün Bulunamadı: Belirtilen ürün mevcut değil veya bu firmaya ait değil.");
    }

    const previousStock = product.stock;
    const newStock = previousStock + params.quantityToAdd;
    product.stock = newStock;
    if (params.costPrice !== undefined) {
      product.costPrice = params.costPrice;
    }

    this.stockMovements.push({
      id: `sm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      productId,
      tenantId,
      userId: uid,
      type: "in",
      quantity: params.quantityToAdd,
      previousStock,
      newStock,
      note: params.note || "Hızlı Stok Takviyesi",
      createdAt: new Date().toISOString()
    });

    return product;
  }

  getAllByTenant(tenantId: string): Product[] {
    return Array.from(this.products.values()).filter(p => p.tenantId === tenantId);
  }
}

async function runQuickProductMobileTests() {
  console.log("=====================================================================");
  console.log("İŞLEM 6A — BARKOD DOĞRULUĞU, HIZLI ÜRÜN VE MOBİL KULLANIM TESTLERİ");
  console.log("=====================================================================");

  const repo = new MockDomainProductRepository();
  const tenantA = "firma_esnaf_a";
  const tenantB = "firma_market_b";
  const userA = "esnaf_user_a";
  const userUnauthorized = "";

  // 1. EAN-13 Kontrol Basamağı Doğrulaması (Modulo-10)
  console.log("\nSENARYO 1: EAN-13 Kontrol Basamağı Doğrulaması (GS1 Modulo-10)");
  const validTestBarcode = "8690555001120"; // Check digit is 0: (28 + 42 = 70 => (10 - 0)%10 = 0)
  const invalidTestBarcode = "8690555001122"; // 13th digit is 2 instead of 0

  assert(validateEan13Checksum(validTestBarcode) === true, "'8690555001120' test barkodu geçerli EAN-13 kontrol basamağına (0) sahip olmalı");
  assert(validateEan13Checksum(invalidTestBarcode) === false, "Eski hatalı '8690555001122' örneği matematiksel olarak geçersiz kabul edilmeli");

  const computedCheckDigit = calculateEan13CheckDigit("869055500112");
  assert(computedCheckDigit === 0, "'869055500112' gövdesinin beklenen EAN-13 kontrol basamağı tam 0 olmalı");

  // 2. Kayıtlı geçerli barkodun mevcut ürünü bulması
  console.log("\nSENARYO 2: Kayıtlı barkodun (Test Paketli İçecek EAN-13) mevcut ürünü bulması");
  const packagedProduct = await repo.create(userA, {
    name: "Örnek Soğuk İçecek 330ml Kutu",
    barcode: validTestBarcode,
    sku: "PRD-DRK-330",
    price: 30,
    costPrice: 20,
    stock: 24,
    minStock: 6,
    category: "İçecek",
    unit: "Adet"
  }, tenantA);

  const foundProduct = await repo.getByBarcode(validTestBarcode, tenantA);
  assert(foundProduct !== null, "Kayıtlı geçerli EAN-13 barkod (8690555001120) ile ürün bulunmalı");
  assert(foundProduct?.id === packagedProduct.id, "Bulunan ürün doğru ID'ye sahip olmalı");
  assert(foundProduct?.name === "Örnek Soğuk İçecek 330ml Kutu", "Bulunan ürünün adı doğru olmalı");

  // 3. Bilinmeyen barkodla arama ve barkodun yeni ürün formuna aktarılması
  console.log("\nSENARYO 3: Bilinmeyen barkodun taranması ve yeni ürün formuna aktarımı");
  const unknownBarcode = "8690123999996"; // Valid EAN-13 test barcode: (39 + 105 = 144 => check digit 6)
  assert(validateEan13Checksum(unknownBarcode) === true, "Bilinmeyen test barkodu (8690123999996) geçerli EAN-13 yapısında olmalı");

  const notFound = await repo.getByBarcode(unknownBarcode, tenantA);
  assert(notFound === null, "Sistemde olmayan barkod için sonuç null dönmeli (Hata fırlatılmamalı)");
  
  // Okutulan barkodu koruyarak yeni ürün oluşturulması
  const newScannedProduct = await repo.create(userA, {
    name: "Yeni Bisküvi Paketi",
    barcode: unknownBarcode, // Barkod korundu
    price: 15,
    stock: 50,
    minStock: 10,
    category: "Gıda",
    unit: "Paket"
  }, tenantA);
  assert(newScannedProduct.barcode === unknownBarcode, "Okutulan barkod yeni üründe aynen korunmalı");
  assert(newScannedProduct.unit === "Paket", "Sektörel birim 'Paket' olarak kaydedilmeli");

  // 4. GS1 Dahili Mağaza Barkodu (Prefix 200..) & Dahili SKU Ayrımı
  console.log("\nSENARYO 4: Dahili GS1 Mağaza Barkodu (Prefix 200..) ve Dahili SKU Ayrımı");
  const internalGs1Barcode = "2001234567893"; // Valid internal EAN-13 starting with 200..
  assert(validateEan13Checksum(internalGs1Barcode) === true, "Dahili mağaza barkodu (2001234567893) geçerli EAN-13 Modulo-10 olmalı");
  assert(internalGs1Barcode.startsWith("200"), "Dahili mağaza barkodu GS1 kısıtlı dağıtım prefix'i (200..) ile başlamalı");

  const internalGs1Product = await repo.create(userA, {
    name: "Dahili Etiketli Çilek Reçeli 500g",
    barcode: internalGs1Barcode,
    price: 85,
    stock: 20,
    category: "Gıda",
    unit: "Adet"
  }, tenantA);
  assert(internalGs1Product.barcode === internalGs1Barcode, "Dahili barkod ürüne atanabilmeli");

  // 5. Barkodsuz yerel ürünün kaydedilmesi ve dahili SKU (PRD-XXXXXX) üretimi
  console.log("\nSENARYO 5: Barkodsuz yerel ürünün kaydedilmesi ve dahili SKU üretimi");
  const unbarcodedProduct = await repo.create(userA, {
    name: "Köy Yumurtası (30'lu Koli)",
    price: 140,
    stock: 15,
    minStock: 3,
    category: "Şarküteri",
    unit: "Koli"
  }, tenantA);
  assert(Boolean(unbarcodedProduct.sku && unbarcodedProduct.sku.startsWith("PRD-")), "Barkodsuz ürüne otomatik dahili SKU (PRD-...) üretilmeli");
  assert(unbarcodedProduct.barcode === undefined, "Barkod alanı zorunlu olmamalı");
  assert(unbarcodedProduct.stock === 15, "Başlangıç stok miktarı doğru atanmalı");

  // 6. Aynı barkodla mükerrer ürün oluşmasının engellenmesi (Duplicate Barcode Guard)
  console.log("\nSENARYO 6: Mükerrer barkod çakışma kontrolü (Duplicate Barcode Guard)");
  const conflictCheck = await repo.checkBarcodeConflict(validTestBarcode, tenantA);
  assert(conflictCheck.hasConflict === true, "Mevcut barkod için hasConflict=true dönmeli");
  assert(conflictCheck.conflictingProduct?.id === packagedProduct.id, "Çakışan mevcut ürün bilgisi döndürülmeli");

  let duplicateBlocked = false;
  try {
    await repo.create(userA, {
      name: "Mükerrer Ürün Denemesi",
      barcode: validTestBarcode,
      price: 32,
      stock: 10,
      minStock: 2,
      category: "İçecek"
    }, tenantA);
  } catch (err: any) {
    if (err.message.includes("Barkod Çakışması")) {
      duplicateBlocked = true;
    }
  }
  assert(duplicateBlocked, "Aynı barkodla ikinci kez ürün kaydı veritabanı seviyesinde engellenmeli");

  // 7. Kayıtlı ürünün stok miktarının artırılması (Hızlı Stok Girişi & Audit Trail)
  console.log("\nSENARYO 7: Kayıtlı ürünün stok miktarının artırılması ve hareket kaydı");
  const initialStock = packagedProduct.stock;
  const replenished = await repo.replenishStock(packagedProduct.id, {
    quantityToAdd: 12,
    costPrice: 21,
    note: "Kamera Hızlı Stok Girişi (1 Koli)"
  }, userA, tenantA);

  assert(replenished.stock === initialStock + 12, "Stok miktarı tam olarak 12 artırılmalı");
  assert(replenished.costPrice === 21, "Güncel alış fiyatı güncellenmeli");
  assert(repo.stockMovements.length === 1, "stock_movements koleksiyonuna tam 1 denetim kaydı eklenmeli");
  assert(repo.stockMovements[0].type === "in", "Hareket türü 'in' (giriş) olmalı");
  assert(repo.stockMovements[0].previousStock === initialStock, "Önceki stok denetim izinde doğru mühürlenmeli");
  assert(repo.stockMovements[0].newStock === initialStock + 12, "Yeni stok denetim izinde doğru mühürlenmeli");

  // 8. Yetkisiz kullanıcının stok değiştirememesi
  console.log("\nSENARYO 8: Yetkisiz kullanıcının stok değiştirememesi");
  let unauthorizedBlocked = false;
  try {
    await repo.replenishStock(packagedProduct.id, { quantityToAdd: 5 }, userUnauthorized, tenantA);
  } catch (err: any) {
    if (err.message.includes("Yetkilendirme Hatası")) {
      unauthorizedBlocked = true;
    }
  }
  assert(unauthorizedBlocked, "Kimliği doğrulanmamış kullanıcı stok ekleyememeli");

  let negativeBlocked = false;
  try {
    await repo.replenishStock(packagedProduct.id, { quantityToAdd: -5 }, userA, tenantA);
  } catch (err: any) {
    if (err.message.includes("Geçersiz Miktar")) {
      negativeBlocked = true;
    }
  }
  assert(negativeBlocked, "Negatif veya sıfır miktar stok artışında engellenmeli");

  // 9. Firma A'nın Firma B ürünlerine erişememesi (Tenant İzolasyonu)
  console.log("\nSENARYO 9: Çoklu Firma (Tenant) İzolasyonu");
  const tenantBProduct = await repo.create("user_b", {
    name: "Market B Özel Ürün",
    barcode: "8690999887766",
    price: 50,
    stock: 100,
    minStock: 20,
    category: "Genel"
  }, tenantB);

  const crossBarcodeSearch = await repo.getByBarcode("8690999887766", tenantA);
  assert(crossBarcodeSearch === null, "Firma A, Firma B'ye ait barkodu aradığında ürünü görmemeli");

  let crossReplenishBlocked = false;
  try {
    await repo.replenishStock(tenantBProduct.id, { quantityToAdd: 10 }, userA, tenantA);
  } catch (err: any) {
    if (err.message.includes("bu firmaya ait değil") || err.message.includes("Ürün Bulunamadı")) {
      crossReplenishBlocked = true;
    }
  }
  assert(crossReplenishBlocked, "Firma A, Firma B'ye ait bir ürünün stoğunu artıramamalı");

  // 10. Mobil kullanım: Farklı birimler ve esnaf dostu mobil alanlar
  console.log("\nSENARYO 10: Mobil kullanım ve sektörel birim çeşitliliği");
  const units = ["Adet", "Paket", "Koli", "Kilogram", "Litre", "Metre"];
  const createdUnits: string[] = [];

  for (const u of units) {
    const p = await repo.create(userA, {
      name: `Test Ürün ${u}`,
      price: 10,
      stock: 5,
      minStock: 1,
      category: "Test",
      unit: u
    }, tenantA);
    createdUnits.push(p.unit || "");
  }

  assert(
    units.every(u => createdUnits.includes(u)),
    "Tüm esnaf birimleri (Adet, Paket, Koli, Kilogram, Litre, Metre) hatasız desteklenmeli"
  );

  console.log("\n=====================================================================");
  console.log(`SONUÇ: ${passedCount} Başarılı, ${failedCount} Başarısız`);
  console.log("=====================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runQuickProductMobileTests().catch(err => {
  console.error("Test yürütülürken hata:", err);
  process.exit(1);
});
