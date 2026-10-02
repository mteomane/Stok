import { useState, useMemo } from "react";
import { Sale, Product } from "../types";
import {
  Receipt,
  Calendar,
  User,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Printer,
  FileText,
  Search,
  Filter,
  TrendingUp,
  ShoppingBag,
  RefreshCw,
  Clock
} from "lucide-react";
import { ReceiptPrintModal } from "./ReceiptPrintModal";
import { SalesReportModal } from "./SalesReportModal";

interface HistoryProps {
  sales: Sale[];
  products?: Product[];
}

type DatePreset = "all" | "today" | "yesterday" | "7days" | "this_month" | "last_month" | "custom";

export function History({ sales, products }: HistoryProps) {
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [selectedReceiptSale, setSelectedReceiptSale] = useState<Sale | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  // Filters state
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Handle Preset Changes
  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    const now = new Date();

    if (preset === "all") {
      setStartDate("");
      setEndDate("");
      return;
    }

    if (preset === "today") {
      const todayStr = now.toISOString().split("T")[0];
      setStartDate(todayStr);
      setEndDate(todayStr);
      return;
    }

    if (preset === "yesterday") {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const yestStr = yesterday.toISOString().split("T")[0];
      setStartDate(yestStr);
      setEndDate(yestStr);
      return;
    }

    if (preset === "7days") {
      const past7 = new Date(now);
      past7.setDate(now.getDate() - 6);
      setStartDate(past7.toISOString().split("T")[0]);
      setEndDate(now.toISOString().split("T")[0]);
      return;
    }

    if (preset === "this_month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(firstDay.toISOString().split("T")[0]);
      setEndDate(now.toISOString().split("T")[0]);
      return;
    }

    if (preset === "last_month") {
      const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      setStartDate(firstDayLastMonth.toISOString().split("T")[0]);
      setEndDate(lastDayLastMonth.toISOString().split("T")[0]);
      return;
    }
  };

  // Filter Sales based on date and search
  const filteredSales = useMemo(() => {
    return sales
      .filter((sale) => {
        // Date Filtering
        if (startDate || endDate) {
          const saleTime = new Date(sale.timestamp).getTime();

          if (startDate) {
            const startTimestamp = new Date(`${startDate}T00:00:00`).getTime();
            if (saleTime < startTimestamp) return false;
          }

          if (endDate) {
            const endTimestamp = new Date(`${endDate}T23:59:59.999`).getTime();
            if (saleTime > endTimestamp) return false;
          }
        }

        // Search Query Filtering
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchId = sale.id.toLowerCase().includes(q);
          const matchCustomer = sale.customerName?.toLowerCase().includes(q);
          const matchProducts = sale.items.some((it) => {
            const name =
              it.productName ||
              (it as any).name ||
              products?.find((p) => p.id === it.productId)?.name ||
              "";
            return name.toLowerCase().includes(q) || String(it.productId).includes(q);
          });

          return matchId || matchCustomer || matchProducts;
        }

        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [sales, products, startDate, endDate, searchQuery]);

  // KPI Calculations
  const totalFilteredRevenue = useMemo(
    () => filteredSales.reduce((sum, s) => sum + s.totalAmount, 0),
    [filteredSales]
  );

  const totalFilteredItemsCount = useMemo(
    () => filteredSales.reduce((sum, s) => sum + s.items.reduce((iSum, i) => iSum + i.quantity, 0), 0),
    [filteredSales]
  );

  const toggleExpand = (id: string) => {
    setExpandedSaleId(expandedSaleId === id ? null : id);
  };

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

  const getDatePresetLabel = () => {
    switch (datePreset) {
      case "today":
        return "Bugünün Satışları";
      case "yesterday":
        return "Dünün Satışları";
      case "7days":
        return "Son 7 Günlük Satışlar";
      case "this_month":
        return "Bu Ayın Satışları";
      case "last_month":
        return "Geçen Ayın Satışları";
      case "custom":
        return "Özel Tarih Aralığı Satışları";
      case "all":
      default:
        return "Tüm Zamanların Satış Geçmişi";
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Top Header Card */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-indigo-600" />
            <span>Geçmiş Satış Kayıtları & Raporlama</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Tarih aralığına göre satışlarınızı listeleyin, analiz edin ve A4/PDF formatında rapor indirin.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsReportModalOpen(true)}
          disabled={filteredSales.length === 0}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-100 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 flex-shrink-0"
        >
          <Printer className="w-4 h-4" />
          <span>Tarih Aralıklı PDF Rapor Al</span>
        </button>
      </div>

      {/* KPI Stats Grid for Filtered Result */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">
              Seçili Dönem Toplam Ciro
            </span>
            <span className="text-xl font-extrabold text-emerald-600 block mt-1">
              {formatCurrency(totalFilteredRevenue)}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black">
            ₺
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">
              Toplam Fiş / İşlem
            </span>
            <span className="text-xl font-extrabold text-indigo-600 block mt-1">
              {filteredSales.length} Adet
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Receipt className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">
              Satılan Ürün Miktarı
            </span>
            <span className="text-xl font-extrabold text-slate-800 block mt-1">
              {totalFilteredItemsCount} Parça
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
            <ShoppingBag className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Date Range & Search Filter Panel */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-indigo-500" />
            <span>Tarih Filtresi & Hızlı Seçim</span>
          </span>

          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: "all", label: "Tüm Zamanlar" },
              { id: "today", label: "Bugün" },
              { id: "yesterday", label: "Dün" },
              { id: "7days", label: "Son 7 Gün" },
              { id: "this_month", label: "Bu Ay" },
              { id: "last_month", label: "Geçen Ay" },
            ].map((p) => {
              const isActive = datePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePresetChange(p.id as DatePreset)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    isActive
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-600"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom Date Pickers & Search Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
          <div className="sm:col-span-3 flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <div className="w-full">
              <label className="text-[9px] font-bold uppercase text-slate-400 block">Başlangıç Tarihi</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDatePreset("custom");
                }}
                className="w-full text-xs font-bold text-slate-800 bg-transparent focus:outline-none"
              />
            </div>
          </div>

          <div className="sm:col-span-3 flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <Calendar className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <div className="w-full">
              <label className="text-[9px] font-bold uppercase text-slate-400 block">Bitiş Tarihi</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDatePreset("custom");
                }}
                className="w-full text-xs font-bold text-slate-800 bg-transparent focus:outline-none"
              />
            </div>
          </div>

          <div className="sm:col-span-6 flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input
              type="text"
              placeholder="Fiş No, Müşteri Adı veya Ürün Ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs text-slate-800 bg-transparent focus:outline-none placeholder:text-slate-400 font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-xs text-slate-400 hover:text-slate-600 font-bold"
              >
                Temizle
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sales Transactions List */}
      {filteredSales.length === 0 ? (
        <div className="bg-white p-12 text-center border border-slate-200 rounded-2xl shadow-sm">
          <Receipt className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <span className="text-sm font-bold text-slate-700 block">Aranan Kriterlere Uygun Kayıt Bulunamadı</span>
          <p className="text-xs text-slate-400 mt-1">Lütfen tarih aralığını veya arama kelimenizi değiştirin.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-between items-center px-1">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {getDatePresetLabel()} ({filteredSales.length} Kayıt)
            </span>
          </div>

          {filteredSales.map((sale) => {
            const isExpanded = expandedSaleId === sale.id;
            const itemsCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);

            return (
              <div
                key={sale.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:border-slate-300"
              >
                {/* Sale Row Header */}
                <div
                  onClick={() => toggleExpand(sale.id)}
                  className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 cursor-pointer select-none bg-slate-50/30 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0 font-bold">
                      <Receipt className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-800 truncate font-mono">
                          FİŞ: #{sale.id}
                        </span>
                        {sale.customerName && (
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5">
                            {sale.customerName}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 flex items-center gap-1 mt-0.5 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatDate(sale.timestamp)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 w-full sm:w-auto">
                    <div className="text-left sm:text-right">
                      <span className="text-sm font-bold text-emerald-600 block">
                        {formatCurrency(sale.totalAmount)}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">
                        {itemsCount} adet ürün
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedReceiptSale(sale);
                      }}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer shadow-sm"
                      title="Satış Fişi / Makbuzu Yazdır"
                    >
                      <Printer className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Fiş Yazdır</span>
                    </button>

                    <div className="text-slate-400">
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </div>
                </div>

                {/* Sale Items Detail Expansion */}
                {isExpanded && (
                  <div className="border-t border-slate-200 bg-white p-4 animate-fade-in">
                    <div className="flex justify-between items-center mb-2.5">
                      <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                        Satılan Ürünler Listesi
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedReceiptSale(sale)}
                        className="text-xs font-bold text-emerald-600 hover:text-emerald-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Fiş Detayını Gör & Yazdır (PDF)
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider bg-slate-50/50">
                            <th className="py-2 px-3 rounded-l-lg">Ürün Detayı</th>
                            <th className="py-2 px-3 text-right">Miktar</th>
                            <th className="py-2 px-3 text-right">Birim Fiyat</th>
                            <th className="py-2 px-3 text-right rounded-r-lg">Toplam Tutar</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {sale.items.map((item, idx) => {
                            const pName =
                              item.productName ||
                              (item as any).name ||
                              products?.find((p) => p.id === item.productId)?.name ||
                              `Ürün (#${item.productId})`;

                            const rollInfo = (item as any).selectedRollNumber
                              ? `(${ (item as any).selectedRollNumber })`
                              : "";

                            return (
                              <tr key={idx} className="hover:bg-slate-50/50">
                                <td className="py-3 px-3">
                                  <span className="font-bold text-slate-800 block">{pName}</span>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                                    <span>ID: {item.productId}</span>
                                    {rollInfo && <span className="text-indigo-600 font-semibold">{rollInfo}</span>}
                                  </div>
                                </td>
                                <td className="py-3 px-3 text-right font-bold text-slate-700">
                                  {item.quantity} Adet
                                </td>
                                <td className="py-3 px-3 text-right font-medium text-slate-500">
                                  {formatCurrency(item.price)}
                                </td>
                                <td className="py-3 px-3 text-right font-bold text-slate-800">
                                  {formatCurrency(item.price * item.quantity)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Individual Receipt Modal */}
      {selectedReceiptSale && (
        <ReceiptPrintModal
          sale={selectedReceiptSale}
          products={products}
          onClose={() => setSelectedReceiptSale(null)}
        />
      )}

      {/* Full Date Range Sales Report Modal */}
      {isReportModalOpen && (
        <SalesReportModal
          sales={filteredSales}
          products={products}
          startDate={startDate}
          endDate={endDate}
          datePresetName={getDatePresetLabel()}
          onClose={() => setIsReportModalOpen(false)}
        />
      )}
    </div>
  );
}
