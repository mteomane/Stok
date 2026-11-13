import type { Product } from "../src/types";
import { getAvailableBoxQuantity, getAvailableRollLength, getAvailableStock, getRollStockBalance, shouldShowRolls } from "../src/lib/sectorConfig";
import { groupFabricProducts, groupProducts, getGroupedAvailableStock } from "../src/lib/productGrouping";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "test-product",
    name: "Test Ürün",
    sku: "TEST-001",
    category: "Genel",
    unit: "Adet",
    price: 10,
    stock: 10,
    minStock: 0,
    ...overrides
  };
}

function assertEqual(actual: boolean, expected: boolean, label: string): void {
  if (actual !== expected) {
    throw new Error(`[FAIL] ${label}: expected ${expected}, received ${actual}`);
  }
  console.log(`[PASS] ${label}`);
}

const reservedFabric = makeProduct({ stock: 61, reservedStock: 10, rolls: [{ id: "r1", rollNumber: "Top 1", length: 31, initialLength: 31, reservedLength: 10, status: "available" }] });
assertEqual(getAvailableStock(reservedFabric) === 51, true, "Sepette rezerve edilen 10 metre diğer satıcılar için kullanılabilir stoktan düşer");
assertEqual(getAvailableRollLength(reservedFabric.rolls![0]) === 21, true, "Bir topun rezerve edilen metrajı başka bir satışa sunulmaz");
const reservedBox = { id: "b1", boxNumber: "Koli 1", quantity: 24, initialQuantity: 24, reservedQuantity: 4, status: "available" as const };
assertEqual(getAvailableBoxQuantity(reservedBox) === 20, true, "Koli içindeki rezerve adetler başka satıcıların stokundan düşer");
// A textile company may sell both fabric by the meter and ordinary accessories.
// The company-wide sector must not turn every product into a roll.
assertEqual(
  shouldShowRolls(makeProduct({ category: "Aksesuar", unit: "Adet" }), "tekstil"),
  false,
  "Tekstil firmasında adetle satılan aksesuar ürünü rulo ekranı göstermez"
);
assertEqual(
  shouldShowRolls(makeProduct({ category: "Kumaş", unit: "Metre" }), "tekstil"),
  true,
  "Kumaş kategorisindeki ürün rulo takibini gösterir"
);
assertEqual(
  shouldShowRolls(makeProduct({ category: "Genel", unit: "Metre" }), "genel"),
  true,
  "Genel kategoride metre birimli ürün rulo takibini gösterebilir"
);
assertEqual(
  shouldShowRolls(makeProduct({
    category: "Dokuma",
    unit: "Adet",
    metadata: { fabricType: "Pamuk" }
  }), "genel"),
  true,
  "Kumaş metadata bilgisi olan ürün rulo takibini korur"
);
assertEqual(
  shouldShowRolls(makeProduct({
    category: "Aksesuar",
    unit: "Adet",
    rolls: [{
      id: "roll-1",
      rollNumber: "Top #1",
      length: 12,
      initialLength: 12,
      status: "available"
    }]
  }), "genel"),
  true,
  "Mevcut rulo kayıtları sektör değişse de görünür kalır"
);
assertEqual(
  shouldShowRolls(null, "tekstil"),
  true,
  "Ürün seçilmemiş yeni kayıt akışında tekstil sektörünün rulo varsayılanı korunur"
);
assertEqual(
  shouldShowRolls(null, "genel"),
  false,
  "Ürün seçilmemiş yeni kayıt akışında genel sektör rulo varsayılanı göstermez"
);


const balancedRolls = makeProduct({
  stock: 43,
  rolls: [
    { id: "r1", rollNumber: "Top 1", length: 23, initialLength: 30, status: "available" },
    { id: "r2", rollNumber: "Top 2", length: 20, initialLength: 20, status: "available" }
  ]
});
const balancedResult = getRollStockBalance(balancedRolls);
assertEqual(balancedResult.isBalanced, true, "Ürün stoğu ve top kayıtları toplamı eşitse satış dengesi onaylanır");
assertEqual(balancedResult.trackedRollLength === 43, true, "Top kayıtları toplam metreyi doğru hesaplar");

const mismatchedRolls = makeProduct({
  stock: 44,
  rolls: [
    { id: "r1", rollNumber: "Top 1", length: 23, initialLength: 30, status: "available" },
    { id: "r2", rollNumber: "Top 2", length: 20, initialLength: 20, status: "available" }
  ]
});
const mismatchResult = getRollStockBalance(mismatchedRolls);
assertEqual(mismatchResult.isBalanced, false, "Ürün stoğu ve top kayıtları arasında fark varsa satış engellenir");
assertEqual(mismatchResult.difference === -1, true, "Bir metrelik top/ürün stoğu farkı doğru tespit edilir");


const separateTopProducts: Product[] = [
  makeProduct({
    id: "fabric-top-1",
    name: "Premium Pamuk Kumaş - Top #1",
    sku: "FAB-001",
    category: "Kumaş",
    unit: "Metre",
    price: 250,
    stock: 20,
    reservedStock: 0,
    metadata: { fabricType: "Pamuk", color: "Mavi", width: "150cm" }
  }),
  makeProduct({
    id: "fabric-top-2",
    name: "Premium Pamuk Kumaş - Top #2",
    sku: "FAB-002",
    category: "Kumaş",
    unit: "Metre",
    price: 250,
    stock: 18,
    reservedStock: 10,
    metadata: { fabricType: "Pamuk", color: "Mavi", width: "150cm" }
  }),
  makeProduct({
    id: "fabric-top-3",
    name: "Premium Pamuk Kumaş - Top #3",
    sku: "FAB-003",
    category: "Kumaş",
    unit: "Metre",
    price: 250,
    stock: 23,
    reservedStock: 0,
    metadata: { fabricType: "Pamuk", color: "Mavi", width: "150cm" }
  })
];
const groupedFabric = groupFabricProducts(separateTopProducts);
assertEqual(groupedFabric.length === 1, true, "Üç ayrı kumaş top kaydı tek kumaş çeşidi olarak listelenir");
assertEqual(groupedFabric[0].name === "Premium Pamuk Kumaş", true, "Top numarası ürün adı satırından gizlenir");
assertEqual(groupedFabric[0].stock === 61, true, "20 + 18 + 23 metre toplamı 61 metre gösterilir");
assertEqual(groupedFabric[0].groupProductIds?.length === 3, true, "Gruplanan üç fiziksel ürün kaydı korunur");
assertEqual(getGroupedAvailableStock(groupedFabric[0]) === 51, true, "Sepette ayrılmış 10 metre diğer satıcılar için toplamı 51 metreye indirir");
assertEqual(groupedFabric[0].rolls?.length === 3, true, "Üç fiziksel top grup ayrıntılarında korunur");

const differentColor = makeProduct({
  id: "fabric-top-red",
  name: "Premium Pamuk Kumaş - Top #4",
  sku: "FAB-004",
  category: "Kumaş",
  unit: "Metre",
  price: 250,
  stock: 10,
  metadata: { fabricType: "Pamuk", color: "Kırmızı", width: "150cm" }
});
assertEqual(groupFabricProducts([...separateTopProducts, differentColor]).length === 2, true, "Farklı renk varyantı ayrı kumaş çeşidi olarak kalır");


const shoeFamily: Product[] = [
  makeProduct({
    id: "shoe-black-40",
    productFamilyId: "family-running-shoe-01",
    variantLabel: "Siyah / 40",
    name: "Koşu Ayakkabısı",
    sku: "SHOE-BLK-40",
    category: "Ayakkabı",
    unit: "Adet",
    stock: 4,
    attributes: { Renk: "Siyah", Numara: "40" }
  }),
  makeProduct({
    id: "shoe-black-41",
    productFamilyId: "family-running-shoe-01",
    variantLabel: "Siyah / 41",
    name: "Koşu Ayakkabısı",
    sku: "SHOE-BLK-41",
    category: "Ayakkabı",
    unit: "Adet",
    stock: 6,
    attributes: { Renk: "Siyah", Numara: "41" }
  }),
  makeProduct({
    id: "shoe-white-40",
    productFamilyId: "family-running-shoe-01",
    variantLabel: "Beyaz / 40",
    name: "Koşu Ayakkabısı",
    sku: "SHOE-WHT-40",
    category: "Ayakkabı",
    unit: "Adet",
    stock: 3,
    attributes: { Renk: "Beyaz", Numara: "40" }
  })
];
const groupedShoes = groupProducts(shoeFamily);
assertEqual(groupedShoes.length === 1, true, "Tekstil dışındaki aynı ürün ailesinin varyantları tek ana satırda birleşir");
assertEqual(groupedShoes[0].stock === 13, true, "Genel ürün ailesinin alt kırılımlarındaki stoklar toplanır");
assertEqual(groupedShoes[0].groupMembers?.length === 3, true, "Genel ürün ailesinin üç varyantı ayrıntıda korunur");
assertEqual(groupedShoes[0].groupProductIds?.length === 3, true, "Genel ürün ailesinin kaynak kayıt kimlikleri korunur");
const sameNameDifferentFamilies = groupProducts([
  ...shoeFamily,
  makeProduct({
    id: "shoe-other-brand",
    productFamilyId: "family-running-shoe-02",
    name: "Koşu Ayakkabısı",
    sku: "OTHER-BRAND-01",
    category: "Ayakkabı",
    unit: "Adet",
    stock: 2
  })
]);
assertEqual(sameNameDifferentFamilies.length === 2, true, "Farklı ürün aileleri isimleri aynı olsa bile yanlışlıkla birleştirilmez");
const ungroupedSameName = groupProducts([
  makeProduct({ id: "generic-a", name: "USB Kablo", category: "Elektronik", unit: "Adet", stock: 5 }),
  makeProduct({ id: "generic-b", name: "USB Kablo", category: "Elektronik", unit: "Adet", stock: 7 })
]);
assertEqual(ungroupedSameName.length === 2, true, "Aile kimliği olmayan genel ürünler yalnızca isimleri aynı diye otomatik birleştirilmez");

console.log("\nSector roll visibility regression tests completed successfully.");
