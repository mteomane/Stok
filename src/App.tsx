import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  LayoutDashboard,
  Box,
  ShoppingCart,
  QrCode,
  History as HistoryIcon,
  Menu,
  X,
  User,
  Plus,
  Minus,
  CheckCircle2,
  AlertCircle,
  Users,
  Sliders,
  FileText,
  LogOut
} from "lucide-react";
import { Product, Sale } from "./types";
import { Dashboard } from "./components/Dashboard";
import { Inventory } from "./components/Inventory";
import { QuickSale } from "./components/QuickSale";
import { QRScanner } from "./components/QRScanner";
import { History } from "./components/History";
import { Crm } from "./components/Crm";
import { Settings } from "./components/Settings";
import { OrdersWaybills } from "./components/OrdersWaybills";
import { auth } from "./lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { 
  getProducts, 
  addProduct, 
  updateProduct, 
  deleteProduct, 
  getSales, 
  addSale,
  getCustomers,
  updateCustomer
} from "./lib/firestoreService";
import { Auth } from "./components/Auth";

export default function App() {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Auth State
  const [user, setUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Core backend state
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Quick inventory navigation filter (e.g. from Dashboard low stock cards)
  const [inventoryFilter, setInventoryFilter] = useState<{
    onlyLowStock?: boolean;
    search?: string;
    highlightProductId?: string;
  } | null>(null);

  const handleNavigateToLowStock = (productId?: string) => {
    if (productId) {
      const prod = products.find((p) => p.id === productId);
      setInventoryFilter({
        onlyLowStock: true,
        search: prod ? prod.name : "",
        highlightProductId: productId,
      });
    } else {
      setInventoryFilter({
        onlyLowStock: true,
        search: "",
      });
    }
    setActiveTab("inventory");
  };

  // Scanned product action overlay
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [scanQty, setScanQty] = useState(1);
  const [scanSuccessMsg, setScanSuccessMsg] = useState("");
  const [scanErrorMsg, setScanErrorMsg] = useState("");

  const fetchDataForUser = async (uid: string) => {
    try {
      setIsLoading(true);
      const [productsRes, salesRes] = await Promise.all([
        getProducts(uid),
        getSales(uid)
      ]);
      setProducts(productsRes);
      setSales(salesRes);
    } catch (err) {
      console.error("Error loading server data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchData = async () => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (uid) {
      await fetchDataForUser(uid);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        fetchDataForUser(currentUser.uid);
      } else {
        setUser((prev: any) => (prev && prev.uid === "demo-user" ? prev : null));
      }
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Product mutations
  const handleAddProduct = async (newProduct: Omit<Product, "id">) => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) throw new Error("Oturum açık değil.");
    await addProduct(uid, newProduct);
    await fetchData();
  };

  const handleUpdateProduct = async (id: string, updates: Partial<Product>) => {
    await updateProduct(id, updates);
    await fetchData();
  };

  const handleDeleteProduct = async (id: string) => {
    await deleteProduct(id);
    await fetchData();
  };

  // Sales mutation
  const handleRecordSale = async (
    items: { productId: string; quantity: number; selectedRollId?: string; cutLength?: number }[],
    customerId?: string,
    amountPaid?: number
  ) => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) throw new Error("Oturum açık değil.");

    const saleItems: any[] = [];
    let totalAmount = 0;

    // 1. Check stock and prepare sale items
    for (const item of items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw new Error(`Ürün bulunamadı: ID ${item.productId}`);

      const qty = Number(item.quantity);
      const rollId = item.selectedRollId;
      const cutLen = item.cutLength !== undefined ? Number(item.cutLength) : undefined;
      const qtyToDeduct = cutLen !== undefined ? cutLen : qty;

      if (rollId && product.rolls) {
        const roll = product.rolls.find((r) => r.id === rollId);
        if (!roll) throw new Error(`Kumaş topu bulunamadı: ID ${rollId}`);
        if (roll.length < qtyToDeduct) {
          throw new Error(`Seçilen kumaş topunda (${roll.rollNumber}) yeterli miktar yok! Kalan: ${roll.length}m`);
        }
      } else {
        if (product.stock < qtyToDeduct) {
          throw new Error(`Yetersiz stok! ${product.name} için kalan: ${product.stock}m`);
        }
      }

      saleItems.push({
        productId: product.id,
        productName: product.name,
        name: product.name,
        quantity: qty,
        price: product.price,
        selectedRollId: rollId,
        selectedRollNumber: rollId && product.rolls ? product.rolls.find((r) => r.id === rollId)?.rollNumber : undefined,
        cutLength: cutLen
      });
      totalAmount += product.price * qty;
    }

    // 2. Deduct stock and save product updates
    for (const item of saleItems) {
      const product = products.find((p) => p.id === item.productId)!;
      const qtyToDeduct = item.cutLength !== undefined ? item.cutLength : item.quantity;

      let newStock = product.stock;
      let newRolls = product.rolls ? [...product.rolls] : undefined;

      if (item.selectedRollId && newRolls) {
        newRolls = newRolls.map((r) => {
          if (r.id === item.selectedRollId) {
            const updatedLen = Math.max(0, r.length - qtyToDeduct);
            return {
              ...r,
              length: updatedLen,
              status: updatedLen <= 0 ? ("sold" as const) : r.status
            };
          }
          return r;
        });
        newStock = newRolls.reduce((sum, r) => sum + r.length, 0);
      } else {
        newStock = Math.max(0, product.stock - qtyToDeduct);
        if (newRolls && newRolls.length > 0) {
          let remaining = qtyToDeduct;
          newRolls = newRolls.map((r) => {
            if (r.status === "available" && r.length > 0 && remaining > 0) {
              const dec = Math.min(r.length, remaining);
              remaining -= dec;
              const updatedLen = Math.max(0, r.length - dec);
              return {
                ...r,
                length: updatedLen,
                status: updatedLen <= 0 ? ("sold" as const) : r.status
              };
            }
            return r;
          });
          newStock = newRolls.reduce((sum, r) => sum + r.length, 0);
        }
      }

      await updateProduct(product.id, {
        stock: newStock,
        rolls: newRolls
      });
    }

    // 3. Record sale in history
    const saleId = "S" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const newSale = {
      items: saleItems,
      totalAmount,
      timestamp: new Date().toISOString()
    };

    const addedSale = await addSale(uid, newSale);

    // 4. Customer ledger link
    if (customerId) {
      const allCustomers = await getCustomers(uid);
      const customer = allCustomers.find((c) => c.id === customerId);
      if (customer) {
        const transactions = [...(customer.transactions || [])];
        let totalDebt = customer.totalDebt || 0;
        let totalPaid = customer.totalPaid || 0;

        transactions.unshift({
          id: "T_P_" + addedSale.id,
          type: "sale",
          amount: totalAmount,
          description: `Satış Alımı (Fiş: #${addedSale.id})`,
          timestamp: new Date().toISOString()
        });
        totalDebt += totalAmount;

        const paid = Number(amountPaid || 0);
        if (paid > 0) {
          transactions.unshift({
            id: "T_P_PAY_" + addedSale.id,
            type: "payment",
            amount: paid,
            description: `Satış Ödemesi (Fiş: #${addedSale.id})`,
            timestamp: new Date().toISOString()
          });
          totalDebt = Math.max(0, totalDebt - paid);
          totalPaid += paid;
        }

        await updateCustomer(customerId, {
          totalDebt,
          totalPaid,
          transactions
        });
      }
    }

    await fetchData();
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (err) {
      console.error("Signout error:", err);
    }
  };

  // Quick replenish from dashboard
  const handleQuickReplenish = async (productId: string, amount: number) => {
    const product = products.find((p) => p.id === productId);
    if (product) {
      await handleUpdateProduct(productId, { stock: product.stock + amount });
    }
  };

  // Handle successful scanner read
  const handleScanSuccess = (decodedText: string) => {
    setScanSuccessMsg("");
    setScanErrorMsg("");
    // Find matching product either by exact id or sku barcode
    const matched = products.find(
      (p) => p.sku === decodedText || p.id === decodedText
    );

    if (matched) {
      setScannedProduct(matched);
      setScanQty(1);
    } else {
      setScanErrorMsg(`Ürün bulunamadı: "${decodedText}". Lütfen geçerli bir barkod taratın.`);
      setTimeout(() => setScanErrorMsg(""), 5000);
    }
  };

  // Quick scanner direct sale
  const handleScanSaleSubmit = async () => {
    if (!scannedProduct) return;
    try {
      await handleRecordSale([{ productId: scannedProduct.id, quantity: scanQty }]);
      setScanSuccessMsg(`Başarıyla satıldı: ${scanQty}x ${scannedProduct.name}`);
      setScannedProduct(null);
      setTimeout(() => setScanSuccessMsg(""), 4000);
    } catch (err: any) {
      setScanErrorMsg(err.message || "Satış işlemi başarısız oldu.");
    }
  };

  // Quick scanner direct replenishment
  const handleScanReplenishSubmit = async () => {
    if (!scannedProduct) return;
    try {
      await handleUpdateProduct(scannedProduct.id, { stock: scannedProduct.stock + scanQty });
      setScanSuccessMsg(`Stok güncellendi: +${scanQty} ${scannedProduct.name}`);
      setScannedProduct(null);
      setTimeout(() => setScanSuccessMsg(""), 4000);
    } catch (err: any) {
      setScanErrorMsg(err.message || "Stok güncelleme başarısız oldu.");
    }
  };

  const navItems = [
    { id: "dashboard", label: "Konsol", icon: LayoutDashboard },
    { id: "inventory", label: "Ürünler & Stok", icon: Box },
    { id: "sale", label: "Hızlı Satış Yap", icon: ShoppingCart },
    { id: "orders", label: "Sipariş & İrsaliye", icon: FileText },
    { id: "crm", label: "CRM & Veresiye", icon: Users },
    { id: "scan", label: "QR Kod Tara", icon: QrCode },
    { id: "history", label: "Satış Geçmişi", icon: HistoryIcon },
    { id: "settings", label: "Sektörel Ayarlar", icon: Sliders }
  ];

  if (isAuthLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#F8FAFC] space-y-3">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Oturum Kontrol Ediliyor...</span>
      </div>
    );
  }

  if (!user) {
    return <Auth onSuccess={(u) => {
      if (u) {
        setUser(u);
        fetchDataForUser(u.uid);
      }
    }} />;
  }

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-slate-800 font-sans overflow-hidden">
      {/* 1. Desktop Sticky Left Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-[#1E293B] text-slate-100 flex-shrink-0 border-r border-slate-700">
        {/* Branding */}
        <div className="p-6 border-b border-slate-700 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            S
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-white leading-none">StokTakip Pro</h1>
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mt-1">Kurumsal Sürüm v1.0</span>
          </div>
        </div>

        {/* Menu Items */}
        <nav className="flex-1 py-6 px-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "inventory") {
                    setInventoryFilter(null);
                  }
                  setActiveTab(item.id);
                  setScanSuccessMsg("");
                  setScanErrorMsg("");
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-indigo-600/20 text-indigo-400"
                    : "hover:bg-slate-800 text-slate-400"
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Card */}
        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-3 bg-slate-800/30 p-3 rounded-xl border border-slate-800/20">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-xs border border-indigo-500/30">
              {user.email ? user.email[0].toUpperCase() : "U"}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-xs font-bold text-slate-200 block truncate">{user.email || "Kullanıcı"}</span>
              <button 
                onClick={handleSignOut}
                className="text-[10px] font-bold text-rose-400 hover:text-rose-300 flex items-center gap-1 mt-0.5 transition-colors"
              >
                <LogOut className="w-3 h-3" />
                <span>Çıkış Yap</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. Main Content View Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile Nav Header */}
        <header className="md:hidden bg-slate-900 text-slate-100 h-16 px-4 flex items-center justify-between border-b border-slate-800 flex-shrink-0 z-20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-black text-sm">
              S
            </div>
            <span className="font-extrabold text-sm tracking-wide">StokPro</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSignOut}
              className="p-2 text-rose-400 hover:text-rose-300"
              title="Çıkış Yap"
            >
              <LogOut className="w-5 h-5" />
            </button>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-slate-400 hover:text-white"
            >
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-16 left-0 right-0 bg-slate-900 border-b border-slate-800 p-4 space-y-1 z-10 md:hidden"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.id === "inventory") {
                        setInventoryFilter(null);
                      }
                      setActiveTab(item.id);
                      setIsMobileMenuOpen(false);
                      setScanSuccessMsg("");
                      setScanErrorMsg("");
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                      isActive ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-800/30"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Inner Content Scroller */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8 pb-20 md:pb-8">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full space-y-3">
              <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Veriler Yükleniyor...</span>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.15 }}
                className="h-full"
              >
                {activeTab === "dashboard" && (
                  <Dashboard
                    products={products}
                    sales={sales}
                    onQuickReplenish={handleQuickReplenish}
                    onNavigateToTab={(tab) => {
                      if (tab === "inventory") {
                        setInventoryFilter(null);
                      }
                      setActiveTab(tab);
                    }}
                    onNavigateToLowStock={handleNavigateToLowStock}
                  />
                )}
                {activeTab === "inventory" && (
                  <Inventory
                    products={products}
                    onAddProduct={handleAddProduct}
                    onUpdateProduct={handleUpdateProduct}
                    onDeleteProduct={handleDeleteProduct}
                    onRefreshData={fetchData}
                    initialFilter={inventoryFilter}
                    onClearInitialFilter={() => setInventoryFilter(null)}
                  />
                )}
                {activeTab === "orders" && (
                  <OrdersWaybills products={products} onRefreshProducts={fetchData} />
                )}
                {activeTab === "sale" && (
                  <QuickSale products={products} onRecordSale={handleRecordSale} />
                )}
                {activeTab === "crm" && (
                  <Crm onRefreshData={fetchData} />
                )}
                {activeTab === "scan" && (
                  <div className="space-y-6">
                    <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                      <h2 className="text-lg font-bold text-slate-800">QR Kod Stok & Satış Tarayıcı</h2>
                      <p className="text-xs text-slate-400">
                        Kameranızı açarak ürünün QR kodunu taratın, stoktan düşürün veya takviye edin.
                      </p>
                    </div>

                    {scanSuccessMsg && (
                      <div className="bg-emerald-50 text-emerald-600 text-xs p-3 rounded-xl border border-emerald-100 flex items-center gap-2 max-w-md mx-auto">
                        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                        <span>{scanSuccessMsg}</span>
                      </div>
                    )}

                    {scanErrorMsg && (
                      <div className="bg-rose-50 text-rose-600 text-xs p-3 rounded-xl border border-rose-100 flex items-center gap-2 max-w-md mx-auto">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{scanErrorMsg}</span>
                      </div>
                    )}

                    <QRScanner onScanSuccess={handleScanSuccess} />
                  </div>
                )}
                {activeTab === "history" && <History sales={sales} products={products} />}
                {activeTab === "settings" && (
                  <Settings onRefreshSectorSettings={fetchData} />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </main>

        {/* 3. Sticky Bottom Mobile Tab Bar Menu */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-100 h-16 flex items-center justify-around px-2 z-10 shadow-lg">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === "inventory") {
                    setInventoryFilter(null);
                  }
                  setActiveTab(item.id);
                  setScanSuccessMsg("");
                  setScanErrorMsg("");
                }}
                className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-bold ${
                  isActive ? "text-indigo-600" : "text-slate-400"
                }`}
              >
                <Icon className={`w-5 h-5 mb-1 ${isActive ? "text-indigo-600" : "text-slate-400"}`} />
                <span>{item.label === "Ürünler & Stok" ? "Envanter" : item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 4. Scanner Action Overlay Modal Sheet */}
      <AnimatePresence>
        {scannedProduct && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          >
            <motion.div
              initial={{ y: 50 }}
              animate={{ y: 0 }}
              exit={{ y: 50 }}
              className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl border border-slate-150 relative text-center"
            >
              <button
                onClick={() => setScannedProduct(null)}
                className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 font-semibold"
              >
                ✕
              </button>

              <span className="text-[10px] font-black uppercase text-indigo-500 tracking-wider bg-indigo-50 px-2.5 py-1 rounded-full">
                Ürün Tarandı
              </span>

              <h3 className="font-extrabold text-slate-800 text-lg mt-3">{scannedProduct.name}</h3>
              <span className="text-xs text-slate-400 font-mono mt-0.5 block">Barkod/SKU: {scannedProduct.sku}</span>

              {/* Stock display indicator */}
              <div className="my-5 bg-slate-50 border border-slate-100 rounded-2xl p-4 flex justify-around">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Mevcut Stok</span>
                  <span className={`text-xl font-black ${scannedProduct.stock <= scannedProduct.minStock ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {scannedProduct.stock} Adet
                  </span>
                </div>
                <div className="border-l border-slate-100" />
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Birim Fiyat</span>
                  <span className="text-xl font-black text-slate-800">
                    {new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(scannedProduct.price)}
                  </span>
                </div>
              </div>

              {/* Adjust Qty */}
              <div className="flex flex-col items-center space-y-2 mb-6">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">İşlem Miktarı</span>
                <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl p-1 w-32 shadow-inner">
                  <button
                    onClick={() => setScanQty(Math.max(1, scanQty - 1))}
                    className="p-1.5 rounded-lg hover:bg-white text-slate-500 active:scale-90 transition-all"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="flex-1 text-sm font-black text-slate-700 text-center">{scanQty}</span>
                  <button
                    onClick={() => setScanQty(scanQty + 1)}
                    className="p-1.5 rounded-lg hover:bg-white text-slate-500 active:scale-90 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Action Choices */}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={handleScanSaleSubmit}
                  disabled={scannedProduct.stock < scanQty}
                  className={`flex-1 py-3 font-semibold text-sm rounded-xl transition-all shadow-md active:scale-95 ${
                    scannedProduct.stock < scanQty
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                      : "bg-rose-500 hover:bg-rose-600 text-white shadow-rose-100"
                  }`}
                >
                  Stoktan Düş (Satış)
                </button>
                <button
                  onClick={handleScanReplenishSubmit}
                  className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm rounded-xl transition-all shadow-md shadow-emerald-100 active:scale-95"
                >
                  Stok Ekle (Takviye)
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
