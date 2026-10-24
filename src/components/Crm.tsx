import React, { useState, useEffect, useMemo } from "react";
import { 
  Users, 
  Phone, 
  Instagram, 
  Search, 
  Plus, 
  Trash2, 
  Edit3, 
  DollarSign, 
  MessageSquare, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  Send,
  UserCheck,
  TrendingDown,
  X,
  Download
} from "lucide-react";
import { Customer } from "../types";
import { auth } from "../lib/firebase";
import { getCustomers, addCustomer, updateCustomer, deleteCustomer, processCustomerPayment, subscribeCustomers } from "../lib/firestoreService";
import { exportService } from "../lib/export/ExportService";
import { triggerFileDownload } from "../lib/export/fileDownload";

interface CrmProps {
  onRefreshData?: () => void;
}

export function Crm({ onRefreshData }: CrmProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset pagination on search / page size change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, pageSize]);

  // Modals / forms state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Forms fields
  const [customerForm, setCustomerForm] = useState({
    name: "",
    phone: "",
    instagram: "",
    notes: ""
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState<string | null>(null);

  const [paymentForm, setPaymentForm] = useState({
    type: "payment" as "payment" | "sale",
    amount: "",
    description: "",
    paymentMethod: "nakit" as "nakit" | "kredi_karti" | "havale" | "cek" | "diger"
  });

  const fetchCustomers = async () => {
    try {
      setIsLoading(true);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Oturum açık değil.");
      const data = await getCustomers(uid);
      setCustomers(data);
    } catch (err: any) {
      setError(err.message || "Müşteri listesi alınırken bir hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || uid === "demo-user") {
      fetchCustomers();
      return;
    }

    setIsLoading(true);
    const unsubscribe = subscribeCustomers(
      uid,
      (realtimeCustomers) => {
        setCustomers(realtimeCustomers);
        setIsLoading(false);
      },
      (err) => {
        console.warn("Realtime customer sync notice:", err);
        fetchCustomers();
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForm.name) return;

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Oturum açık değil.");
      
      await addCustomer(uid, {
        name: customerForm.name.trim(),
        phone: customerForm.phone.trim(),
        instagram: customerForm.instagram.trim(),
        notes: customerForm.notes.trim(),
        totalDebt: 0,
        totalPaid: 0,
        transactions: []
      });

      await fetchCustomers();
      setSuccess("Müşteri başarıyla eklendi.");
      setIsAddModalOpen(false);
      setCustomerForm({ name: "", phone: "", instagram: "", notes: "" });
      if (onRefreshData) onRefreshData();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Ekleme sırasında hata oluştu.");
      setTimeout(() => setError(""), 4000);
    }
  };

  const handleEditClick = (c: Customer) => {
    setSelectedCustomer(c);
    setCustomerForm({
      name: c.name,
      phone: c.phone || "",
      instagram: c.instagram || "",
      notes: c.notes || ""
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;

    try {
      await updateCustomer(selectedCustomer.id, {
        name: customerForm.name.trim(),
        phone: customerForm.phone.trim(),
        instagram: customerForm.instagram.trim(),
        notes: customerForm.notes.trim()
      });

      await fetchCustomers();
      setSuccess("Müşteri başarıyla güncellendi.");
      setIsEditModalOpen(false);
      setSelectedCustomer(null);
      setCustomerForm({ name: "", phone: "", instagram: "", notes: "" });
      if (onRefreshData) onRefreshData();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Güncelleme sırasında hata oluştu.");
      setTimeout(() => setError(""), 4000);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Bu müşteriyi silmek istediğinizden emin misiniz?")) return;

    try {
      await deleteCustomer(id);
      await fetchCustomers();
      setSuccess("Müşteri silindi.");
      if (onRefreshData) onRefreshData();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Müşteri silinirken hata oluştu.");
      setTimeout(() => setError(""), 4000);
    }
  };

  const handlePaymentClick = (c: Customer, initialType: "payment" | "sale" = "payment") => {
    setSelectedCustomer(c);
    setPaymentForm({
      type: initialType,
      amount: "",
      description: initialType === "payment" ? "Tahsilat Alındı" : "Veresiye / Borç Kaydı",
      paymentMethod: "nakit"
    });
    // Generate fresh idempotency key per modal session to prevent duplicate network submissions
    const newKey = "crm_pay_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 9);
    setPaymentIdempotencyKey(newKey);
    setIsPaymentModalOpen(true);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selectedCustomer || !paymentForm.amount) return;

    const uid = auth.currentUser?.uid;
    if (!uid) {
      setError("Oturum açık değil.");
      setTimeout(() => setError(""), 4000);
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");

      const val = Number(paymentForm.amount);
      if (isNaN(val) || val <= 0) {
        throw new Error("Geçersiz işlem miktarı.");
      }

      if (paymentForm.type === "payment") {
        const debt = Number(selectedCustomer.totalDebt || 0);
        if (debt <= 0) {
          throw new Error("Müşterinin ödenmemiş borcu bulunmamaktadır.");
        }
        if (val > debt) {
          throw new Error(`Tahsilat tutarı (${val.toFixed(2)} TL) mevcut borçtan (${debt.toFixed(2)} TL) fazla olamaz.`);
        }
      }

      const activeKey = paymentIdempotencyKey || ("crm_pay_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 9));

      const result = await processCustomerPayment(uid, {
        customerId: selectedCustomer.id,
        amount: val,
        type: paymentForm.type,
        description: paymentForm.description.trim() || (paymentForm.type === "payment" ? "Tahsilat Ödemesi" : "Borç Kaydı"),
        paymentMethod: paymentForm.paymentMethod,
        idempotencyKey: activeKey
      });

      if (result.isDuplicate) {
        setSuccess("Bu işlem daha önce kaydedilmişti (Mükerrer istek koruması devrede).");
      } else {
        setSuccess(paymentForm.type === "payment" ? "Tahsilat ödemesi başarıyla kaydedildi." : "Borç kaydı başarıyla eklendi.");
      }

      setIsPaymentModalOpen(false);
      setSelectedCustomer(null);
      setPaymentForm({ type: "payment", amount: "", description: "", paymentMethod: "nakit" });
      setPaymentIdempotencyKey(null);
      await fetchCustomers();
      if (onRefreshData) onRefreshData();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "İşlem kaydedilirken hata oluştu.");
      setTimeout(() => setError(""), 4000);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    if (!q) return customers;
    return customers.filter(c => 
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.instagram && c.instagram.toLowerCase().includes(q))
    );
  }, [customers, debouncedSearch]);

  const { totalReceivables, totalPaid, debtorCount } = useMemo(() => {
    const totalReceivables = customers.reduce((sum, c) => sum + c.totalDebt, 0);
    const totalPaid = customers.reduce((sum, c) => sum + c.totalPaid, 0);
    const debtorCount = customers.filter(c => c.totalDebt > 0).length;
    return { totalReceivables, totalPaid, debtorCount };
  }, [customers]);

  const totalPages = Math.ceil(filteredCustomers.length / pageSize) || 1;
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCustomers.slice(start, start + pageSize);
  }, [filteredCustomers, currentPage, pageSize]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(val);
  };

  return (
    <div className="space-y-6 animate-fade-in" id="crm-tab-root">
      {/* 1. Header & Summary Stats */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-500" />
            CRM & Veresiye Müşteri Yönetimi
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">Müşteri hesap bakiyeleri, veresiye borç takipleri ve doğrudan Whatsapp/Instagram iletişimi.</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            disabled={isExporting}
            onClick={async () => {
              try {
                setIsExporting(true);
                const uid = auth.currentUser?.uid || "demo-user";
                const result = await exportService.exportCustomers(uid, "csv");
                triggerFileDownload(result.content, result.fileName, result.mimeType);
              } catch (err: any) {
                alert(err.message || "Dışa aktarma sırasında hata oluştu.");
              } finally {
                setIsExporting(false);
              }
            }}
            className="flex-1 sm:flex-none px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 active:scale-95"
            title="Müşteri ve veresiye bakiyelerini Excel uyumlu CSV olarak indir"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>{isExporting ? "İndiriliyor..." : "Excel/CSV İndir"}</span>
          </button>

          <button
            onClick={() => {
              setCustomerForm({ name: "", phone: "", instagram: "", notes: "" });
              setIsAddModalOpen(true);
            }}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm rounded-lg flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Müşteri Ekle
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-lg flex items-center justify-center">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Toplam Alacak (Borçlar)</span>
            <span className="text-xl font-bold text-rose-600">{formatCurrency(totalReceivables)}</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">{debtorCount} aktif borçlu müşteri</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
            <UserCheck className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Toplam Tahsilat (Ödenen)</span>
            <span className="text-xl font-bold text-emerald-600">{formatCurrency(totalPaid)}</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Sistemdeki tüm zamanlar tahsilatı</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Kayıtlı Müşteri Sayısı</span>
            <span className="text-xl font-bold text-slate-800">{customers.length} Müşteri</span>
            <span className="text-[10px] text-slate-400 block mt-0.5">Aktif veritabanı kaydı</span>
          </div>
        </div>
      </div>

      {/* Success/Error Alerts */}
      {success && (
        <div className="bg-emerald-50 text-emerald-600 text-xs p-3.5 rounded-lg border border-emerald-200 flex items-center gap-2 animate-pulse">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="bg-rose-50 text-rose-600 text-xs p-3.5 rounded-lg border border-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Customer Table & Filter Panel */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Search Header */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-center gap-4 justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="İsim, telefon veya Instagram ara..."
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <span className="text-[10px] text-slate-400 font-semibold">
            {filteredCustomers.length} müşteri listeleniyor
          </span>
        </div>

        {/* Loading state */}
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-2">
            <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-slate-400">Müşteriler Yükleniyor...</span>
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Users className="w-12 h-12 mx-auto text-slate-200 mb-2" />
            <span className="font-bold text-slate-700 block text-sm">Müşteri Bulunamadı</span>
            <p className="text-xs text-slate-400 mt-0.5">Arama kriterlerinize uyan kayıt bulunamadı veya henüz müşteri eklemediniz.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 overflow-x-auto">
            {paginatedCustomers.map((customer) => {
              const hasDebt = customer.totalDebt > 0;
              const waText = `Merhaba ${customer.name}, Güncel hesap bakiye durumunuza göre ${formatCurrency(customer.totalDebt)} borç bakiyeniz bulunmaktadır. Ödemeyi gerçekleştirebilirseniz seviniriz. İyi çalışmalar dileriz.`;
              const waLink = customer.phone 
                ? `https://wa.me/${customer.phone.replace(/[^0-9+]/g, "")}?text=${encodeURIComponent(waText)}` 
                : null;
              const igLink = customer.instagram 
                ? `https://instagram.com/${customer.instagram.replace("@", "")}` 
                : null;

              return (
                <div key={customer.id} className="p-5 hover:bg-slate-50/50 transition-colors flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  {/* Left Column: Name & Contact Details */}
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800 text-sm">{customer.name}</span>
                      <span className={`px-2 py-0.5 text-[9px] font-bold rounded-full ${
                        hasDebt 
                          ? "bg-rose-50 text-rose-600 border border-rose-100" 
                          : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                      }`}>
                        {hasDebt ? `Borçlu: ${formatCurrency(customer.totalDebt)}` : "Borcu Yok"}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                      {customer.phone && (
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3 text-slate-300" />
                          {customer.phone}
                        </span>
                      )}
                      {customer.instagram && (
                        <span className="flex items-center gap-1">
                          <Instagram className="w-3 h-3 text-slate-300" />
                          {customer.instagram.startsWith("@") ? customer.instagram : `@${customer.instagram}`}
                        </span>
                      )}
                      {customer.notes && (
                        <span className="text-slate-400 italic block">
                          — {customer.notes}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle Column: Balances info */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-left md:text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block tracking-wide">Ödenen (Tahsilat)</span>
                      <span className="text-xs font-bold text-emerald-600">{formatCurrency(customer.totalPaid)}</span>
                    </div>
                    <div className="h-6 w-px bg-slate-200" />
                    <div className="text-left md:text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block tracking-wide">Toplam Borç</span>
                      <span className={`text-xs font-bold ${hasDebt ? "text-rose-600" : "text-slate-400"}`}>
                        {formatCurrency(customer.totalDebt)}
                      </span>
                    </div>
                  </div>

                  {/* Right Column: Communication & Actions */}
                  <div className="flex items-center gap-2 flex-wrap flex-shrink-0 w-full md:w-auto justify-end">
                    {/* Communication */}
                    {waLink ? (
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                        title="Whatsapp Mesajı Gönder"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span className="md:hidden lg:inline">WhatsApp</span>
                      </a>
                    ) : (
                      <span className="p-2 bg-slate-100 text-slate-300 rounded-lg text-xs cursor-not-allowed flex items-center gap-1.5">
                        <MessageSquare className="w-4 h-4" />
                        <span className="md:hidden lg:inline">WhatsApp Yok</span>
                      </span>
                    )}

                    {igLink && (
                      <a
                        href={igLink}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 bg-pink-50 text-pink-600 hover:bg-pink-100 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                        title="Instagram Profilini Gör"
                      >
                        <Instagram className="w-4 h-4" />
                        <span className="md:hidden lg:inline">Instagram</span>
                      </a>
                    )}

                    {/* Bookkeep Actions */}
                    <button
                      onClick={() => handlePaymentClick(customer, "payment")}
                      className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-bold flex items-center gap-1"
                      title="Tahsilat Al / Ödeme Ekle"
                    >
                      <DollarSign className="w-3.5 h-3.5" />
                      Tahsilat Al
                    </button>

                    <button
                      onClick={() => handlePaymentClick(customer, "sale")}
                      className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold flex items-center gap-1"
                      title="Borçlandır / Veresiye Yaz"
                    >
                      <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                      Borçlandır
                    </button>

                    {/* Meta Actions */}
                    <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
                      <button
                        onClick={() => handleEditClick(customer)}
                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded"
                        title="Düzenle"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(customer.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                        title="Sil"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Customer Transaction Ledger/History (Embedded List) */}
                  {customer.transactions && customer.transactions.length > 0 && (
                    <div className="w-full mt-4 bg-slate-50/50 p-4 rounded-lg border border-slate-100 text-left">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Müşteri Hesap Hareketleri</span>
                      <div className="max-h-40 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                        {customer.transactions.map((t) => (
                          <div key={t.id} className="flex justify-between items-center text-xs p-2 bg-white rounded border border-slate-100">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.type === "payment" ? "bg-emerald-500" : "bg-rose-500"}`} />
                              <span className="text-slate-600 truncate">{t.description}</span>
                              <span className="text-[9px] text-slate-300 font-mono flex-shrink-0">
                                {new Date(t.timestamp).toLocaleDateString("tr-TR")}
                              </span>
                            </div>
                            <span className={`font-mono font-bold ${t.type === "payment" ? "text-emerald-600" : "text-rose-500"}`}>
                              {t.type === "payment" ? "+" : "-"}{formatCurrency(t.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {filteredCustomers.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 border-t border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Sayfa Başına:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none"
              >
                <option value={10}>10 Müşteri</option>
                <option value={20}>20 Müşteri</option>
                <option value={50}>50 Müşteri</option>
              </select>
              <span className="ml-2">
                Toplam <strong>{filteredCustomers.length}</strong> müşteriden <strong>{Math.min(filteredCustomers.length, (currentPage - 1) * pageSize + 1)}-{Math.min(filteredCustomers.length, currentPage * pageSize)}</strong> arası
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
              >
                Önceki
              </button>
              <span className="text-xs font-bold text-slate-700 px-2">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs"
              >
                Sonraki
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Add Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-xl p-6 shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
              <h3 className="font-bold text-slate-800 text-base">Yeni Müşteri Ekle</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Müşteri / Firma Adı *</label>
                <input
                  type="text"
                  required
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  placeholder="Örn: Ahmet Yılmaz veya ABC Ltd. Şti."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Telefon Numarası (WhatsApp için)</label>
                <input
                  type="text"
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  placeholder="Örn: +905321234567"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">Lütfen ülke koduyla birlikte girin (Örn: +905321234567).</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Instagram Kullanıcı Adı (Opsiyonel)</label>
                <input
                  type="text"
                  value={customerForm.instagram}
                  onChange={(e) => setCustomerForm({ ...customerForm, instagram: e.target.value })}
                  placeholder="Örn: butik_kumas"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Özel Notlar</label>
                <textarea
                  value={customerForm.notes}
                  onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
                  placeholder="Müşteriye dair hatırlatıcı özel detaylar..."
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-sm rounded-lg transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-lg transition-colors shadow-sm"
                >
                  Müşteriyi Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Edit Customer Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-xl p-6 shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
              <h3 className="font-bold text-slate-800 text-base">Müşteri Bilgilerini Düzenle</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Müşteri / Firma Adı *</label>
                <input
                  type="text"
                  required
                  value={customerForm.name}
                  onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                  placeholder="Müşteri adı"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Telefon Numarası</label>
                <input
                  type="text"
                  value={customerForm.phone}
                  onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  placeholder="Telefon"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Instagram Kullanıcı Adı (Opsiyonel)</label>
                <input
                  type="text"
                  value={customerForm.instagram}
                  onChange={(e) => setCustomerForm({ ...customerForm, instagram: e.target.value })}
                  placeholder="Instagram"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Özel Notlar</label>
                <textarea
                  value={customerForm.notes}
                  onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
                  placeholder="Müşteri özel notları"
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-sm rounded-lg transition-colors"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-lg transition-colors shadow-sm"
                >
                  Değişiklikleri Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Add Transaction/Payment Ledger Modal */}
      {isPaymentModalOpen && selectedCustomer && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-xl p-6 shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3 mb-4">
              <h3 className="font-bold text-slate-800 text-sm sm:text-base">
                {paymentForm.type === "payment" ? "Tahsilat Ödemesi Gir" : "Manuel Borçlandır"}
              </h3>
              <button 
                onClick={() => !isSubmitting && setIsPaymentModalOpen(false)} 
                disabled={isSubmitting} 
                className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4 text-xs">
              <span className="font-semibold text-slate-500 block">Seçili Müşteri:</span>
              <span className="font-bold text-slate-800 block text-sm mt-0.5">{selectedCustomer.name}</span>
              <div className="flex justify-between items-center mt-1 pt-1.5 border-t border-slate-200/50 text-slate-400">
                <span>Mevcut Borç Bakiyesi:</span>
                <span className="font-bold text-rose-500">{formatCurrency(selectedCustomer.totalDebt)}</span>
              </div>
            </div>

            <form onSubmit={handlePaymentSubmit} className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-slate-500">Miktar (TL) *</label>
                  {paymentForm.type === "payment" && selectedCustomer.totalDebt > 0 && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setPaymentForm({ ...paymentForm, amount: selectedCustomer.totalDebt.toString() })}
                      className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold transition-colors disabled:opacity-50"
                    >
                      Tüm Borcu Kapat ({formatCurrency(selectedCustomer.totalDebt)})
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  required
                  min="0.01"
                  max={paymentForm.type === "payment" ? Math.max(0.01, selectedCustomer.totalDebt) : undefined}
                  step="0.01"
                  disabled={isSubmitting}
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                />
                {paymentForm.type === "payment" && Number(paymentForm.amount) > selectedCustomer.totalDebt && (
                  <p className="text-[11px] text-rose-500 font-medium mt-1">
                    Tahsilat tutarı mevcut borçtan ({formatCurrency(selectedCustomer.totalDebt)}) fazla olamaz.
                  </p>
                )}
              </div>

              {paymentForm.type === "payment" && (
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Ödeme Yöntemi</label>
                  <select
                    value={paymentForm.paymentMethod}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value as any })}
                    disabled={isSubmitting}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                  >
                    <option value="nakit">Nakit</option>
                    <option value="kredi_karti">Kredi Kartı</option>
                    <option value="havale">Havale / EFT</option>
                    <option value="cek">Çek</option>
                    <option value="diger">Diğer</option>
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">İşlem Açıklaması</label>
                <input
                  type="text"
                  disabled={isSubmitting}
                  value={paymentForm.description}
                  onChange={(e) => setPaymentForm({ ...paymentForm, description: e.target.value })}
                  placeholder={paymentForm.type === "payment" ? "Tahsilat Alındı" : "Veresiye / Borç Kaydı"}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-sm rounded-lg transition-colors disabled:opacity-60"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`flex-1 py-2.5 text-white font-semibold text-sm rounded-lg transition-colors shadow-sm flex items-center justify-center gap-2 ${
                    isSubmitting ? "opacity-60 cursor-not-allowed " : ""
                  }${
                    paymentForm.type === "payment"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-rose-500 hover:bg-rose-600"
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>İşleniyor...</span>
                    </>
                  ) : (
                    paymentForm.type === "payment" ? "Ödeme Al ve Kaydet" : "Borçlandır ve Kaydet"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
