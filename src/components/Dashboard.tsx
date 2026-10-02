import { Product, Sale } from "../types";
import { 
  TrendingUp, 
  Box, 
  Layers, 
  AlertTriangle, 
  ChevronRight, 
  PlusCircle, 
  ArrowRight, 
  ExternalLink, 
  ShieldCheck, 
  AlertCircle 
} from "lucide-react";

interface DashboardProps {
  products: Product[];
  sales: Sale[];
  onQuickReplenish: (productId: string, amount: number) => void;
  onNavigateToTab: (tab: string) => void;
  onNavigateToLowStock?: (productId?: string) => void;
}

export function Dashboard({ 
  products, 
  sales, 
  onQuickReplenish, 
  onNavigateToTab,
  onNavigateToLowStock 
}: DashboardProps) {
  // Calculate stats
  const totalSalesCiro = sales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalProductsCount = products.length;
  const totalStockQuantity = products.reduce((sum, p) => sum + p.stock, 0);
  const lowStockProducts = products.filter((p) => p.stock <= p.minStock);
  const outOfStockCount = lowStockProducts.filter((p) => p.stock <= 0).length;
  const criticalDeficit = lowStockProducts.reduce((sum, p) => sum + Math.max(0, p.minStock - p.stock), 0);
  const stockHealthRate = totalProductsCount > 0 
    ? Math.round(((totalProductsCount - lowStockProducts.length) / totalProductsCount) * 100) 
    : 100;

  // Get last 5 sales
  const recentSales = [...sales]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(val);
  };

  const formatTime = (isoString: string) => {
    const d = new Date(isoString);
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleLowStockNavigation = (productId?: string) => {
    if (onNavigateToLowStock) {
      onNavigateToLowStock(productId);
    } else {
      onNavigateToTab("inventory");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Sales Card */}
        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm relative overflow-hidden group">
          <div className="absolute right-3 top-3 bg-emerald-50 p-2 rounded-lg text-emerald-600 group-hover:scale-105 transition-transform">
            <TrendingUp className="w-5 h-5" />
          </div>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Toplam Ciro</span>
          <span className="text-2xl font-bold text-slate-900 mt-2 block tracking-tight">
            {formatCurrency(totalSalesCiro)}
          </span>
          <span className="text-[11px] text-emerald-600 font-medium mt-1.5 flex items-center gap-1">
            {sales.length} başarılı satış kaydı
          </span>
        </div>

        {/* Products Card */}
        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm relative overflow-hidden group">
          <div className="absolute right-3 top-3 bg-indigo-50 p-2 rounded-lg text-indigo-600 group-hover:scale-105 transition-transform">
            <Box className="w-5 h-5" />
          </div>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Kayıtlı Çeşit</span>
          <span className="text-2xl font-bold text-slate-900 mt-2 block tracking-tight">
            {totalProductsCount} Ürün
          </span>
          <span className="text-[11px] text-indigo-600 font-medium mt-1.5 block">
            Farklı varyant & model
          </span>
        </div>

        {/* Total Stock Card */}
        <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm relative overflow-hidden group">
          <div className="absolute right-3 top-3 bg-blue-50 p-2 rounded-lg text-blue-600 group-hover:scale-105 transition-transform">
            <Layers className="w-5 h-5" />
          </div>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Toplam Stok</span>
          <span className="text-2xl font-bold text-slate-900 mt-2 block tracking-tight">
            {totalStockQuantity} Adet
          </span>
          <span className="text-[11px] text-blue-600 font-medium mt-1.5 block">
            Depodaki toplam envanter
          </span>
        </div>

        {/* Low Stock Warning Card */}
        <div
          onClick={() => handleLowStockNavigation()}
          className={`cursor-pointer p-5 rounded-xl shadow-sm relative overflow-hidden group border transition-all ${
            lowStockProducts.length > 0
              ? "bg-rose-50/40 border-rose-200 hover:shadow-md hover:border-rose-300"
              : "bg-white border-slate-200"
          }`}
          title="Kritik stoktaki ürünleri filtrelemek için tıklayın"
        >
          <div
            className={`absolute right-3 top-3 p-2 rounded-lg group-hover:scale-105 transition-transform ${
              lowStockProducts.length > 0 ? "bg-rose-100 text-rose-600" : "bg-slate-50 text-slate-600"
            }`}
          >
            <AlertTriangle className="w-5 h-5" />
          </div>
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Kritik Stok</span>
          <span
            className={`text-2xl font-bold mt-2 block tracking-tight ${
              lowStockProducts.length > 0 ? "text-rose-600" : "text-slate-900"
            }`}
          >
            {lowStockProducts.length} Ürün
          </span>
          <span className={`text-[11px] font-medium mt-1.5 flex items-center justify-between ${lowStockProducts.length > 0 ? "text-rose-600 font-bold" : "text-slate-500"}`}>
            <span>{lowStockProducts.length > 0 ? "Acil takviye gerekiyor!" : "Tüm stok seviyeleri iyi"}</span>
            {lowStockProducts.length > 0 && (
              <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform text-rose-500" />
            )}
          </span>
        </div>
      </div>

      {/* DEDICATED CRITICAL STOCK SUMMARY CARD */}
      <div className={`p-5 rounded-2xl border transition-all ${
        lowStockProducts.length > 0
          ? "bg-gradient-to-br from-rose-50/70 via-white to-amber-50/30 border-rose-200 shadow-sm"
          : "bg-white border-slate-200 shadow-sm"
      }`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-150">
          <div className="flex items-start gap-3">
            <div className={`p-2.5 rounded-xl flex-shrink-0 ${
              lowStockProducts.length > 0
                ? "bg-rose-100 text-rose-600 ring-4 ring-rose-50"
                : "bg-emerald-50 text-emerald-600 ring-4 ring-emerald-50/50"
            }`}>
              {lowStockProducts.length > 0 ? (
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-800 tracking-tight">
                  Kritik Stok Seviyesi & İnceleme Özeti
                </h2>
                {lowStockProducts.length > 0 ? (
                  <span className="bg-rose-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                    {lowStockProducts.length} Ürün Minimum Eşik Altında
                  </span>
                ) : (
                  <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    Tüm Stoklar Güvende
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {lowStockProducts.length > 0
                  ? "Minimum stok sınırının altına inen ürünler aşağıda listelenmiştir. Doğrudan ürüne giderek düzenleme yapabilir veya tek tıkla envanterde filtreleyebilirsiniz."
                  : `Tüm ${totalProductsCount} kayıtlı ürününüz belirlenen minimum stok eşiğinin üzerinde.`}
              </p>
            </div>
          </div>

          {/* Quick Navigation Action Button */}
          <div className="flex items-center gap-2 self-start sm:self-center">
            {lowStockProducts.length > 0 ? (
              <button
                type="button"
                onClick={() => handleLowStockNavigation()}
                className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-sm shadow-rose-200 flex items-center gap-2 transition-all cursor-pointer"
              >
                <span>Tüm Kritik Ürünleri Envanterde Göster ({lowStockProducts.length})</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigateToTab("inventory")}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-2 transition-all cursor-pointer"
              >
                <span>Envanteri Görüntüle</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Mini stats breakdown when there are low stock items */}
        {lowStockProducts.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
            <div className="bg-white/90 border border-rose-100 p-3 rounded-xl shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Kritik Çeşit</span>
              <span className="text-xl font-black text-rose-600 mt-0.5 block">{lowStockProducts.length} Ürün</span>
              <span className="text-[10px] text-slate-500">Stok yenileme gerekli</span>
            </div>
            <div className="bg-white/90 border border-slate-150 p-3 rounded-xl shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Tükenen Stok (0)</span>
              <span className="text-xl font-black text-slate-800 mt-0.5 block">{outOfStockCount} Ürün</span>
              <span className="text-[10px] text-rose-500 font-semibold">
                {outOfStockCount > 0 ? "Hemen temin edilmeli" : "Tamamen tükenen ürün yok"}
              </span>
            </div>
            <div className="bg-white/90 border border-slate-150 p-3 rounded-xl shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Gereken Takviye</span>
              <span className="text-xl font-black text-amber-600 mt-0.5 block">{criticalDeficit} Adet</span>
              <span className="text-[10px] text-slate-500">Minimum eşik açığı</span>
            </div>
            <div className="bg-white/90 border border-slate-150 p-3 rounded-xl shadow-2xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Envanter Sağlığı</span>
              <span className="text-xl font-black text-indigo-600 mt-0.5 block">%{stockHealthRate}</span>
              <span className="text-[10px] text-slate-500">Eşik üstü ürün oranı</span>
            </div>
          </div>
        )}

        {/* Quick Product Navigation Grid */}
        {lowStockProducts.length > 0 && (
          <div className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                Hızlı Gezinme & Ürün Kartları
              </span>
              <span className="text-[11px] text-slate-400">
                Detay ve düzenleme için ürünü seçin
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {lowStockProducts.slice(0, 6).map((p) => {
                const deficit = Math.max(0, p.minStock - p.stock);
                const percent = p.minStock > 0 ? Math.min(100, Math.round((p.stock / p.minStock) * 100)) : 0;
                const isZero = p.stock <= 0;

                return (
                  <div
                    key={p.id}
                    className="bg-white border border-rose-200/80 hover:border-indigo-400 rounded-xl p-3.5 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="text-[9px] font-black uppercase text-indigo-600 tracking-wider bg-indigo-50 px-1.5 py-0.5 rounded inline-block mb-1">
                            {p.category}
                          </span>
                          <h4
                            onClick={() => handleLowStockNavigation(p.id)}
                            className="font-bold text-slate-800 text-sm truncate group-hover:text-indigo-600 transition-colors cursor-pointer"
                            title={`${p.name} - Envanterde Aç`}
                          >
                            {p.name}
                          </h4>
                          <span className="text-[10px] text-slate-400 font-mono">SKU: {p.sku}</span>
                        </div>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase flex-shrink-0 ${
                          isZero ? "bg-rose-600 text-white" : "bg-amber-100 text-amber-800"
                        }`}>
                          {isZero ? "TÜKENDİ" : `-${deficit} Eksik`}
                        </span>
                      </div>

                      {/* Stock vs Min Stock progress bar */}
                      <div className="mt-3 space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="font-bold text-slate-600">
                            Stok: <strong className={isZero ? "text-rose-600" : "text-amber-600"}>{p.stock}</strong> / Min: {p.minStock}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400">%{percent}</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              isZero ? "bg-rose-600 w-0" : percent < 50 ? "bg-rose-500" : "bg-amber-500"
                            }`}
                            style={{ width: `${Math.max(4, percent)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleLowStockNavigation(p.id)}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 group/btn cursor-pointer py-1"
                      >
                        <span>Envanterde İncele</span>
                        <ExternalLink className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onQuickReplenish(p.id, 10)}
                        title="Hemen +10 Adet Stok Ekle"
                        className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 active:scale-95 text-slate-600 text-[11px] font-bold rounded-lg border border-slate-200 transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <PlusCircle className="w-3.5 h-3.5 text-indigo-500" />
                        <span>+10 Ekle</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {lowStockProducts.length > 6 && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => handleLowStockNavigation()}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
                >
                  +{lowStockProducts.length - 6} diğer kritik ürünü envanterde incele →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Low Stock Alerts */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-rose-50 flex items-center justify-center text-rose-500">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <h2 className="font-bold text-slate-800 text-sm tracking-wide uppercase">Kritik Stok Uyarıları</h2>
            </div>
            <div className="flex items-center gap-2">
              {lowStockProducts.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleLowStockNavigation()}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 group cursor-pointer"
                  title="Envanterde kritik stoktakileri filtrele"
                >
                  <span>Envanterde Filtrele</span>
                  <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              )}
              {lowStockProducts.length > 0 && (
                <span className="bg-rose-100 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Acil Eylem
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3 flex-1">
            {lowStockProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center h-full">
                <Box className="w-10 h-10 text-slate-300 mb-2" />
                <span className="text-sm font-semibold text-slate-700">Harika! Stoklar Güvende</span>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">
                  Minimum düzeyin altında kalan herhangi bir ürününüz bulunmamaktadır.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 max-h-[300px] overflow-y-auto pr-1">
                {lowStockProducts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 group">
                    <div 
                      onClick={() => handleLowStockNavigation(p.id)}
                      className="min-w-0 pr-4 flex-1 cursor-pointer"
                      title="Envanterde bu ürünü incele"
                    >
                      <span className="text-sm font-bold text-slate-800 block truncate group-hover:text-indigo-600 transition-colors">
                        {p.name}
                      </span>
                      <span className="text-xs font-medium text-slate-400 font-mono">SKU: {p.sku}</span>
                    </div>
                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      <div className="text-right">
                        <span className="text-sm font-black text-rose-600 block">{p.stock} Adet</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase">Min: {p.minStock}</span>
                      </div>
                      <button
                        onClick={() => handleLowStockNavigation(p.id)}
                        title="Bu ürünü envanterde incele"
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all cursor-pointer"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onQuickReplenish(p.id, 10)}
                        title="Hızlı 10 Adet Ekle"
                        className="text-slate-400 hover:text-indigo-600 active:scale-90 transition-all p-1 cursor-pointer"
                      >
                        <PlusCircle className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Recent Sales */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-500">
                <TrendingUp className="w-4 h-4" />
              </div>
              <h2 className="font-bold text-slate-800 text-sm tracking-wide uppercase">Son Satışlar</h2>
            </div>
            <button
              onClick={() => onNavigateToTab("history")}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 group"
            >
              <span>Tümü</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          <div className="space-y-3 flex-1">
            {recentSales.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center h-full">
                <TrendingUp className="w-10 h-10 text-slate-300 mb-2" />
                <span className="text-sm font-semibold text-slate-700">Henüz Satış Kaydı Yok</span>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">
                  Hızlı satış sekmesinden ilk satışınızı kaydederek ciro oluşturmaya başlayın.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50 max-h-[300px] overflow-y-auto pr-1">
                {recentSales.map((sale) => {
                  const itemsCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
                  const firstItem = sale.items[0];
                  const firstItemName =
                    firstItem?.productName ||
                    (firstItem as any)?.name ||
                    products.find((p) => p.id === firstItem?.productId)?.name ||
                    "Ürün";
                  const displayDetails =
                    sale.items.length > 1 ? `${firstItemName} ve ${sale.items.length - 1} diğer ürün` : firstItemName;

                  return (
                    <div key={sale.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between">
                      <div className="min-w-0 pr-4">
                        <span className="text-sm font-bold text-slate-800 block truncate">{displayDetails}</span>
                        <span className="text-[11px] font-medium text-slate-400 block">{formatTime(sale.timestamp)}</span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <span className="text-sm font-black text-emerald-600 block">
                          +{formatCurrency(sale.totalAmount)}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                          {itemsCount} adet
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

