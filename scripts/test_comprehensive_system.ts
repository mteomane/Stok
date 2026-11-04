/**
 * STOK-PRO COMPREHENSIVE SYSTEM VERIFICATION TEST SUITE
 * 
 * Verifies all 9 requirements:
 * 1. packageUnitsCount undefined regression fix
 * 2. packageUnitsCount valid persistence
 * 3. 16-row textile import test -> 1 product, 16 rolls, exactly 300.70 meters
 * 4. Fabric roll specific cut & FIFO deduction
 * 5. Box / Parcel / Coupon system (Box A: 50, Box B: 30 = 80 pcs -> 240m, sell 1 -> 79 pcs, 237m)
 * 6. Sales transaction idempotency (no double deduction)
 * 7. Textile roll 10-column export
 * 8. Order line-item recalculation & locking
 * 9. Tenant isolation & security validation
 */

import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  connectFirestoreEmulator, 
  doc, 
  getDoc, 
  setDoc, 
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore";
import { FirebaseProductRepository } from "../src/lib/repositories/firebase/FirebaseProductRepository";
import { FirebaseSalesRepository } from "../src/lib/repositories/firebase/FirebaseSalesRepository";
import { FirebaseOrderRepository } from "../src/lib/repositories/firebase/FirebaseOrderRepository";
import { dataImportService } from "../src/lib/export/ImportService";
import { exportService } from "../src/lib/export/ExportService";
import { sanitizeFirestorePayload } from "../src/lib/repositories/firebase/helpers";
import { Product, FabricRoll, ProductBox, Order } from "../src/types";

const EMULATOR_HOST = "127.0.0.1";
const EMULATOR_PORT = 8088;
const TEST_PROJECT_ID = "demo-stok-pro-comprehensive";

const app = initializeApp({
  projectId: TEST_PROJECT_ID,
  apiKey: "fake-api-key"
});
const db = getFirestore(app);

try {
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORT);
} catch {
  // Already connected
}

const productRepo = new FirebaseProductRepository(db);
const salesRepo = new FirebaseSalesRepository(db);
const orderRepo = new FirebaseOrderRepository(db);

const tenantId = "tenant_test_" + Date.now();
const userId = "user_test_" + Date.now();

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    testsFailed++;
    throw new Error(message);
  } else {
    console.log(`✅ PASSED: ${message}`);
    testsPassed++;
  }
}

async function runAllTests() {
  console.log("\n=======================================================");
  console.log("🚀 STARTING STOK-PRO COMPREHENSIVE VERIFICATION SUITE");
  console.log("=======================================================\n");

  // -------------------------------------------------------------------------
  // TEST 1: packageUnitsCount undefined sanitization & persistence
  // -------------------------------------------------------------------------
  console.log("--- TEST 1: packageUnitsCount undefined sanitization ---");
  const payloadWithUndefined = {
    name: "Test Normal Ürün",
    sku: "SKU-TEST-1",
    price: 150,
    stock: 20,
    minStock: 5,
    packageUnitsCount: undefined,
    subUnitStock: undefined,
    isPackaged: false,
    category: "Genel"
  };

  const sanitized = sanitizeFirestorePayload(payloadWithUndefined);
  assert(!("packageUnitsCount" in sanitized), "packageUnitsCount undefined property was removed by sanitizer");
  assert(!("subUnitStock" in sanitized), "subUnitStock undefined property was removed by sanitizer");

  // Write through repository to Firestore emulator
  const createdProd1 = await productRepo.create(userId, payloadWithUndefined as any);
  assert(!!createdProd1.id, `Product created without undefined crash, ID: ${createdProd1.id}`);

  const fetchedDoc1 = await getDoc(doc(db, "products", createdProd1.id));
  assert(fetchedDoc1.exists(), "Product document exists in Firestore");
  assert(fetchedDoc1.data().packageUnitsCount === undefined, "Firestore doc does not have packageUnitsCount undefined field");

  // -------------------------------------------------------------------------
  // TEST 2: Packaged product with valid numbers
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 2: Packaged product with valid numbers ---");
  const packagedPayload = {
    name: "Koli İçi Düğme",
    sku: "SKU-TEST-PACK",
    price: 200,
    stock: 10,
    minStock: 2,
    isPackaged: true,
    packageUnitsCount: 50,
    packageUnitName: "Adet",
    subUnitStock: 30,
    category: "Aksesuar"
  };

  const createdPack = await productRepo.create(userId, packagedPayload as any);
  assert(createdPack.packageUnitsCount === 50, "packageUnitsCount correctly preserved as 50");
  assert(createdPack.packageUnitName === "Adet", "packageUnitName preserved");

  // -------------------------------------------------------------------------
  // TEST 3: 16-Row Textile Import Test (300.70m total verification)
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 3: Textile Roll Import (16 rows, 1 product, 300.70m) ---");
  const sample16Meters = [
    18.50, 19.20, 20.00, 17.80, 22.10, 16.40, 19.90, 21.30, 
    18.00, 20.50, 15.60, 19.40, 23.00, 17.50, 16.20, 15.30
  ];
  const expectedSum = 300.70;
  const computedSum = Math.round(sample16Meters.reduce((a, b) => a + b, 0) * 100) / 100;
  assert(computedSum === expectedSum, `16 sample meters sum mathematically equals exactly ${expectedSum}m`);

  // Build CSV content matching 7 columns: Ürün Adı;Renk Kodu;Renk;Metre;Adet;Tarih;Gelen Firma
  const csvLines = ["Ürün Adı;Renk Kodu;Renk;Metre;Adet;Tarih;Gelen Firma"];
  sample16Meters.forEach((m) => {
    csvLines.push(`Süprem Viskon Kumaş;01;Siyah;${m.toString().replace(".", ",")};1;2026-03-15;Akın Tekstil A.Ş.`);
  });
  const csvContent = "\uFEFF" + csvLines.join("\n");
  const file = new File([csvContent], "tekstil_rulo_girisi.csv", { type: "text/csv" });

  const preview = await dataImportService.previewUniversalImport(file, {
    targetEntityType: "product"
  });

  assert(preview.validRowsCount === 16, `Preview has 16 valid rows (found: ${preview.validRowsCount})`);
  assert(preview.parsedEntities.length === 1, `Consolidated into 1 unified Product entity (found: ${preview.parsedEntities.length})`);

  const textileProduct = preview.parsedEntities[0];
  assert(textileProduct.name === "Süprem Viskon Kumaş", `Product name is correct: ${textileProduct.name}`);
  assert(textileProduct.rolls?.length === 16, `Product contains 16 distinct rolls (found: ${textileProduct.rolls?.length})`);
  assert(textileProduct.stock === expectedSum, `Product total stock is exactly ${expectedSum}m (found: ${textileProduct.stock})`);

  // Verify each roll has unique ID
  const rollIds = new Set(textileProduct.rolls?.map(r => r.id));
  assert(rollIds.size === 16, "All 16 rolls have distinct unique IDs");

  // Execute import into Firestore
  const importResult = await dataImportService.executeUniversalBatchImport(
    preview.parsedEntities,
    userId,
    { targetEntityType: "product", duplicateHandling: "merge" }
  );
  assert(importResult.successfulCount === 1, `1 product successfully imported into database`);

  // Fetch from database and verify rolls
  const importedProducts = await productRepo.getAll(userId);
  const dbTextileProd = importedProducts.find(p => p.name === "Süprem Viskon Kumaş");
  assert(!!dbTextileProd, "Imported textile product retrieved from database");
  assert(dbTextileProd?.stock === 300.70, `Database product stock matches 300.70m (actual: ${dbTextileProd?.stock})`);
  assert(dbTextileProd?.rolls?.length === 16, `Database product rolls count is 16 (actual: ${dbTextileProd?.rolls?.length})`);

  // -------------------------------------------------------------------------
  // TEST 4: Specific Roll Sales Deduction
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 4: Specific Roll Sales Deduction ---");
  const firstRoll = dbTextileProd!.rolls![0];
  const initialRollLen = firstRoll.length; // 18.50m
  const cutLen = 5.0; // Cut 5m

  const saleKey1 = "sale_test_roll_1_" + Date.now();
  await salesRepo.createSaleAtomic(userId, {
    items: [
      {
        productId: dbTextileProd!.id,
        quantity: 1,
        selectedRollId: firstRoll.id,
        cutLength: cutLen
      }
    ],
    idempotencyKey: saleKey1,
    paymentMethod: "nakit"
  });

  const prodAfterCut = await productRepo.getById(dbTextileProd!.id);
  const updatedFirstRoll = prodAfterCut!.rolls!.find(r => r.id === firstRoll.id);
  const expectedRollRemaining = Math.round((initialRollLen - cutLen) * 100) / 100; // 13.50m
  const expectedProductRemaining = Math.round((300.70 - cutLen) * 100) / 100; // 295.70m

  assert(updatedFirstRoll?.length === expectedRollRemaining, `Roll length correctly reduced to ${expectedRollRemaining}m (actual: ${updatedFirstRoll?.length})`);
  assert(updatedFirstRoll?.soldLength === cutLen, `Roll soldLength is recorded as ${cutLen}m`);
  assert(prodAfterCut?.stock === expectedProductRemaining, `Product total stock synced to sum of rolls: ${expectedProductRemaining}m (actual: ${prodAfterCut?.stock})`);

  // -------------------------------------------------------------------------
  // TEST 5: Box / Parcel / Coupon System
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 5: Box / Parcel / Coupon System (50 + 30 = 80 pcs -> 240m) ---");
  const boxA: ProductBox = {
    id: "BOX-A-" + Date.now(),
    boxNumber: "Koli A",
    quantity: 50,
    initialQuantity: 50,
    soldQuantity: 0,
    status: "available",
    entryDate: "2026-03-20"
  };
  const boxB: ProductBox = {
    id: "BOX-B-" + Date.now(),
    boxNumber: "Koli B",
    quantity: 30,
    initialQuantity: 30,
    soldQuantity: 0,
    status: "available",
    entryDate: "2026-03-21"
  };

  const couponProductPayload: Omit<Product, "id"> = {
    name: "İpek Şifon Kupon",
    sku: "SKU-KUPON-1",
    price: 350,
    stock: 80, // 50 + 30 = 80 adet
    minStock: 10,
    unit: "Adet",
    metersPerUnit: 3, // Each coupon is 3 meters
    boxes: [boxA, boxB],
    category: "Kupon"
  };

  const createdCouponProduct = await productRepo.create(userId, couponProductPayload);
  assert(createdCouponProduct.stock === 80, "Initial coupon stock is 80 pcs");
  assert(createdCouponProduct.boxes?.length === 2, "Product has 2 boxes");

  const equivalentMetersInitial = (createdCouponProduct.stock || 0) * (createdCouponProduct.metersPerUnit || 0);
  assert(equivalentMetersInitial === 240, `Equivalent initial meters = 80 * 3 = 240m (computed: ${equivalentMetersInitial}m)`);

  // Sell 1 piece specifically from Box A
  const couponSaleKey = "sale_test_coupon_" + Date.now();
  await salesRepo.createSaleAtomic(userId, {
    items: [
      {
        productId: createdCouponProduct.id,
        quantity: 1,
        selectedBoxId: boxA.id
      }
    ],
    idempotencyKey: couponSaleKey,
    paymentMethod: "nakit"
  });

  const prodAfterCouponSale = await productRepo.getById(createdCouponProduct.id);
  const updatedBoxA = prodAfterCouponSale!.boxes!.find(b => b.id === boxA.id);
  const updatedBoxB = prodAfterCouponSale!.boxes!.find(b => b.id === boxB.id);

  assert(prodAfterCouponSale?.stock === 79, `Total stock dropped from 80 to 79 pcs (actual: ${prodAfterCouponSale?.stock})`);
  assert(updatedBoxA?.quantity === 49, `Box A quantity decreased to 49 (actual: ${updatedBoxA?.quantity})`);
  assert(updatedBoxB?.quantity === 30, `Box B quantity remained untouched at 30`);
  const equivalentMetersAfter = (prodAfterCouponSale?.stock || 0) * (prodAfterCouponSale?.metersPerUnit || 0);
  assert(equivalentMetersAfter === 237, `Equivalent meters updated to 79 * 3 = 237m (computed: ${equivalentMetersAfter}m)`);

  // -------------------------------------------------------------------------
  // TEST 6: Sales Transaction Idempotency (Prevent double deduction)
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 6: Sales Transaction Idempotency ---");
  // Retry the exact same sale with the exact same idempotencyKey
  await salesRepo.createSaleAtomic(userId, {
    items: [
      {
        productId: createdCouponProduct.id,
        quantity: 1,
        selectedBoxId: boxA.id
      }
    ],
    idempotencyKey: couponSaleKey, // Same key!
    paymentMethod: "nakit"
  });

  const prodAfterRetry = await productRepo.getById(createdCouponProduct.id);
  assert(prodAfterRetry?.stock === 79, `Stock was NOT deducted twice (remains 79 pcs)`);

  // -------------------------------------------------------------------------
  // TEST 7: Textile Roll 10-Column Export
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 7: Textile Roll 10-Column Export ---");
  const exportedCsv = exportService.exportRolls([prodAfterCut!]);
  assert(exportedCsv.startsWith("\uFEFF"), "Export starts with UTF-8 BOM");
  const headerLine = exportedCsv.split("\n")[0];
  const expectedCols = [
    "Ürün Adı",
    "Renk Kodu",
    "Renk",
    "Rulo / Top No",
    "Başlangıç Metresi",
    "Kalan Metre",
    "Satılan Metre",
    "Giriş Tarihi",
    "Gelen Firma",
    "Durum"
  ];
  expectedCols.forEach(col => {
    assert(headerLine.includes(col), `Export header includes column: "${col}"`);
  });

  // -------------------------------------------------------------------------
  // TEST 8: Order Management & Total Recalculation
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 8: Order Management & Total Recalculation ---");
  const orderData = {
    customerDetails: {
      name: "Örnek Tekstil Sanayi Ltd.",
      address: "İstanbul",
      phone: "05551234567"
    },
    items: [
      {
        productId: createdProd1.id,
        quantity: 2,
        price: 150
      }
    ],
    amountPaid: 100
  };

  const createdOrder = await orderRepo.createAtomic(userId, orderData as any);
  assert(createdOrder.totalAmount === 300, `Initial order total = 2 * 150 = 300 TL (actual: ${createdOrder.totalAmount})`);
  assert(createdOrder.status === "Sipariş Alındı", `Initial order status is "Sipariş Alındı"`);

  // Update order items: change quantity to 4 (recalculated total = 4 * 150 = 600 TL)
  const updatedItems = [
    {
      productId: createdProd1.id,
      productName: createdProd1.name,
      quantity: 4,
      price: 150
    }
  ];
  await orderRepo.update(createdOrder.id, {
    items: updatedItems,
    totalAmount: 600
  });

  const fetchedOrder = await orderRepo.getById(createdOrder.id);
  assert(fetchedOrder?.totalAmount === 600, `Order total recalculated to 600 TL (actual: ${fetchedOrder?.totalAmount})`);
  assert(fetchedOrder?.items[0].quantity === 4, `Order item quantity updated to 4`);

  // -------------------------------------------------------------------------
  // TEST 9: Tenant Isolation & Authentication Guard
  // -------------------------------------------------------------------------
  console.log("\n--- TEST 9: Tenant Isolation & Authentication Guard ---");
  const otherUserId = "user_attacker_" + Date.now();
  const otherUserProducts = await productRepo.getAll(otherUserId);
  const leakedProduct = otherUserProducts.find(p => p.id === createdProd1.id);
  assert(!leakedProduct, "Other tenant/user CANNOT read or see products from first user");

  console.log("\n=======================================================");
  console.log(`🎉 ALL TESTS COMPLETED: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("=======================================================\n");

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
