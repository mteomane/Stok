import React, { useState, useEffect } from "react";
import { Sale, CompanyInfo, Product } from "../types";
import { Printer, X, Receipt as ReceiptIcon, Building2, Phone, Mail, MapPin, Calendar, CheckCircle2 } from "lucide-react";
import { auth } from "../lib/firebase";
import { getCompanyInfo } from "../lib/firestoreService";

interface ReceiptPrintModalProps {
  sale: Sale;
  products?: Product[];
  onClose: () => void;
}

export function ReceiptPrintModal({ sale, products, onClose }: ReceiptPrintModalProps) {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);

  useEffect(() => {
    const fetchCompany = async () => {
      try {
        const uid = auth.currentUser?.uid || "demo-user";
        const data = await getCompanyInfo(uid);
        if (data) {
          setCompanyInfo(data);
        }
      } catch (err) {
        console.error("Error fetching company info for receipt:", err);
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
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in">
      {/* Print Specific CSS Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-receipt-root, #printable-receipt-root * {
            visibility: visible !important;
          }
          #printable-receipt-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 80mm !important; /* Standard Thermal Receipt Width */
            margin: 0 auto !important;
            padding: 10px !important;
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

      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden no-print">
        {/* Header */}
        <div className="p-4 sm:px-6 border-b border-slate-150 flex justify-between items-center bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-200">
              <ReceiptIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                Satış Fişi / Makbuz Önizleme
              </h3>
              <p className="text-xs text-slate-400">Fiş No: #{sale.id.slice(0, 8).toUpperCase()}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Receipt Canvas (Scrollable Preview Area) */}
        <div className="p-6 bg-slate-100 overflow-y-auto flex flex-col items-center flex-1">
          <div
            id="printable-receipt-root"
            className="bg-white p-6 rounded-xl shadow-lg border border-slate-200 w-full max-w-[340px] text-slate-800 font-sans text-xs space-y-4"
          >
            {/* Store / Company Branding */}
            <div className="text-center space-y-1 pb-3 border-b border-dashed border-slate-300">
              <h2 className="font-black text-sm uppercase text-slate-900 tracking-wider">
                {companyInfo?.name || "STOKPRO MAĞAZA VE SATIŞ"}
              </h2>
              {companyInfo?.address && (
                <p className="text-[10px] text-slate-500 leading-tight">{companyInfo.address}</p>
              )}
              {companyInfo?.phone && (
                <p className="text-[10px] text-slate-500 font-mono">Tel: {companyInfo.phone}</p>
              )}
              {companyInfo?.taxOffice && companyInfo?.taxNumber && (
                <p className="text-[9px] text-slate-400">
                  {companyInfo.taxOffice} V.D. - {companyInfo.taxNumber}
                </p>
              )}
            </div>

            {/* Receipt Meta Details */}
            <div className="text-[10px] space-y-1 text-slate-600 pb-3 border-b border-dashed border-slate-300 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Fiş No:</span>
                <span className="font-bold text-slate-800">#{sale.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Tarih:</span>
                <span>{formatDate(sale.timestamp)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Ödeme Tipi:</span>
                <span className="font-bold text-indigo-600 uppercase">
                  {sale.paymentMethod === "credit_card"
                    ? "Kredi Kartı"
                    : sale.paymentMethod === "debt"
                    ? "Açık Hesap (Cari)"
                    : "Nakit"}
                </span>
              </div>
              {sale.customerName && (
                <div className="flex justify-between pt-1 border-t border-slate-100">
                  <span className="text-slate-400">Müşteri:</span>
                  <span className="font-bold text-slate-800">{sale.customerName}</span>
                </div>
              )}
            </div>

            {/* Items Table */}
            <div className="space-y-2 pb-3 border-b border-dashed border-slate-300">
              <div className="flex justify-between text-[10px] font-bold uppercase text-slate-400 pb-1 border-b border-slate-100">
                <span>Ürün Adı</span>
                <span>Tutar</span>
              </div>

              {sale.items.map((item, idx) => {
                const pName =
                  item.productName ||
                  (item as any).name ||
                  products?.find((p) => p.id === item.productId)?.name ||
                  `Ürün (#${item.productId})`;

                const rollInfo = (item as any).selectedRollNumber
                  ? ` Top: ${(item as any).selectedRollNumber}`
                  : "";

                return (
                  <div key={idx} className="space-y-0.5">
                    <div className="flex justify-between font-bold text-slate-800">
                      <span className="truncate max-w-[190px]">
                        {pName} {rollInfo}
                      </span>
                      <span className="font-mono">{formatCurrency(item.price * item.quantity)}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 font-mono pl-2">
                      <span>
                        {item.quantity} x {formatCurrency(item.price)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Totals Summary */}
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between font-extrabold text-sm text-slate-900 pt-1">
                <span>TOPLAM TUTAR:</span>
                <span className="font-mono text-emerald-600">{formatCurrency(sale.totalAmount)}</span>
              </div>
            </div>

            {/* Footer Note / Barcode Placeholder */}
            <div className="text-center pt-3 border-t border-dashed border-slate-300 space-y-1">
              <p className="text-[10px] font-bold text-slate-700">Alışverişiniz için Teşekkür Ederiz!</p>
              <p className="text-[9px] text-slate-400">Bizi Tercih Ettiğiniz İçin Saolun</p>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 no-print">
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
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-200 flex items-center gap-2 transition-all cursor-pointer active:scale-95"
          >
            <Printer className="w-4 h-4" />
            Fişi Yazdır (PDF / Termal)
          </button>
        </div>
      </div>
    </div>
  );
}
