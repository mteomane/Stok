import React, { useState, useEffect } from "react";
import { Sale, Product, CompanyInfo } from "../types";
import { Printer, X, FileText, Calendar, DollarSign, TrendingUp, ShoppingBag, CreditCard, User, Building2 } from "lucide-react";
import { auth } from "../lib/firebase";
import { getCompanyInfo } from "../lib/firestoreService";

interface SalesReportModalProps {
  sales: Sale[];
  products?: Product[];
  startDate: string;
  endDate: string;
  datePresetName: string;
  onClose: () => void;
}

export function SalesReportModal({
  sales,
  products,
  startDate,
  endDate,
  datePresetName,
  onClose,
}: SalesReportModalProps) {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);

  useEffect(() => {
    const fetchCompany = async () => {
      try {
        const uid = auth.currentUser?.uid || "demo-user";
        const data = await getCompanyInfo(uid);
        if (data) setCompanyInfo(data);
      } catch (err) {
        console.error("Error fetching company info for report:", err);
      }
    };
    fetchCompany();
  }, []);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(val);
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Calculations for summary
  const totalRevenue = sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalTransactions = sales.length;
  const totalItemsSold = sales.reduce(
    (sum, s) => sum + s.items.reduce((iSum, i) => iSum + i.quantity, 0),
    0
  );
  const avgBasket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  // Breakdown by payment method
  const paymentBreakdown = sales.reduce(
    (acc, s) => {
      const method = s.paymentMethod || "cash";
      if (!acc[method]) acc[method] = { count: 0, amount: 0 };
      acc[method].count += 1;
      acc[method].amount += s.totalAmount;
      return acc;
    },
    {} as Record<string, { count: number; amount: number }>
  );

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case "credit_card":
        return "Kredi Kartı";
      case "debt":
        return "Açık Hesap (Cari)";
      case "cash":
      default:
        return "Nakit Ödeme";
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in">
      {/* Print Specific CSS Styles for A4 Document Printing */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-sales-report-root, #printable-sales-report-root * {
            visibility: visible !important;
          }
          #printable-sales-report-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 20px !important;
            background: white !important;
            color: black !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden no-print">
        {/* Header */}
        <div className="p-4 sm:px-6 border-b border-slate-150 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-200">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                Satış Geçmişi & Rapor Dökümü (PDF)
              </h3>
              <p className="text-xs text-slate-400">
                Filtrelenen Dönem: <span className="font-bold text-slate-700">{datePresetName}</span> ({sales.length} İşlem)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Report Preview Body (Scrollable) */}
        <div className="p-4 sm:p-6 bg-slate-100 overflow-y-auto flex-1">
          <div
            id="printable-sales-report-root"
            className="bg-white p-6 sm:p-8 rounded-xl shadow-lg border border-slate-200 w-full text-slate-800 font-sans text-xs space-y-6"
          >
            {/* Header / Store Branding */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b-2 border-slate-900 gap-4">
              <div>
                <h1 className="text-xl font-black uppercase text-slate-900 tracking-tight">
                  {companyInfo?.name || "STOKPRO MAĞAZA DÖKÜMÜ"}
                </h1>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">
                  DETAYLI SATIŞ GEÇMİŞİ VE CİRO RAPORU
                </p>
                {companyInfo?.address && (
                  <p className="text-[11px] text-slate-400 mt-1">{companyInfo.address}</p>
                )}
                {companyInfo?.phone && (
                  <p className="text-[11px] text-slate-400">Tel: {companyInfo.phone}</p>
                )}
              </div>
              <div className="text-left sm:text-right bg-slate-50 p-3 rounded-lg border border-slate-200 min-w-[200px]">
                <div className="text-[10px] text-slate-400 font-bold uppercase">Rapor Kapsamı</div>
                <div className="text-xs font-black text-indigo-700 mt-0.5">{datePresetName}</div>
                {startDate && endDate && (
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {startDate} — {endDate}
                  </div>
                )}
                <div className="text-[10px] text-slate-400 mt-2">
                  Döküm Tarihi: {new Date().toLocaleString("tr-TR")}
                </div>
              </div>
            </div>

            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Toplam Ciro</span>
                <span className="text-base font-black text-emerald-600 block mt-1">{formatCurrency(totalRevenue)}</span>
              </div>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">İşlem Sayısı</span>
                <span className="text-base font-black text-indigo-600 block mt-1">{totalTransactions} Fiş</span>
              </div>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Satılan Ürün</span>
                <span className="text-base font-black text-slate-800 block mt-1">{totalItemsSold} Adet</span>
              </div>
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ortalama Sepet</span>
                <span className="text-base font-black text-slate-800 block mt-1">{formatCurrency(avgBasket)}</span>
              </div>
            </div>

            {/* Payment Method Breakdown */}
            <div className="space-y-2">
              <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Ödeme Tiplerine Göre Dağılım</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {["cash", "credit_card", "debt"].map((method) => {
                  const data = paymentBreakdown[method] || { count: 0, amount: 0 };
                  const percent = totalRevenue > 0 ? ((data.amount / totalRevenue) * 100).toFixed(1) : "0";
                  return (
                    <div key={method} className="bg-slate-50/80 p-2.5 rounded-lg border border-slate-200 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-slate-700 block text-xs">{getPaymentMethodLabel(method)}</span>
                        <span className="text-[10px] text-slate-400">{data.count} Satış (%{percent})</span>
                      </div>
                      <span className="font-bold font-mono text-slate-900">{formatCurrency(data.amount)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sales Table */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Satış İşlemleri Listesi</h4>
                <span className="text-[10px] text-slate-400 font-mono">Toplam {sales.length} Kayıt</span>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-slate-100 text-slate-600 font-bold uppercase text-[10px] border-b border-slate-200">
                      <th className="py-2 px-3">Tarih</th>
                      <th className="py-2 px-3">Fiş No</th>
                      <th className="py-2 px-3">Müşteri</th>
                      <th className="py-2 px-3">Ödeme Yöntemi</th>
                      <th className="py-2 px-3">Satılan Kalemler</th>
                      <th className="py-2 px-3 text-right">Tutar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {sales.map((sale) => {
                      return (
                        <tr key={sale.id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                            {formatDate(sale.timestamp)}
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-slate-800">
                            #{sale.id.slice(0, 8)}
                          </td>
                          <td className="py-2 px-3 text-slate-700">
                            {sale.customerName || "-"}
                          </td>
                          <td className="py-2 px-3 font-medium">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] uppercase font-semibold">
                              {getPaymentMethodLabel(sale.paymentMethod || "cash")}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            <div className="max-w-xs space-y-0.5">
                              {sale.items.map((it, idx) => {
                                const name =
                                  it.productName ||
                                  (it as any).name ||
                                  products?.find((p) => p.id === it.productId)?.name ||
                                  "Ürün";
                                const roll = (it as any).selectedRollNumber
                                  ? ` (${(it as any).selectedRollNumber})`
                                  : "";
                                return (
                                  <div key={idx} className="text-[10px]">
                                    • {name} {roll} x <span className="font-bold text-slate-800">{it.quantity}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900 font-mono whitespace-nowrap">
                            {formatCurrency(sale.totalAmount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                      <td colSpan={5} className="py-2.5 px-3 text-right uppercase">
                        GENEL TOPLAM CİRO:
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-600 font-mono text-xs">
                        {formatCurrency(totalRevenue)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Official Report Footer */}
            <div className="pt-6 border-t border-slate-200 flex justify-between items-end text-[10px] text-slate-400">
              <div>
                <p>Bu rapor Otomatik Stok & Satış Takip Sistemi tarafından üretilmiştir.</p>
                <p>© {new Date().getFullYear()} StokPro Enterprise System</p>
              </div>
              <div className="text-center min-w-[150px] border-t border-slate-300 pt-2 font-semibold text-slate-600">
                Raporu Onaylayan / İmza
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center no-print">
          <span className="text-xs text-slate-500 font-medium">
            Tarayıcınızın "PDF Olarak Kaydet" seçeneğini kullanarak bilgisayarınıza indirebilirsiniz.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              Kapat
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-200 flex items-center gap-2 transition-all cursor-pointer active:scale-95"
            >
              <Printer className="w-4 h-4" />
              PDF İndir / Yazdır
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
