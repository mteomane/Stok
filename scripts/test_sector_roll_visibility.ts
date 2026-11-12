import type { Product } from "../src/types";
import { getAvailableBoxQuantity, getAvailableRollLength, getAvailableStock, getRollStockBalance, shouldShowRolls } from "../src/lib/sectorConfig";

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

console.log("\nSector roll visibility regression tests completed successfully.");
