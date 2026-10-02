import React, { useState, useEffect } from "react";
import { 
  FileText, 
  Plus, 
  Search, 
  Printer, 
  Edit3, 
  Trash2, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Truck, 
  FileCheck2, 
  Calendar, 
  Building, 
  User, 
  Coins, 
  Eye, 
  X,
  PlusCircle,
  Scissors
} from "lucide-react";
import { Order, Product, Customer, CompanyInfo, FabricRoll, OrderItem } from "../types";
import { auth } from "../lib/firebase";
import { 
  getOrders, 
  addOrder, 
  updateOrder, 
  deleteOrder, 
  getCustomers, 
  updateCustomer, 
  getCompanyInfo,
  updateProduct
} from "../lib/firestoreService";

interface OrdersWaybillsProps {
  products: Product[];
  onRefreshProducts: () => void;
}

export function OrdersWaybills({ products, onRefreshProducts }: OrdersWaybillsProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [company, setCompany] = useState<CompanyInfo>({
    name: "",
    address: "",
    phone: "",
    email: "",
    taxOffice: "",
    taxNumber: "",
    logo: ""
  });

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // New Order Form state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [rawCustomerDetails, setRawCustomerDetails] = useState({
    name: "",
    address: "",
    phone: "",
    taxOffice: "",
    taxNumber: ""
  });
  const [orderItems, setOrderItems] = useState<{
    productId: string;
    quantity: number;
    price: number;
    selectedRollId?: string;
    cutLength?: number;
  }[]>([]);
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [orderNotes, setOrderNotes] = useState("");
  const [waybillNo, setWaybillNo] = useState("");
  const [waybillDate, setWaybillDate] = useState("");
  const [shipDate, setShipDate] = useState("");

  // Edit Order Form state
  const [editStatus, setEditStatus] = useState<Order["status"]>("Sipariş Alındı");
  const [editWaybillNo, setEditWaybillNo] = useState("");
  const [editWaybillDate, setEditWaybillDate] = useState("");
  const [editShipDate, setEditShipDate] = useState("");
  const [editAmountPaid, setEditAmountPaid] = useState<number>(0);

  // Load essential data
  const loadData = async () => {
    try {
      setIsLoading(true);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Oturum açık değil.");
      const [ordersRes, customersRes, companyRes] = await Promise.all([
        getOrders(uid),
        getCustomers(uid),
        getCompanyInfo(uid)
      ]);
      setOrders(ordersRes);
      setCustomers(customersRes);
      setCompany(companyRes);
    } catch (err: any) {
      setError(err.message || "Veriler sunucudan yüklenirken bir hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Sync raw customer details when a CRM Customer is selected
  useEffect(() => {
    if (selectedCustomerId) {
      const c = customers.find(item => item.id === selectedCustomerId);
      if (c) {
        setRawCustomerDetails({
          name: c.name,
          address: c.address || "",
          phone: c.phone || "",
          taxOffice: c.taxOffice || "",
          taxNumber: c.taxNumber || ""
        });
      }
    } else {
      setRawCustomerDetails({
        name: "",
        address: "",
        phone: "",
        taxOffice: "",
        taxNumber: ""
      });
    }
  }, [selectedCustomerId, customers]);

  // Handle Adding item to the New Order Form
  const handleAddOrderItem = () => {
    setOrderItems([...orderItems, { productId: "", quantity: 1, price: 0 }]);
  };

  const handleRemoveOrderItem = (index: number) => {
    setOrderItems(orderItems.filter((_, idx) => idx !== index));
  };

  const handleOrderItemChange = (index: number, field: string, value: any) => {
    const updated = [...orderItems];
    updated[index] = { ...updated[index], [field]: value };

    // Auto-update price if product changes
    if (field === "productId") {
      const prod = products.find(p => p.id === value);
      if (prod) {
        updated[index].price = prod.price;
        // reset roll selections if product changes
        updated[index].selectedRollId = undefined;
        updated[index].cutLength = undefined;
      }
    }

    setOrderItems(updated);
  };

  // Create Order API Call
  const handleCreateOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (orderItems.length === 0) {
      alert("Lütfen siparişe en az bir ürün ekleyin.");
      return;
    }

    // Validate if any product is not selected
    if (orderItems.some(item => !item.productId)) {
      alert("Lütfen tüm ürün seçimlerini tamamlayın.");
      return;
    }

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Oturum açık değil.");

      const resolvedOrderItems: any[] = [];
      let calculatedTotal = 0;

      // 1. Check stock
      for (const item of orderItems) {
        const product = products.find(p => p.id === item.productId);
        if (!product) {
          throw new Error(`Ürün bulunamadı: ID ${item.productId}`);
        }

        const qty = Number(item.quantity);
        const rollId = item.selectedRollId;
        const cutLen = item.cutLength !== undefined ? Number(item.cutLength) : undefined;
        const qtyToDeduct = cutLen !== undefined ? cutLen : qty;

        if (rollId && product.rolls) {
          const roll = product.rolls.find(r => r.id === rollId);
          if (!roll) {
            throw new Error(`Kumaş topu bulunamadı: ID ${rollId}`);
          }
          if (roll.length < qtyToDeduct) {
            throw new Error(`Seçilen kumaş topunda (${roll.rollNumber}) yeterli miktar yok! Kalan: ${roll.length}m`);
          }
        } else {
          if (product.stock < qtyToDeduct) {
            throw new Error(`Yetersiz stok! ${product.name} için kalan: ${product.stock}m`);
          }
        }

        resolvedOrderItems.push({
          productId: product.id,
          productName: product.name,
          quantity: qty,
          price: Number(item.price || product.price),
          rollId: rollId,
          rollNumber: rollId && product.rolls ? product.rolls.find(r => r.id === rollId)?.rollNumber : undefined,
          cutLength: cutLen
        });
        calculatedTotal += Number(item.price || product.price) * qty;
      }

      // 2. Deduct stock
      for (const item of resolvedOrderItems) {
        const product = products.find(p => p.id === item.productId)!;
        const qtyToDeduct = item.cutLength !== undefined ? item.cutLength : item.quantity;

        let newStock = product.stock;
        let newRolls = product.rolls ? [...product.rolls] : undefined;

        if (item.rollId && newRolls) {
          newRolls = newRolls.map(r => {
            if (r.id === item.rollId) {
              const updatedLen = Math.max(0, r.length - qtyToDeduct);
              return {
                ...r,
                length: updatedLen,
                status: updatedLen <= 0 ? 'sold' as const : r.status
              };
            }
            return r;
          });
          newStock = newRolls.reduce((sum, r) => sum + r.length, 0);
        } else {
          newStock = Math.max(0, product.stock - qtyToDeduct);
          if (newRolls && newRolls.length > 0) {
            let remaining = qtyToDeduct;
            newRolls = newRolls.map(r => {
              if (r.status === 'available' && r.length > 0 && remaining > 0) {
                const dec = Math.min(r.length, remaining);
                remaining -= dec;
                const updatedLen = Math.max(0, r.length - dec);
                return {
                  ...r,
                  length: updatedLen,
                  status: updatedLen <= 0 ? 'sold' as const : r.status
                };
              }
              return r;
            });
            newStock = newRolls.reduce((sum, r) => sum + r.length, 0);
          }
        }

        // Update product in DB
        await updateProduct(product.id, {
          stock: newStock,
          rolls: newRolls
        });
      }

      // 3. Create the Order
      const orderNo = `SIP-${Math.floor(1000 + Math.random() * 9000)}`;
      const newOrderObj = {
        orderNo,
        customerId: selectedCustomerId || null,
        customerName: rawCustomerDetails.name,
        customerDetails: rawCustomerDetails,
        items: resolvedOrderItems,
        totalAmount: calculatedTotal,
        amountPaid: Number(amountPaid || 0),
        status: (waybillNo ? "Sevk Edildi" : "Sipariş Alındı") as Order["status"],
        orderDate: new Date().toISOString(),
        waybillNo: waybillNo || null,
        waybillDate: waybillDate || null,
        shipDate: shipDate || null,
        notes: orderNotes
      };

      const addedOrder = await addOrder(uid, newOrderObj);

      // 4. Customer Ledger Link
      if (selectedCustomerId) {
        const customer = customers.find(c => c.id === selectedCustomerId);
        if (customer) {
          const transactions = [...(customer.transactions || [])];
          let totalDebt = customer.totalDebt || 0;
          let totalPaid = customer.totalPaid || 0;

          transactions.unshift({
            id: "T_ORD_" + addedOrder.id,
            type: "sale",
            amount: calculatedTotal,
            description: `Sipariş Alımı (No: #${orderNo})`,
            timestamp: new Date().toISOString()
          });
          totalDebt += calculatedTotal;

          const paid = Number(amountPaid || 0);
          if (paid > 0) {
            transactions.unshift({
              id: "T_ORD_PAY_" + addedOrder.id,
              type: "payment",
              amount: paid,
              description: `Sipariş Ödemesi (No: #${orderNo})`,
              timestamp: new Date().toISOString()
            });
            totalDebt = Math.max(0, totalDebt - paid);
            totalPaid += paid;
          }

          await updateCustomer(selectedCustomerId, {
            totalDebt,
            totalPaid,
            transactions
          });
        }
      }

      setSuccess("Sipariş başarıyla oluşturuldu, stoklar düşürüldü!");
      setIsCreateModalOpen(false);
      
      // Reset form
      setSelectedCustomerId("");
      setOrderItems([]);
      setAmountPaid(0);
      setOrderNotes("");
      setWaybillNo("");
      setWaybillDate("");
      setShipDate("");

      await loadData();
      onRefreshProducts();
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: any) {
      alert(err.message || "İşlem sırasında hata oluştu.");
    }
  };

  // Edit Order Status & Waybill Info API Call
  const handleEditOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder) return;

    try {
      const updates: Partial<Order> = {
        status: editStatus,
        waybillNo: editWaybillNo || null,
        waybillDate: editWaybillDate || null,
        shipDate: editShipDate || null,
        amountPaid: Number(editAmountPaid)
      };

      const diff = Number(editAmountPaid) - (selectedOrder.amountPaid || 0);

      if (selectedOrder.customerId && diff !== 0) {
        const customer = customers.find(c => c.id === selectedOrder.customerId);
        if (customer) {
          const transactions = [...(customer.transactions || [])];
          let totalDebt = customer.totalDebt || 0;
          let totalPaid = customer.totalPaid || 0;

          totalDebt = Math.max(0, totalDebt - diff);
          totalPaid += diff;

          transactions.unshift({
            id: "T_ORD_PAY_UPD_" + Math.random().toString(36).substring(2, 6),
            type: "payment",
            amount: Math.abs(diff),
            description: diff > 0 ? `Sipariş Ek Ödemesi (No: #${selectedOrder.orderNo})` : `Sipariş Ödemesi Geri Alımı (No: #${selectedOrder.orderNo})`,
            timestamp: new Date().toISOString()
          });

          await updateCustomer(selectedOrder.customerId, {
            totalDebt,
            totalPaid,
            transactions
          });
        }
      }

      await updateOrder(selectedOrder.id, updates);

      setSuccess("Sipariş ve irsaliye durumu başarıyla güncellendi!");
      setIsEditModalOpen(false);
      await loadData();
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: any) {
      alert(err.message || "Güncelleme sırasında hata oluştu.");
    }
  };

  // Delete Order
  const handleDeleteOrder = async (id: string) => {
    if (!window.confirm("Bu sipariş kaydını silmek istediğinize emin misiniz? (Stoklar geri yüklenmeyecektir)")) return;
    try {
      await deleteOrder(id);
      setSuccess("Sipariş başarıyla silindi.");
      await loadData();
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Print function
  const triggerPrint = () => {
    window.print();
  };

  // Filter and search orders
  const filteredOrders = orders.filter(o => {
    const term = searchTerm.toLowerCase();
    const orderNoMatch = o.orderNo.toLowerCase().includes(term);
    const customerMatch = (o.customerDetails?.name || o.customerName || "").toLowerCase().includes(term);
    const itemsMatch = o.items.some(i => i.productName.toLowerCase().includes(term));
    const isSearchMatched = orderNoMatch || customerMatch || itemsMatch;

    if (statusFilter === "all") return isSearchMatched;
    if (statusFilter === "waybills") return isSearchMatched && !!o.waybillNo;
    return isSearchMatched && o.status === statusFilter;
  });

  // Helper colors for statuses
  const getStatusBadge = (status: Order["status"]) => {
    switch (status) {
      case "Sipariş Alındı":
        return <span className="px-2.5 py-1 bg-blue-50 text-blue-600 border border-blue-100 rounded-full text-[10px] font-bold flex items-center gap-1 w-fit"><Clock className="w-3 h-3" /> Sipariş Alındı</span>;
      case "Hazırlanıyor":
        return <span className="px-2.5 py-1 bg-amber-50 text-amber-600 border border-amber-100 rounded-full text-[10px] font-bold flex items-center gap-1 w-fit"><Scissors className="w-3 h-3" /> Hazırlanıyor</span>;
      case "Sevk Edildi":
        return <span className="px-2.5 py-1 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-full text-[10px] font-bold flex items-center gap-1 w-fit"><Truck className="w-3 h-3" /> Sevk Edildi (İrsaliyeli)</span>;
      case "Teslim Edildi":
        return <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full text-[10px] font-bold flex items-center gap-1 w-fit"><CheckCircle className="w-3 h-3" /> Teslim Edildi</span>;
      case "İptal Edildi":
        return <span className="px-2.5 py-1 bg-slate-100 text-slate-500 border border-slate-200 rounded-full text-[10px] font-bold flex items-center gap-1 w-fit"><AlertCircle className="w-3 h-3" /> İptal Edildi</span>;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" id="orders-waybills-tab-root">
      {/* 1. Header Area */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-500" />
            Siparişler & Sevk İrsaliyeleri
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Sipariş süreçlerinizi yönetin, tek tıkla resmi tasarımlı Sevk İrsaliyesi yazdırın ve kumaş toplarını rulo bazında takip edin.
          </p>
        </div>
        <button
          onClick={() => {
            setIsCreateModalOpen(true);
            setOrderItems([{ productId: "", quantity: 1, price: 0 }]);
          }}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-100 transition-all active:scale-95 flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          Yeni Sipariş / İrsaliye Ekle
        </button>
      </div>

      {/* 2. Feedback Alerts */}
      {success && (
        <div className="bg-emerald-50 text-emerald-600 text-xs p-4 rounded-xl border border-emerald-200 flex items-center gap-2 animate-pulse">
          <CheckCircle className="w-4.5 h-4.5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="bg-rose-50 text-rose-600 text-xs p-4 rounded-xl border border-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4.5 h-4.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 3. Filter & Search Controls */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3">
        {/* Search input */}
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Sipariş no, müşteri unvanı veya kumaş adı ile ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none focus:bg-white"
          />
        </div>

        {/* Status filters */}
        <div className="flex flex-wrap gap-1">
          {[
            { id: "all", label: "Tümü" },
            { id: "Sipariş Alındı", label: "Sipariş Alındı" },
            { id: "Hazırlanıyor", label: "Hazırlanıyor" },
            { id: "Sevk Edildi", label: "Sevk Edilenler" },
            { id: "waybills", label: "İrsaliyesi Olanlar" },
            { id: "Teslim Edildi", label: "Teslim Edildi" }
          ].map((btn) => (
            <button
              key={btn.id}
              onClick={() => setStatusFilter(btn.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                statusFilter === btn.id
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4. Main Orders List Table */}
      {isLoading ? (
        <div className="py-12 flex flex-col items-center justify-center space-y-2 bg-white rounded-xl border border-slate-200">
          <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Siparişler yükleniyor...</span>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="p-12 bg-white rounded-xl border border-dashed border-slate-300 text-center text-slate-400 space-y-2">
          <FileText className="w-10 h-10 mx-auto text-slate-300" />
          <h4 className="font-bold text-slate-700 text-xs uppercase tracking-wide">Kayıt Bulunamadı</h4>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Arama kriterlerinize uygun hiçbir sipariş veya irsaliye bulunamadı. Yeni bir sipariş kaydı eklemeyi deneyin.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 text-[10px] font-black uppercase tracking-wider">
                  <th className="p-4">Sipariş / İrsaliye No</th>
                  <th className="p-4">Müşteri (Alıcı Unvanı)</th>
                  <th className="p-4">Tarih</th>
                  <th className="p-4">Ürünler / Detaylar</th>
                  <th className="p-4 text-right">Toplam Tutar</th>
                  <th className="p-4 text-right">Kalan Borç</th>
                  <th className="p-4">Durum</th>
                  <th className="p-4 text-center">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredOrders.map((order) => {
                  const total = order.totalAmount;
                  const paid = order.amountPaid || 0;
                  const balance = Math.max(0, total - paid);

                  return (
                    <tr key={order.id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Order / Waybill No */}
                      <td className="p-4 font-mono font-bold">
                        <span className="text-slate-800">{order.orderNo}</span>
                        {order.waybillNo && (
                          <div className="text-[10px] text-indigo-500 font-bold mt-0.5 flex items-center gap-0.5">
                            <FileCheck2 className="w-3 h-3" /> İrs: {order.waybillNo}
                          </div>
                        )}
                      </td>

                      {/* Customer Title */}
                      <td className="p-4 font-semibold text-slate-700">
                        {order.customerDetails?.name || order.customerName || "Perakende Alıcı"}
                        {(order.customerDetails?.phone) && (
                          <span className="block text-[10px] text-slate-400 font-mono mt-0.5">
                            Tel: {order.customerDetails.phone}
                          </span>
                        )}
                      </td>

                      {/* Date */}
                      <td className="p-4 text-slate-500 whitespace-nowrap">
                        {new Date(order.orderDate).toLocaleDateString("tr-TR")}
                      </td>

                      {/* Items summaries */}
                      <td className="p-4 max-w-xs">
                        <div className="space-y-1">
                          {order.items.map((item, index) => (
                            <div key={index} className="text-[11px] text-slate-600 truncate">
                              • {item.productName}{" "}
                              <span className="font-bold text-slate-800">
                                ({item.quantity} x {item.price} TL)
                              </span>
                              {item.rollNumber && (
                                <span className="block text-[9px] text-indigo-500 bg-indigo-50 px-1 py-0.2 rounded font-semibold w-fit mt-0.5">
                                  {item.rollNumber} {item.cutLength ? `(${item.cutLength}m kesim)` : ""}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Total price */}
                      <td className="p-4 text-right font-bold text-slate-800">
                        {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(total)}
                      </td>

                      {/* Balance debt */}
                      <td className="p-4 text-right font-bold">
                        {balance === 0 ? (
                          <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-[10px] font-bold">Ödendi</span>
                        ) : (
                          <span className="text-rose-600 font-mono">
                            {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(balance)}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-4">
                        {getStatusBadge(order.status)}
                      </td>

                      {/* Action buttons */}
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Print Waybill Button */}
                          <button
                            onClick={() => {
                              setSelectedOrder(order);
                              setIsPrintModalOpen(true);
                            }}
                            className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-indigo-600 rounded transition-colors"
                            title="İrsaliye Yazdır (A4)"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {/* Edit order details/status button */}
                          <button
                            onClick={() => {
                              setSelectedOrder(order);
                              setEditStatus(order.status);
                              setEditWaybillNo(order.waybillNo || "");
                              setEditWaybillDate(order.waybillDate || "");
                              setEditShipDate(order.shipDate || "");
                              setEditAmountPaid(order.amountPaid || 0);
                              setIsEditModalOpen(true);
                            }}
                            className="p-1.5 hover:bg-slate-100 text-slate-500 hover:text-slate-800 rounded transition-colors"
                            title="Durum / İrsaliye Düzenle"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {/* Delete order */}
                          <button
                            onClick={() => handleDeleteOrder(order.id)}
                            className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-rose-600 rounded transition-colors"
                            title="Siparişi Sil"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 5. CREATE NEW ORDER MODAL */}
      {/* ========================================= */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-500" />
                <span className="font-extrabold text-sm text-slate-800 uppercase tracking-wide">Yeni Sipariş ve Sevk İrsaliyesi Oluştur</span>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scroll Body */}
            <form onSubmit={handleCreateOrderSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* SECTION A: Customer details (Alıcı Bilgileri) */}
              <div className="space-y-4">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="font-extrabold text-xs text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-4 h-4 text-indigo-500" />
                    Müşteri Seçimi & Alıcı Detayları (Cari Bilgiler)
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Select from CRM */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Kayıtlı CRM Müşterisi Seç</label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:outline-none focus:bg-white"
                    >
                      <option value="">-- Yeni / Perakende Cari Alıcı --</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Customer title / Name */}
                  <div className="md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Alıcı Unvanı / Müşteri Adı</label>
                    <input
                      type="text"
                      value={rawCustomerDetails.name}
                      onChange={(e) => setRawCustomerDetails({ ...rawCustomerDetails, name: e.target.value })}
                      placeholder="Örn: Merter Giyim Sanayi A.Ş."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                      required
                    />
                  </div>

                  {/* Customer phone */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Müşteri Telefon</label>
                    <input
                      type="text"
                      value={rawCustomerDetails.phone}
                      onChange={(e) => setRawCustomerDetails({ ...rawCustomerDetails, phone: e.target.value })}
                      placeholder="+90 5__ ___ __ __"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                    />
                  </div>

                  {/* Tax Office */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vergi Dairesi</label>
                    <input
                      type="text"
                      value={rawCustomerDetails.taxOffice}
                      onChange={(e) => setRawCustomerDetails({ ...rawCustomerDetails, taxOffice: e.target.value })}
                      placeholder="Örn: Zeytinburnu"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                    />
                  </div>

                  {/* Tax Number */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vergi Numarası</label>
                    <input
                      type="text"
                      value={rawCustomerDetails.taxNumber}
                      onChange={(e) => setRawCustomerDetails({ ...rawCustomerDetails, taxNumber: e.target.value })}
                      placeholder="Örn: 9876543210"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                    />
                  </div>

                  {/* Billing/Shipping Address */}
                  <div className="md:col-span-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Sevk ve Fatura Adresi</label>
                    <textarea
                      value={rawCustomerDetails.address}
                      onChange={(e) => setRawCustomerDetails({ ...rawCustomerDetails, address: e.target.value })}
                      rows={2}
                      placeholder="İrsaliyede yer alacak teslimat adresi..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION B: Dynamic Order Items list (Kumaş / Ürün Listesi) */}
              <div className="space-y-4">
                <div className="border-b border-slate-100 pb-2 flex items-center justify-between">
                  <h3 className="font-extrabold text-xs text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-indigo-500" />
                    Sipariş Ürünleri & Kumaş Topu Seçenekleri
                  </h3>
                  <button
                    type="button"
                    onClick={handleAddOrderItem}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1"
                  >
                    <PlusCircle className="w-4 h-4" /> Ürün Ekle
                  </button>
                </div>

                <div className="space-y-3">
                  {orderItems.map((item, index) => {
                    // Find selected product
                    const selectedProduct = products.find(p => p.id === item.productId);
                    const isCloth = selectedProduct?.category?.toLowerCase().includes("kumaş") || selectedProduct?.category?.toLowerCase().includes("kumas");

                    return (
                      <div key={index} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                        <div className="flex flex-col md:flex-row md:items-center gap-3">
                          {/* 1. Product select dropdown */}
                          <div className="flex-1">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Ürün / Kumaş Seç</label>
                            <select
                              value={item.productId}
                              onChange={(e) => handleOrderItemChange(index, "productId", e.target.value)}
                              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                              required
                            >
                              <option value="">-- Seçiniz --</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} (Stok: {p.stock}m / adet, Fiyat: {p.price} TL)
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* 2. Specific Fabric Roll Selector */}
                          {isCloth && selectedProduct?.rolls && selectedProduct.rolls.length > 0 && (
                            <div className="w-full md:w-56">
                              <label className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider block mb-0.5">Kumaş Topu (Rulo) Seçimi</label>
                              <select
                                value={item.selectedRollId || ""}
                                onChange={(e) => {
                                  const rollId = e.target.value;
                                  handleOrderItemChange(index, "selectedRollId", rollId || undefined);
                                  
                                  // Auto fill cut length or quantities
                                  const roll = selectedProduct.rolls?.find(r => r.id === rollId);
                                  if (roll) {
                                    handleOrderItemChange(index, "cutLength", roll.length);
                                    handleOrderItemChange(index, "quantity", 1); // standard roll item
                                  } else {
                                    handleOrderItemChange(index, "cutLength", undefined);
                                  }
                                }}
                                className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                <option value="">-- Tüm Stoktan Genel Düş (Kumaş Topu Seçme) --</option>
                                {selectedProduct.rolls
                                  .filter(r => r.status === "available" && r.length > 0)
                                  .map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.rollNumber} (Kalan: {r.length} metre)
                                    </option>
                                  ))}
                              </select>
                            </div>
                          )}

                          {/* 3. If roll selected, show Cut Length option */}
                          {item.selectedRollId && (
                            <div className="w-24">
                              <label className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider block mb-0.5">Kesim (Metre)</label>
                              <input
                                type="number"
                                min={0.1}
                                step="any"
                                value={item.cutLength || ""}
                                onChange={(e) => {
                                  const len = Number(e.target.value);
                                  handleOrderItemChange(index, "cutLength", len);
                                  // standard item quantity is 1 roll
                                }}
                                className="w-full px-2.5 py-1.5 border border-indigo-200 rounded-lg text-xs bg-white focus:outline-none font-mono"
                                required
                              />
                            </div>
                          )}

                          {/* 4. Normal quantity input if not using roll, or general count */}
                          {!item.selectedRollId && (
                            <div className="w-24">
                              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Miktar</label>
                              <input
                                type="number"
                                min={1}
                                value={item.quantity}
                                onChange={(e) => handleOrderItemChange(index, "quantity", Number(e.target.value))}
                                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                                required
                              />
                            </div>
                          )}

                          {/* 5. Unit price */}
                          <div className="w-24">
                            <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Birim Fiyat (TL)</label>
                            <input
                              type="number"
                              min={0}
                              value={item.price}
                              onChange={(e) => handleOrderItemChange(index, "price", Number(e.target.value))}
                              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                              required
                            />
                          </div>

                          {/* 6. Remove item button */}
                          <div className="md:self-end">
                            <button
                              type="button"
                              onClick={() => handleRemoveOrderItem(index)}
                              className="p-1.5 text-slate-400 hover:text-rose-500 rounded bg-white border border-slate-200"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SECTION C: Official Waybill Data & Payment (İrsaliye ve Tahsilat) */}
              <div className="space-y-4">
                <div className="border-b border-slate-100 pb-2">
                  <h3 className="font-extrabold text-xs text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-indigo-500" />
                    Sevk İrsaliyesi & Tahsilat Bilgileri
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-indigo-50/20 p-5 rounded-2xl border border-indigo-100/50">
                  {/* Waybill number */}
                  <div>
                    <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block mb-1">İrsaliye No (Opsiyonel)</label>
                    <input
                      type="text"
                      placeholder="Örn: IRS20260001"
                      value={waybillNo}
                      onChange={(e) => setWaybillNo(e.target.value)}
                      className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-xs bg-white focus:outline-none"
                    />
                    <span className="text-[9px] text-indigo-400 block mt-0.5">Girilirse sevk edildi durumuna geçer.</span>
                  </div>

                  {/* Waybill date */}
                  <div>
                    <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block mb-1">İrsaliye Düzenleme Tarihi</label>
                    <input
                      type="date"
                      value={waybillDate}
                      onChange={(e) => setWaybillDate(e.target.value)}
                      className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-xs bg-white focus:outline-none"
                    />
                  </div>

                  {/* Ship date */}
                  <div>
                    <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block mb-1">Fiili Sevk Tarihi</label>
                    <input
                      type="date"
                      value={shipDate}
                      onChange={(e) => setShipDate(e.target.value)}
                      className="w-full px-3 py-2 border border-indigo-200 rounded-lg text-xs bg-white focus:outline-none"
                    />
                  </div>

                  {/* Payment */}
                  <div>
                    <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block mb-1 flex items-center gap-0.5">
                      <Coins className="w-3.5 h-3.5" /> Ödenen Tutar (TL)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-emerald-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold"
                    />
                  </div>

                  {/* General notes */}
                  <div className="md:col-span-4">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Sipariş Notları / Özel Açıklamalar</label>
                    <input
                      type="text"
                      placeholder="Müşteriye veya irsaliye dipnotuna eklenecek notlar..."
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Footer action buttons */}
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 rounded-lg text-xs font-semibold hover:bg-slate-50"
                >
                  İptal Et
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm"
                >
                  Siparişi / İrsaliyeyi Kaydet
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 6. EDIT ORDER STATUS MODAL */}
      {/* ========================================= */}
      {isEditModalOpen && selectedOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <span className="font-extrabold text-xs text-slate-700 uppercase tracking-wide">
                Durum & İrsaliye Güncelle: #{selectedOrder.orderNo}
              </span>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditOrderSubmit} className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Sipariş Durumu</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:outline-none focus:bg-white font-semibold"
                >
                  <option value="Sipariş Alındı">Sipariş Alındı</option>
                  <option value="Hazırlanıyor">Hazırlanıyor / Paket kesiliyor</option>
                  <option value="Sevk Edildi">Sevk Edildi (İrsaliye Kesildi)</option>
                  <option value="Teslim Edildi">Teslim Edildi</option>
                  <option value="İptal Edildi">İptal Edildi</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">İrsaliye Numarası (Varsa)</label>
                <input
                  type="text"
                  placeholder="Örn: IRS-2026-0041"
                  value={editWaybillNo}
                  onChange={(e) => setEditWaybillNo(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">İrsaliye Tarihi</label>
                  <input
                    type="date"
                    value={editWaybillDate}
                    onChange={(e) => setEditWaybillDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Fiili Sevk Tarihi</label>
                  <input
                    type="date"
                    value={editShipDate}
                    onChange={(e) => setEditShipDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block mb-1 font-bold">Toplam Alınan Ödeme (TL)</label>
                <input
                  type="number"
                  min={0}
                  value={editAmountPaid}
                  onChange={(e) => setEditAmountPaid(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-emerald-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold"
                />
                <span className="text-[9px] text-slate-400 block mt-0.5">Sipariş toplam tutarı: {selectedOrder.totalAmount} TL</span>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 rounded-lg text-xs font-semibold hover:bg-slate-50"
                >
                  Kapat
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-sm"
                >
                  Güncelleştirmeleri Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 7. PRINTABLE WAYBILL (SEVK İRSALİYESİ) MODAL */}
      {/* ========================================= */}
      {isPrintModalOpen && selectedOrder && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" id="waybill-print-modal">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[95vh] print:h-auto print:shadow-none print:border-none print:rounded-none">
            
            {/* Modal Controls Bar (Hidden during printing) */}
            <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between print:hidden">
              <span className="font-extrabold text-xs text-slate-700 uppercase tracking-wide flex items-center gap-1">
                <Printer className="w-4.5 h-4.5 text-indigo-500" /> Resmi Sevk İrsaliyesi Önizleme
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={triggerPrint}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-sm shadow-indigo-100"
                >
                  <Printer className="w-4 h-4" /> Yazdır / PDF İndir
                </button>
                <button
                  onClick={() => setIsPrintModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg border border-slate-200 bg-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* A4 Printable Paper Sheet Area */}
            <div className="flex-1 overflow-y-auto p-8 bg-slate-100 print:p-0 print:bg-white print:overflow-visible">
              <div className="bg-white mx-auto p-10 max-w-[210mm] min-h-[297mm] shadow-lg border border-slate-200 rounded print:shadow-none print:border-none print:p-0 print:max-w-none print:min-h-0">
                
                {/* 1. Official Header block */}
                <div className="grid grid-cols-12 gap-6 pb-6 border-b-2 border-slate-800">
                  {/* Seller details with Logo */}
                  <div className="col-span-7 space-y-3">
                    {company.logo ? (
                      <img
                        src={company.logo}
                        alt="Firma Logo"
                        className="max-h-16 max-w-[200px] object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-slate-200 text-slate-600 flex items-center justify-center rounded font-black text-xl">
                        {company.name ? company.name[0].toUpperCase() : "F"}
                      </div>
                    )}
                    <div>
                      <h1 className="text-sm font-black text-slate-900 uppercase">{company.name || "FİRMA UNVANI BELİRTİLMEMİŞ"}</h1>
                      <p className="text-[10px] text-slate-600 mt-1 leading-relaxed whitespace-pre-line max-w-sm">
                        {company.address || "Firma adresi girilmemiş."}
                      </p>
                      <div className="text-[9px] text-slate-500 font-medium space-y-0.5 mt-2">
                        {company.phone && <div>Tel: {company.phone}</div>}
                        {company.email && <div>E-posta: {company.email}</div>}
                        {company.taxOffice && (
                          <div className="font-bold text-slate-700">
                            Vergi Dairesi: {company.taxOffice} / V.N: {company.taxNumber || "-"}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Waybill official metadata */}
                  <div className="col-span-5 text-right flex flex-col justify-between h-full">
                    <div className="space-y-1">
                      <h2 className="text-lg font-black text-slate-900 tracking-wider">SEVK İRSALİYESİ</h2>
                      <span className="text-[10px] text-slate-400 font-bold block">T.C. Hazine ve Maliye Bakanlığı Standartı</span>
                    </div>

                    <div className="border border-slate-300 p-3 rounded-lg bg-slate-50/50 space-y-1 mt-4 text-left font-mono">
                      <div className="flex justify-between text-[11px] border-b border-slate-200 pb-1">
                        <span className="text-slate-400 font-sans font-bold">İrsaliye No:</span>
                        <span className="font-extrabold text-slate-800">{selectedOrder.waybillNo || "İRSALİYE KESİLMEDİ"}</span>
                      </div>
                      <div className="flex justify-between text-[10px] pt-1">
                        <span className="text-slate-400 font-sans">Düzenleme Tarihi:</span>
                        <span className="text-slate-700 font-bold">
                          {selectedOrder.waybillDate ? new Date(selectedOrder.waybillDate).toLocaleDateString("tr-TR") : new Date(selectedOrder.orderDate).toLocaleDateString("tr-TR")}
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-400 font-sans">Fiili Sevk Tarihi:</span>
                        <span className="text-indigo-600 font-bold">
                          {selectedOrder.shipDate ? new Date(selectedOrder.shipDate).toLocaleDateString("tr-TR") : "SEVK EDİLMEDİ"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Addresses Side-by-Side */}
                <div className="grid grid-cols-2 gap-6 py-6 border-b border-slate-200">
                  {/* Düzenleyen / Seller info backup */}
                  <div className="bg-slate-50/30 p-4 rounded-xl border border-slate-100">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-2">DÜZENLEYEN (SATICI SEVK MERKEZİ)</span>
                    <h3 className="font-bold text-slate-800 text-xs">{company.name || "Firma Adı"}</h3>
                    <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                      {company.address}
                    </p>
                    <span className="block text-[9px] font-bold text-slate-600 mt-2 font-mono">
                      VD: {company.taxOffice} / No: {company.taxNumber}
                    </span>
                  </div>

                  {/* Alıcı / Customer info */}
                  <div className="bg-slate-50/30 p-4 rounded-xl border border-slate-100">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block mb-2">ALICI (MÜŞTERİ / TESLİMAT CARİSİ)</span>
                    <h3 className="font-bold text-slate-800 text-xs">
                      {selectedOrder.customerDetails?.name || selectedOrder.customerName || "Perakende Müşteri"}
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                      {selectedOrder.customerDetails?.address || "Adres bilgisi verilmemiş."}
                    </p>
                    {selectedOrder.customerDetails?.phone && (
                      <span className="block text-[10px] text-slate-400 mt-1">Tel: {selectedOrder.customerDetails.phone}</span>
                    )}
                    <span className="block text-[9px] font-bold text-slate-600 mt-2 font-mono">
                      VD: {selectedOrder.customerDetails?.taxOffice || "-"} / No: {selectedOrder.customerDetails?.taxNumber || "-"}
                    </span>
                  </div>
                </div>

                {/* 3. Waybill Items Table */}
                <div className="py-6 min-h-[300px]">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-800 text-slate-400 text-[10px] font-bold uppercase">
                        <th className="py-2.5 w-10">Sıra</th>
                        <th className="py-2.5">Malın Cinsi / Hizmet Açıklaması (Rulo Bilgisi)</th>
                        <th className="py-2.5 text-right w-24">Sevk Miktarı</th>
                        <th className="py-2.5 text-center w-20">Birim</th>
                        <th className="py-2.5 text-right w-28">Birim Fiyat</th>
                        <th className="py-2.5 text-right w-28">Toplam Tutar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[11px] text-slate-800">
                      {selectedOrder.items.map((item, idx) => {
                        const isFabric = item.rollNumber || item.cutLength;
                        return (
                          <tr key={idx} className="align-top font-medium">
                            <td className="py-3 font-mono text-slate-400">{idx + 1}</td>
                            <td className="py-3">
                              <span className="font-bold text-slate-900 block">{item.productName}</span>
                              {item.rollNumber && (
                                <span className="text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded font-bold w-fit mt-1 block border border-indigo-100">
                                  Aktif Rulo: {item.rollNumber} {item.cutLength ? `(Kesilen Uzunluk: ${item.cutLength}m)` : ""}
                                </span>
                              )}
                            </td>
                            <td className="py-3 text-right font-mono font-bold text-slate-900">
                              {item.cutLength || item.quantity}
                            </td>
                            <td className="py-3 text-center text-slate-500 font-bold">
                              {isFabric ? "Metre" : "Adet"}
                            </td>
                            <td className="py-3 text-right font-mono text-slate-600">
                              {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(item.price)}
                            </td>
                            <td className="py-3 text-right font-mono font-bold text-slate-900">
                              {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format((item.cutLength || item.quantity) * item.price)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 4. Total and Notes blocks */}
                <div className="grid grid-cols-12 gap-6 pt-6 border-t-2 border-slate-800 text-xs">
                  {/* Waybill note */}
                  <div className="col-span-7 bg-slate-50 p-4 rounded-xl border border-slate-150">
                    <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider block">İRSALİYE NOTU</span>
                    <p className="text-[10px] text-slate-600 mt-1 leading-normal italic font-semibold">
                      "{selectedOrder.notes || "Ürünler hasarsız olarak sevk edilmiştir. Lütfen teslim alırken miktar kontrolünü sağlayınız."}"
                    </p>
                  </div>

                  {/* Calculations */}
                  <div className="col-span-5 font-mono space-y-2 text-right text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-sans">KDV Matrahı (Ara Toplam):</span>
                      <span className="text-slate-600 font-bold">
                        {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(selectedOrder.totalAmount / 1.2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-sans">Hesaplanan KDV (%20):</span>
                      <span className="text-slate-600 font-bold">
                        {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(selectedOrder.totalAmount - (selectedOrder.totalAmount / 1.2))}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2 text-xs">
                      <span className="font-sans font-bold text-slate-800">Genel Toplam (KDV Dahil):</span>
                      <span className="font-extrabold text-slate-900 text-sm">
                        {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(selectedOrder.totalAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] text-emerald-600 pt-1">
                      <span className="font-sans">Ödenen Tutar:</span>
                      <span className="font-bold">
                        {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(selectedOrder.amountPaid)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 5. Signature areas */}
                <div className="grid grid-cols-2 gap-8 pt-16 text-center text-xs">
                  <div className="border-t border-dashed border-slate-300 pt-4 space-y-1">
                    <span className="font-black text-slate-800 uppercase tracking-wide">TESLİM EDEN (Satici Firma Kaşe)</span>
                    <p className="text-[10px] text-slate-400">Ad Soyad, İmza</p>
                    <div className="h-10" />
                  </div>
                  <div className="border-t border-dashed border-slate-300 pt-4 space-y-1">
                    <span className="font-black text-slate-800 uppercase tracking-wide">TESLİM ALAN (Alici / Şoför)</span>
                    <p className="text-[10px] text-slate-400">Ad Soyad, İmza, Tarih</p>
                    <div className="h-10" />
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
