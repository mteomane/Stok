import React, { useState } from "react";
import { Product } from "../types";
import { roundQty, round2 } from "../lib/firestoreService";
import { 
  Plus, 
  Minus, 
  Package, 
  X, 
  TrendingUp, 
  CheckCircle2, 
  AlertCircle, 
  ShoppingCart, 
  Tag, 
  DollarSign, 
  Layers,
  ArrowRight
} from "lucide-react";

interface QuickReplenishModalProps {
  product: Product;
  onReplenish: (
    productId: string, 
    quantityToAdd: number, 
    options?: { costPrice?: number; note?: string }
  ) => Promise<void>;
  onNavigateToSale?: (product: Product) => void;
  onClose: () => void;
}

export function QuickReplenishModal({
  product,
  onReplenish,
  onNavigateToSale,
  onClose
}: QuickReplenishModalProps) {
  const [amount, setAmount] = useState<string>("10");
  const [costPrice, setCostPrice] = useState<string>(product.costPrice !== undefined ? String(product.costPrice) : "");
  const [note, setNote] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const parsedAmount = parseFloat(amount);
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;
  const currentStock = Number(product.stock || 0);
  const nextStock = isValidAmount ? roundQty(currentStock + parsedAmount) : currentStock;
  const unit = product.unit || "Adet";

  const handleQuickAdd = (inc: number) => {
    const cur = isNaN(parsedAmount) || parsedAmount < 0 ? 0 : parsedAmount;
    setAmount(String(roundQty(cur + inc)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidAmount) {
      setError("Lütfen geçerli bir stok giriş miktarı girin (0'dan büyük olmalı).");
      return;
    }

    const parsedCost = costPrice.trim() !== "" ? parseFloat(costPrice) : undefined;
    if (parsedCost !== undefined && (isNaN(parsedCost) || parsedCost < 0)) {
      setError("Lütfen geçerli bir alış fiyatı girin.");
      return;
    }

    try {
      setIsSubmitting(true);
      await onReplenish(product.id, parsedAmount, {
        costPrice: parsedCost,
        note: note.trim() || undefined
      });
      setSuccessMsg(`Stoğa ${parsedAmount} ${unit} başarıyla eklendi! Yeni stok: ${nextStock} ${unit}`);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || "Stok güncellenirken bir hata oluştu.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-2xl border border-slate-200 animate-fade-in flex flex-col max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-slate-100 pb-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                {product.category || "Genel"}
              </span>
              {product.barcode && (
                <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  Barkod: {product.barcode}
                </span>
              )}
            </div>
            <h3 className="font-extrabold text-slate-800 text-lg sm:text-xl mt-1.5 leading-snug">
              {product.name}
            </h3>
            <span className="text-xs text-slate-400 font-mono">SKU: {product.sku}</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Stock vs Next Stock Card */}
        <div className="grid grid-cols-2 gap-3 mb-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Mevcut Stok</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className={`text-xl font-black ${currentStock <= product.minStock ? "text-rose-600" : "text-slate-800"}`}>
                {currentStock}
              </span>
              <span className="text-xs font-semibold text-slate-500">{unit}</span>
            </div>
          </div>

          <div className="border-l border-slate-200 pl-3">
            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">İşlem Sonrası Stok</span>
            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xl font-black text-emerald-600">
                {nextStock}
              </span>
              <span className="text-xs font-semibold text-emerald-700">{unit}</span>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-rose-50 text-rose-700 text-xs p-3 rounded-xl border border-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 bg-emerald-50 text-emerald-700 text-xs p-3 rounded-xl border border-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Replenish Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Giriş Yapılacak Miktar ({unit}) *
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="any"
                min="0.001"
                required
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Örn: 24"
                className="flex-1 px-4 py-3 rounded-xl border-2 border-indigo-200 text-lg font-black text-slate-800 focus:outline-none focus:border-indigo-600 bg-white shadow-2xs"
              />
              <span className="text-sm font-bold text-slate-600 px-2 py-3 bg-slate-100 rounded-xl border border-slate-200">
                {unit}
              </span>
            </div>

            {/* Quick Touch Chips for Mobile Esnaf */}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {[1, 5, 10, 24, 50, 100].map((step) => (
                <button
                  type="button"
                  key={step}
                  onClick={() => handleQuickAdd(step)}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 text-xs font-bold rounded-lg border border-slate-200 active:scale-95 transition-all cursor-pointer"
                >
                  +{step}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAmount("")}
                className="px-2.5 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 text-xs font-bold rounded-lg border border-rose-200 transition-all cursor-pointer ml-auto"
              >
                Temizle
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">
                Alış Fiyatı (₺ / Birim)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder={product.costPrice ? String(product.costPrice) : "İsteğe bağlı maliyet"}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">
                İrsaliye / Fatura / Not
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Örn: Toptancı ABC Teslimatı"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              />
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <button
              type="submit"
              disabled={isSubmitting || !isValidAmount}
              className="flex-1 py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20 active:scale-98 transition-all cursor-pointer"
            >
              <TrendingUp className="w-5 h-5" />
              <span>{isSubmitting ? "Kaydediliyor..." : `Stoğu Artır (+${amount || "0"} ${unit})`}</span>
            </button>

            {onNavigateToSale && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigateToSale(product);
                }}
                className="py-3.5 px-4 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-200"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Hemen Sat</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
