import { useState, useEffect, useMemo } from "react";
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
  LogOut,
  Zap,
  Clock,
  Crown,
  CreditCard,
  ShieldAlert,
  Mail
} from "lucide-react";
import { Product, Sale, SubscriptionEntitlement, TenantContext } from "./types";
import { Dashboard } from "./components/Dashboard";
import { Inventory } from "./components/Inventory";
import { QuickSale } from "./components/QuickSale";
import { QRScanner } from "./components/QRScanner";
import { History } from "./components/History";
import { Crm } from "./components/Crm";
import { Settings } from "./components/Settings";
import { OrdersWaybills } from "./components/OrdersWaybills";
import { SubscriptionModal } from "./components/SubscriptionModal";
import { QuickProductModal } from "./components/QuickProductModal";
import { auth } from "./lib/firebase";
import { assertAuthenticated, isDemoAllowed } from "./lib/authGuard";
import { onAuthStateChanged, signOut, sendEmailVerification } from "firebase/auth";
import { 
  getProducts, 
  addProduct, 
  updateProduct, 
  deleteProduct, 
  restoreProduct,
  replenishStock,
  getSales, 
  addSale,
  getCustomers,
  updateCustomer,
  processSaleTransaction,
  getTenantEntitlement,
  getOrCreateTenantContext,
  subscribeProducts,
  subscribeSales
} from "./lib/firestoreService";
import { Auth } from "./components/Auth";

export default function App() {
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Auth State
  const [user, setUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // SaaS Subscription & Entitlement State
  const [entitlement, setEntitlement] = useState<SubscriptionEntitlement | null>(null);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [blockReason, setBlockReason] = useState<string | undefined>(undefined);
  const [tenantContext, setTenantContext] = useState<TenantContext | null>(null);

  // Email Verification State
  const [dismissEmailVerification, setDismissEmailVerification] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [verificationStatusMsg, setVerificationStatusMsg] = useState("");

  const handleResendEmailVerification = async () => {
    if (!auth.currentUser) return;
    setResendingVerification(true);
    setVerificationStatusMsg("");
    try {
      await sendEmailVerification(auth.currentUser);
      setVerificationStatusMsg("Doğrulama bağlantısı e-posta adresinize tekrar gönderildi!");
    } catch (err: any) {
      console.error("Resend verification error:", err);
      setVerificationStatusMsg("Doğrulama e-postası şu an gönderilemedi. Lütfen daha sonra tekrar deneyin.");
    } finally {
      setResendingVerification(false);
    }
  };

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
  const [scannedBarcodeForNewProduct, setScannedBarcodeForNewProduct] = useState<string | null>(null);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [scanQty, setScanQty] = useState(1);
  const [scanSuccessMsg, setScanSuccessMsg] = useState("");
  const [scanErrorMsg, setScanErrorMsg] = useState("");

  const fetchDataForUser = async (uid: string, showLoader = false) => {
    try {
      assertAuthenticated(uid, "App.fetchDataForUser");
      if (showLoader) setIsLoading(true);
      const [productsRes, salesRes, entitlementRes, contextRes] = await Promise.all([
        getProducts(uid, true),
        getSales(uid),
        getTenantEntitlement(uid),
        getOrCreateTenantContext(uid)
      ]);
      setProducts(productsRes);
      setSales(salesRes);
      setEntitlement(entitlementRes);
      setTenantContext(contextRes);
    } catch (err) {
      console.error("Error loading server data:", err);
    } finally {
      if (showLoader) setIsLoading(false);
    }
  };

  const handleRefreshEntitlement = async () => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (uid) {
      const ent = await getTenantEntitlement(uid);
      setEntitlement(ent);
    }
  };

  const fetchData = async (showLoader = false) => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (uid) {
      await fetchDataForUser(uid, showLoader);
    }
  };

  // Active products for checkout and order picking (hides soft-deleted items)
  const activeProducts = useMemo(() => products.filter((p) => p.isActive !== false), [products]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        fetchDataForUser(currentUser.uid, true);
      } else {
        setUser((prev: any) => (isDemoAllowed() && prev && prev.uid === "demo-user" ? prev : null));
      }
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Multi-device real-time synchronization (e.g. desktop and mobile phone)
  useEffect(() => {
    const uid = user?.uid;
    if (!uid || uid === "demo-user" || uid.startsWith("local-")) return;

    let unsubProducts: (() => void) | null = null;
    let unsubSales: (() => void) | null = null;

    try {
      unsubProducts = subscribeProducts(
        uid,
        (realtimeProducts) => {
          setProducts(realtimeProducts);
        },
        (err) => console.warn("Realtime products sync notice:", err),
        true // include deleted so soft-deleted status updates immediately
      );

      unsubSales = subscribeSales(
        uid,
        (realtimeSales) => {
          setSales(realtimeSales);
        },
        (err) => console.warn("Realtime sales sync notice:", err)
      );
    } catch (err) {
      console.warn("Realtime subscription setup notice:", err);
    }

    return () => {
      if (unsubProducts) unsubProducts();
      if (unsubSales) unsubSales();
    };
  }, [user?.uid]);

  // Product mutations with Optimistic UI updates
  const handleAddProduct = async (newProduct: Omit<Product, "id">) => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) throw new Error("Oturum açık değil.");

    if (entitlement && !entitlement.hasAccess) {
      setBlockReason(entitlement.reason || "Abonelik süreniz sona ermiştir. Yeni ürün eklemek için lütfen bir plan seçin.");
      setShowSubscriptionModal(true);
      throw new Error(entitlement.reason || "Abonelik süreniz sona ermiştir.");
    }

    if (entitlement && !entitlement.canAddProduct) {
      setBlockReason(entitlement.reason || "Mevcut planınızın ürün kotası dolmuştur. Lütfen paketinizi yükseltin.");
      setShowSubscriptionModal(true);
      throw new Error(entitlement.reason || "Ürün ekleme kotası dolmuştur.");
    }

    await addProduct(uid, newProduct);
    await fetchData(false);
    await handleRefreshEntitlement();
  };

  const handleUpdateProduct = async (id: string, updates: Partial<Product>) => {
    // 0ms Optimistic UI update
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    try {
      await updateProduct(id, updates);
    } catch (err) {
      console.error("Failed to update product:", err);
      await fetchData(false);
      throw err;
    }
  };

  const handleDeleteProduct = async (id: string) => {
    // 0ms Optimistic soft delete
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: false, deletedAt: new Date().toISOString() } : p)));
    try {
      await deleteProduct(id);
    } catch (err) {
      console.error("Failed to delete product:", err);
      await fetchData(false);
      throw err;
    }
  };

  const handleRestoreProduct = async (id: string) => {
    // 0ms Optimistic restore
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: true, deletedAt: undefined } : p)));
    try {
      await restoreProduct(id);
    } catch (err) {
      console.error("Failed to restore product:", err);
      await fetchData(false);
      throw err;
    }
  };

  // Sales mutation (ACID Atomic Transaction)
  const handleRecordSale = async (
    items: { productId: string; quantity: number; selectedRollId?: string; cutLength?: number }[],
    customerId?: string,
    amountPaid?: number,
    idempotencyKey?: string,
    paymentMethod?: string
  ): Promise<void> => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) throw new Error("Oturum açık değil.");

    // Execute atomic transaction for stock, rolls, sale record, customer ledger and payment
    await processSaleTransaction(uid, {
      items,
      customerId,
      amountPaid,
      idempotencyKey,
      paymentMethod
    });

    await fetchData(false);
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setUser(null);
    } catch (err) {
      console.error("Signout error:", err);
    }
  };

  // Quick replenish helper (creates stock_movement audit record)
  const handleReplenishProduct = async (
    productId: string, 
    quantityToAdd: number, 
    options?: { costPrice?: number; note?: string }
  ) => {
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) throw new Error("Oturum açık değil.");
    await replenishStock(productId, {
      quantityToAdd,
      costPrice: options?.costPrice,
      note: options?.note || "Hızlı Stok Girişi"
    }, uid);
    await fetchData(false);
  };

  // Quick replenish from dashboard
  const handleQuickReplenish = async (productId: string, amount: number) => {
    await handleReplenishProduct(productId, amount, { note: "Konsol Hızlı Stok Takviyesi" });
  };

  // Handle successful scanner read
  const handleScanSuccess = (decodedText: string) => {
    setScanSuccessMsg("");
    setScanErrorMsg("");
    const cleanCode = decodedText.trim();
    // Find matching product either by manufacturer barcode, merchant sku or technical id
    const matched = products.find(
      (p) =>
        (p.barcode && p.barcode.trim().toLowerCase() === cleanCode.toLowerCase()) ||
        (p.sku && p.sku.trim().toLowerCase() === cleanCode.toLowerCase()) ||
        p.id.toLowerCase() === cleanCode.toLowerCase()
    );

    if (matched) {
      setScannedProduct(matched);
      setScanQty(1);
      setScannedBarcodeForNewProduct(null);
    } else {
      // Product not found! Set scannedBarcodeForNewProduct to allow 1-click addition
      setScannedBarcodeForNewProduct(cleanCode);
      setScannedProduct(null);
    }
  };

  // Quick scanner direct sale
  const handleScanSaleSubmit = async () => {
    if (!scannedProduct) return;
    try {
      const scanKey = `scan_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").substring(0, 12)}`;
      await handleRecordSale([{ productId: scannedProduct.id, quantity: scanQty }], undefined, undefined, scanKey);
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
      await handleReplenishProduct(scannedProduct.id, scanQty, { note: "Kamera Barkod Okuyucu Stok Girişi" });
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

        {/* SaaS Subscription & Plan Badge */}
        <div className="mx-4 mb-3 p-3.5 rounded-xl bg-slate-800/90 border border-slate-700/80 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Abonelik</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              entitlement?.isTrial 
                ? "bg-amber-500/20 text-amber-300 border border-amber-400/30" 
                : entitlement?.hasAccess 
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" 
                : "bg-rose-500/20 text-rose-300 border border-rose-400/30"
            }`}>
              {entitlement?.isTrial 
                ? `${entitlement.trialDaysLeft}G Deneme` 
                : entitlement?.hasAccess 
                ? "Aktif" 
                : "Sona Erdi"}
            </span>
          </div>
          <span className="font-bold text-xs text-white block mt-1.5 truncate">
            {entitlement?.plan?.name || "Pro Plan"}
          </span>
          <button
            type="button"
            onClick={() => { setBlockReason(undefined); setShowSubscriptionModal(true); }}
            className="w-full mt-2.5 py-1.5 px-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm active:scale-98"
          >
            <Zap className="w-3.5 h-3.5 text-indigo-200" />
            <span>Planları Yönet</span>
          </button>
        </div>

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
              type="button"
              onClick={() => { setBlockReason(undefined); setShowSubscriptionModal(true); }}
              className="px-2.5 py-1 bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Zap className="w-3.5 h-3.5 text-indigo-400" />
              <span>{entitlement?.isTrial ? `${entitlement.trialDaysLeft}G` : entitlement?.plan?.name || "Plan"}</span>
            </button>
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

        {/* Trial Expired / Subscription Inactive Global Warning */}
        {entitlement && !entitlement.hasAccess && (
          <div className="bg-rose-600 text-white p-3 px-6 flex items-center justify-between text-xs font-bold shadow-md z-10 animate-fade-in">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{entitlement.reason || "Aboneliğiniz veya deneme süreniz sona ermiştir. İşlemlere devam etmek için lütfen planınızı seçin."}</span>
            </div>
            <button
              type="button"
              onClick={() => { setBlockReason(entitlement.reason); setShowSubscriptionModal(true); }}
              className="px-3 py-1 bg-white text-rose-700 hover:bg-rose-50 rounded-lg text-xs font-black shadow-sm transition-all cursor-pointer flex-shrink-0 ml-4"
            >
              Hemen Plan Seç
            </button>
          </div>
        )}

        {/* Email Verification Banner */}
        {user && !user.isDemo && auth.currentUser && !auth.currentUser.emailVerified && !dismissEmailVerification && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-200 p-2.5 px-4 sm:px-6 flex flex-wrap items-center justify-between text-xs font-medium z-10 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="truncate">
                {verificationStatusMsg || `E-posta adresiniz (${auth.currentUser.email || user.email}) henüz doğrulanmadı. Hesap güvenliğiniz için gelen kutunuzu kontrol edin.`}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!verificationStatusMsg && (
                <button
                  type="button"
                  disabled={resendingVerification}
                  onClick={handleResendEmailVerification}
                  className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-400/30 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50"
                >
                  {resendingVerification ? "Gönderiliyor..." : "Tekrar Gönder"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDismissEmailVerification(true)}
                className="p-1 text-amber-400 hover:text-white rounded-lg transition-colors"
                title="Kapat"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

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
                    products={activeProducts}
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
                    onRestoreProduct={handleRestoreProduct}
                    onReplenishProduct={handleReplenishProduct}
                    onRefreshData={fetchData}
                    initialFilter={inventoryFilter}
                    onClearInitialFilter={() => setInventoryFilter(null)}
                  />
                )}
                {activeTab === "orders" && (
                  <OrdersWaybills products={activeProducts} onRefreshProducts={fetchData} />
                )}
                {activeTab === "sale" && (
                  <QuickSale products={activeProducts} onRecordSale={handleRecordSale} />
                )}
                {activeTab === "crm" && (
                  <Crm onRefreshData={fetchData} />
                )}
                {activeTab === "scan" && (
                  <div className="space-y-6">
                    <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                      <h2 className="text-lg font-bold text-slate-800">Barkod & QR Stok / Satış Tarayıcı</h2>
                      <p className="text-xs text-slate-400">
                        Kameranızla ürünün barkodunu veya QR kodunu okutun; doğrudan stok girişi yapın, satın veya yeni ürün olarak kaydedin.
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

                    {/* Unregistered Barcode Found Card */}
                    {scannedBarcodeForNewProduct && (
                      <div className="bg-amber-50 border border-amber-300 p-4 rounded-2xl max-w-md mx-auto shadow-sm animate-fade-in text-center space-y-3">
                        <span className="text-[10px] font-black uppercase text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
                          Kayıtlı Olmayan Barkod
                        </span>
                        <div>
                          <span className="text-sm font-bold text-slate-800 block">Bu barkod envanterinizde bulunamadı</span>
                          <span className="text-xs text-amber-900 font-mono block mt-1 bg-white border border-amber-200 py-1 px-2 rounded-lg font-bold">
                            {scannedBarcodeForNewProduct}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Paketli veya yeni ürününüzü bu barkodla hemen stoğunuza ekleyebilirsiniz.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setShowQuickAddModal(true)}
                            className="flex-1 py-2.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
                          >
                            <Plus className="w-4 h-4" />
                            <span>Yeni Ürün Olarak Ekle</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setScannedBarcodeForNewProduct(null)}
                            className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
                          >
                            Kapat
                          </button>
                        </div>
                      </div>
                    )}

                    <QRScanner onScanSuccess={handleScanSuccess} />
                  </div>
                )}
                {activeTab === "history" && <History sales={sales} products={products} />}
                {activeTab === "settings" && (
                  <Settings 
                    onRefreshSectorSettings={fetchData} 
                    onOpenSubscriptionModal={() => { setBlockReason(undefined); setShowSubscriptionModal(true); }}
                    companyName={tenantContext?.companyName}
                    tenantId={tenantContext?.tenantId}
                  />
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

      {/* 5. SaaS Subscription & Plan Selection Modal */}
      <SubscriptionModal
        isOpen={showSubscriptionModal}
        onClose={() => {
          setShowSubscriptionModal(false);
          setBlockReason(undefined);
        }}
        tenantId={tenantContext?.tenantId || user?.uid || "demo-tenant"}
        entitlement={entitlement}
        onRefreshEntitlement={handleRefreshEntitlement}
        blockReason={blockReason}
      />

      {/* 6. Quick Product Modal for Scanned Barcode */}
      {showQuickAddModal && (
        <QuickProductModal
          initialBarcode={scannedBarcodeForNewProduct || undefined}
          existingProducts={products}
          onAddProduct={async (p) => {
            await handleAddProduct(p);
            setShowQuickAddModal(false);
            setScannedBarcodeForNewProduct(null);
            setScanSuccessMsg(`"${p.name}" başarıyla oluşturuldu ve stoğa eklendi!`);
            setTimeout(() => setScanSuccessMsg(""), 4000);
          }}
          onClose={() => {
            setShowQuickAddModal(false);
            setScannedBarcodeForNewProduct(null);
          }}
        />
      )}
    </div>
  );
}
