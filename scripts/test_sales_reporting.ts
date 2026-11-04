import type { Sale } from "../src/types";
import { calculateSalesMetrics, isCancelledSale } from "../src/lib/salesMetrics";

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`[FAIL] ${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
  console.log(`[PASS] ${label}`);
}

function makeSale(
  id: string,
  amount: number,
  quantity: number,
  status?: Sale["status"],
  stockRestored?: boolean,
  paymentMethod?: string
): Sale {
  return {
    id,
    items: [{
      productId: `product-${id}`,
      productName: "Test ürün",
      quantity,
      price: amount
    }],
    totalAmount: amount,
    timestamp: "2026-11-04T10:00:00.000Z",
    status,
    stockRestored,
    paymentMethod
  };
}

const sales = [
  makeSale("completed-cash", 120, 2, "Tamamlandı", false, "cash"),
  makeSale("cancelled", 50, 1, "İptal Edildi", true, "cash"),
  makeSale("refunded", 80, 3, "İade Edildi", true, "debt"),
  makeSale("restored-legacy", 40, 7, undefined, true, "credit_card"),
  makeSale("completed-card", 80, 3, "Tamamlandı", false, "credit_card")
];

const metrics = calculateSalesMetrics(sales);

assertEqual(isCancelledSale(sales[1]), true, "İptal edilen fiş iptal olarak tanınır");
assertEqual(isCancelledSale(sales[2]), true, "İade edilen fiş iptal/iade olarak tanınır");
assertEqual(isCancelledSale(sales[3]), true, "Stok iadesi işaretli eski kayıt tamamlanan satış sayılmaz");
assertEqual(metrics.completedSales.length, 2, "Yalnızca tamamlanan fişler satış metriğine katılır");
assertEqual(metrics.cancelledTransactions, 3, "İptal/iade fiş sayısı doğru hesaplanır");
assertEqual(metrics.totalRevenue, 200, "Ciro iptal/iade tutarlarını dışarıda bırakır");
assertEqual(metrics.totalTransactions, 2, "Tamamlanan işlem sayısı doğru hesaplanır");
assertEqual(metrics.totalItemsSold, 5, "Satılan miktar iptal/iade kalemlerini dışarıda bırakır");
assertEqual(metrics.paymentBreakdown.cash?.amount, 120, "Ödeme dağılımı iptal edilen nakit satışı dışarıda bırakır");
assertEqual(metrics.paymentBreakdown.credit_card?.amount, 80, "Tamamlanan kart satışı ödeme dağılımına eklenir");

console.log("\nSales reporting regression tests completed successfully.");
