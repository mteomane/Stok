import type { Sale } from "../types";

export interface PaymentMethodTotals {
  count: number;
  amount: number;
}

export interface SalesMetrics {
  completedSales: Sale[];
  cancelledTransactions: number;
  totalRevenue: number;
  totalTransactions: number;
  totalItemsSold: number;
  paymentBreakdown: Record<string, PaymentMethodTotals>;
}

/**
 * A cancelled/refunded sale remains visible in the audit history, but it must
 * not contribute to revenue, successful transaction counts, or sold-item KPIs.
 */
export function isCancelledSale(
  sale: Pick<Sale, "status" | "stockRestored">
): boolean {
  return (
    sale.status === "İptal Edildi" ||
    sale.status === "İade Edildi" ||
    sale.stockRestored === true
  );
}

export function calculateSalesMetrics(sales: Sale[]): SalesMetrics {
  const completedSales = sales.filter((sale) => !isCancelledSale(sale));
  const totalRevenue = completedSales.reduce(
    (sum, sale) => sum + Number(sale.totalAmount || 0),
    0
  );
  const totalItemsSold = completedSales.reduce(
    (sum, sale) =>
      sum + sale.items.reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0),
    0
  );
  const paymentBreakdown = completedSales.reduce(
    (breakdown, sale) => {
      const method = sale.paymentMethod || "cash";
      if (!breakdown[method]) {
        breakdown[method] = { count: 0, amount: 0 };
      }
      breakdown[method].count += 1;
      breakdown[method].amount += Number(sale.totalAmount || 0);
      return breakdown;
    },
    {} as Record<string, PaymentMethodTotals>
  );

  return {
    completedSales,
    cancelledTransactions: sales.length - completedSales.length,
    totalRevenue,
    totalTransactions: completedSales.length,
    totalItemsSold,
    paymentBreakdown
  };
}
