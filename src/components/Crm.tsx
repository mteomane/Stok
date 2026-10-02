import React, { useState, useEffect } from "react";
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
  X
} from "lucide-react";
import { Customer } from "../types";
import { auth } from "../lib/firebase";
import { getCustomers, addCustomer, updateCustomer, deleteCustomer } from "../lib/firestoreService";

interface CrmProps {
  onRefreshData?: () => void;
}

export function Crm({ onRefreshData }: CrmProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

  const [paymentForm, setPaymentForm] = useState({
    type: "payment" as "payment" | "sale",
    amount: "",
    description: ""
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
    fetchCustomers();
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
      description: initialType === "payment" ? "Tahsilat Alındı" : "Veresiye / Borç Kaydı"
    });
    setIsPaymentModalOpen(true);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !paymentForm.amount) return;

    try {
      const val = Number(paymentForm.amount);
      if (isNaN(val) || val <= 0) {
        throw new Error("Geçersiz işlem miktarı.");
      }

      const transId = "T" + Math.random().toString(36).substring(2, 8).toUpperCase();
      const newTransaction = {
        id: transId,
        type: paymentForm.type,
        amount: val,
        description: paymentForm.description.trim() || (paymentForm.type === "payment" ? "Tahsilat Ödemesi" : "Borç Kaydı"),
        timestamp: new Date().toISOString()
      };

      const updatedTransactions = [newTransaction, ...(selectedCustomer.transactions || [])];
      let newDebt = selectedCustomer.totalDebt || 0;
      let newPaid = selectedCustomer.totalPaid || 0;

      if (paymentForm.type === "payment") {
        newDebt = Math.max(0, newDebt - val);
        newPaid += val;
      } else {
        newDebt += val;
      }

      await updateCustomer(selectedCustomer.id, {
        totalDebt: newDebt,
        totalPaid: newPaid,
        transactions: updatedTransactions
      });

      await fetchCustomers();
      setSuccess("Ödeme / işlem kaydı başarıyla eklendi.");
      setIsPaymentModalOpen(false);
      setSelectedCustomer(null);
      setPaymentForm({ type: "payment", amount: "", description: "" });
      if (onRefreshData) onRefreshData();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "İşlem kaydedilirken hata oluştu.");
      setTimeout(() => setError(""), 4000);
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.phone && c.phone.includes(searchQuery)) ||
    (c.instagram && c.instagram.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalReceivables = customers.reduce((sum, c) => sum + c.totalDebt, 0);
  const totalPaid = customers.reduce((sum, c) => sum + c.totalPaid, 0);
  const debtorCount = customers.filter(c => c.totalDebt > 0).length;

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
        <button
          onClick={() => {
            setCustomerForm({ name: "", phone: "", instagram: "", notes: "" });
            setIsAddModalOpen(true);
          }}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-lg flex items-center gap-2 transition-all shadow-sm active:scale-95"
        >
          <Plus className="w-4 h-4" />
          Müşteri Ekle
        </button>
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
            {filteredCustomers.map((customer) => {
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
              <button onClick={() => setIsPaymentModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
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
                <label className="text-xs font-bold text-slate-500 block mb-1">Miktar (TL) *</label>
                <input
                  type="number"
                  required
                  min="0.01"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">İşlem Açıklaması</label>
                <input
                  type="text"
                  value={paymentForm.description}
                  onChange={(e) => setPaymentForm({ ...paymentForm, description: e.target.value })}
                  placeholder={paymentForm.type === "payment" ? "Tahsilat Alındı" : "Veresiye / Borç Kaydı"}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-sm rounded-lg transition-colors"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className={`flex-1 py-2.5 text-white font-semibold text-sm rounded-lg transition-colors shadow-sm ${
                    paymentForm.type === "payment"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-rose-500 hover:bg-rose-600"
                  }`}
                >
                  {paymentForm.type === "payment" ? "Ödeme Al ve Kaydet" : "Borçlandır ve Kaydet"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
