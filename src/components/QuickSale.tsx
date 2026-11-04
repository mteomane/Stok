import React, { useState, useEffect } from "react";
import { Product, CartItem, Customer, Sale, FabricRoll, ProductBox } from "../types";
import { auth } from "../lib/firebase";
import { getCustomers, roundQty } from "../lib/firestoreService";
import { 
  ShoppingCart, 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  User, 
  CreditCard,
  DollarSign,
  Scissors,
  Layers,
  Loader2,
  Camera,
  Barcode as BarcodeIcon,
  X,
  Package,
  Printer,
  Sparkles,
  Tag
} from "lucide-react";
import { QRScanner } from "./QRScanner";
import { ReceiptPrintModal } from "./ReceiptPrintModal";

interface QuickSaleProps {
  products: Product[];
  onRecordSale: (
    items: { 
      productId: string; 
      quantity: number; 
      selectedRollId?: string; 
      cutLength?: number;
      selectedBoxId?: string;
    }[], 
    customerId?: string, 
    amountPaid?: number,
    idempotencyKey?: string,
    paymentMethod?: string
  ) => Promise<any>;
}

export function QuickSale({ products, onRecordSale }: QuickSaleProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentIdempotencyKey, setCurrentIdempotencyKey] = useState<string | null>(null);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [scannerFeedback, setScannerFeedback] = useState<string | null>(null);

  // Roll & Box selection states
  const [selectedRollId, setSelectedRollId] = useState<string>("");
  const [selectedBoxId, setSelectedBoxId] = useState<string>("");
  const [cutLength, setCutLength] = useState<string>("");

  // CRM integration states
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("nakit");
  const [isCrmLoading, setIsCrmLoading] = useState(false);

  // Receipt printing modal state
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // Load customers for checkout selection
  const fetchCustomers = async () => {
    try {
      setIsCrmLoading(true);
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const data = await getCustomers(uid);
      setCustomers(data);
    } catch (err) {
      console.error("Failed to fetch customers for quick sale", err);
    } finally {
      setIsCrmLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [success]);

  // Extract unique categories for quick filter
  const categories = React.useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category) set.add(p.category);
    });
    return ["all", ...Array.from(set)];
  }, [products]);

  // Filtered products: Visible even when search is empty!
  const displayedProducts = React.useMemo(() => {
    return products.filter((p) => {
      // Category filter
      if (selectedCategory !== "all" && p.category?.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }

      // Search term filter
      if (!search.trim()) return true;
      const term = search.trim().toLowerCase();
      return (
        p.name.toLowerCase().includes(term) ||
        (p.sku && p.sku.toLowerCase().includes(term)) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (p.brand && p.brand.toLowerCase().includes(term)) ||
        p.id.toLowerCase().includes(term)
      );
    });
  }, [products, search, selectedCategory]);

  const selectProductToConfigure = (prod: Product) => {
    setSelectedProduct(prod);
    setSelectedRollId("");
    setSelectedBoxId("");
    setCutLength("");
    setQuantity(1);
    setError(null);
  };

  const addToCart = (product: Product, qty: number) => {
    setError(null);
    setSuccess(false);
    setCurrentIdempotencyKey(null);

    const isFabric = 
      product.category?.toLowerCase() === "kumaş" || 
      product.category?.toLowerCase() === "kumas" || 
      (product.rolls && product.rolls.length > 0);

    const hasBoxes = product.boxes && product.boxes.length > 0;

    const finalRollId = isFabric && selectedRollId ? selectedRollId : undefined;
    const finalBoxId = hasBoxes && selectedBoxId ? selectedBoxId : undefined;
    const finalCutLength = isFabric && cutLength ? parseFloat(cutLength) : undefined;

    // Validate roll stock
    if (finalRollId) {
      const selectedRoll = product.rolls?.find(r => r.id === finalRollId);
      if (selectedRoll) {
        const requiredAmt = finalCutLength || qty;
        if (selectedRoll.length < requiredAmt) {
          setError(`Seçilen topta yeterli kumaş yok! Kalan: ${selectedRoll.length} m`);
          return;
        }
      }
    } 
    // Validate box stock
    else if (finalBoxId) {
      const selectedBox = product.boxes?.find(b => b.id === finalBoxId);
      if (selectedBox) {
        if (selectedBox.quantity < qty) {
          setError(`Seçilen kolide yeterli adet yok! Kalan: ${selectedBox.quantity} adet`);
          return;
        }
      }
    } else {
      if (product.stock < qty) {
        setError(`Stok yetersiz! Mevcut stok: ${product.stock}`);
        return;
      }
    }

    const boxObj = finalBoxId ? product.boxes?.find(b => b.id === finalBoxId) : undefined;

    const existingIndex = cart.findIndex(
      (item) => 
        item.product.id === product.id && 
        item.selectedRollId === finalRollId &&
        item.selectedBoxId === finalBoxId
    );

    if (existingIndex !== -1) {
      const currentQtyInCart = cart[existingIndex].quantity;
      const updatedCart = [...cart];
      
      if (finalCutLength) {
        const newCutLen = roundQty((updatedCart[existingIndex].cutLength || 0) + finalCutLength);
        if (finalRollId) {
          const selectedRoll = product.rolls?.find(r => r.id === finalRollId);
          if (selectedRoll && selectedRoll.length < newCutLen) {
            setError(`Seçilen topta yeterli kumaş yok! Toplam istenen: ${newCutLen} m`);
            return;
          }
        }
        updatedCart[existingIndex].cutLength = newCutLen;
        updatedCart[existingIndex].quantity = newCutLen;
      } else {
        const newQty = roundQty(currentQtyInCart + qty);
        if (finalBoxId && boxObj && boxObj.quantity < newQty) {
          setError(`Seçilen kolide yeterli adet yok! Maksimum: ${boxObj.quantity}`);
          return;
        }
        if (product.stock < newQty) {
          setError(`Stok limiti aşılıyor! Maksimum: ${product.stock}`);
          return;
        }
        updatedCart[existingIndex].quantity = newQty;
      }
      setCart(updatedCart);
    } else {
      setCart([
        ...cart,
        {
          product,
          quantity: finalCutLength !== undefined ? roundQty(finalCutLength) : roundQty(qty),
          selectedRollId: finalRollId,
          cutLength: finalCutLength !== undefined ? roundQty(finalCutLength) : undefined,
          selectedBoxId: finalBoxId,
          selectedBoxNumber: boxObj?.boxNumber,
          unit: product.unit || (isFabric ? "metre" : "adet")
        }
      ]);
    }

    // Reset selection
    setSearch("");
    setSelectedProduct(null);
    setQuantity(1);
    setSelectedRollId("");
    setSelectedBoxId("");
    setCutLength("");
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const term = search.trim().toLowerCase();
      if (!term) return;

      const exactMatch = products.find(
        (p) =>
          (p.barcode && p.barcode.trim().toLowerCase() === term) ||
          (p.sku && p.sku.trim().toLowerCase() === term) ||
          p.id.toLowerCase() === term
      );

      if (exactMatch) {
        addToCart(exactMatch, 1);
        setSearch("");
        setSelectedProduct(null);
      } else if (displayedProducts.length === 1) {
        addToCart(displayedProducts[0], 1);
        setSearch("");
        setSelectedProduct(null);
      }
    }
  };

  const handleCameraScanSuccess = (decodedText: string) => {
    const clean = decodedText.trim().toLowerCase();
    const matched = products.find(
      (p) =>
        (p.barcode && p.barcode.trim().toLowerCase() === clean) ||
        (p.sku && p.sku.trim().toLowerCase() === clean) ||
        p.id.toLowerCase() === clean
    );

    if (matched) {
      addToCart(matched, 1);
      setShowCameraScanner(false);
      setScannerFeedback(`"${matched.name}" sepete eklendi!`);
      setTimeout(() => setScannerFeedback(null), 3000);
    } else {
      setError(`Okutulan kod sistemde kayıtlı değil: ${decodedText}`);
    }
  };

  const updateCartQuantity = (productId: string, newQty: number, rollId?: string, boxId?: string) => {
    setError(null);
    setCurrentIdempotencyKey(null);
    const cartItem = cart.find(
      (item) => item.product.id === productId && item.selectedRollId === rollId && item.selectedBoxId === boxId
    );
    if (!cartItem) return;

    const roundedQty = roundQty(newQty);
    if (roundedQty <= 0) {
      removeFromCart(productId, rollId, boxId);
      return;
    }

    if (cartItem.selectedBoxId) {
      const box = cartItem.product.boxes?.find(b => b.id === cartItem.selectedBoxId);
      if (box && box.quantity < roundedQty) {
        setError(`Kolide yeterli adet yok! Maksimum: ${box.quantity}`);
        return;
      }
    } else if (cartItem.product.stock < roundedQty) {
      setError(`${cartItem.product.name} için stok yetersiz! Maksimum stok: ${cartItem.product.stock}`);
      return;
    }

    setCart(
      cart.map((item) =>
        item.product.id === productId && item.selectedRollId === rollId && item.selectedBoxId === boxId
          ? { ...item, quantity: roundedQty }
          : item
      )
    );
  };

  const removeFromCart = (productId: string, rollId?: string, boxId?: string) => {
    setCurrentIdempotencyKey(null);
    setCart(
      cart.filter(
        (item) => !(item.product.id === productId && item.selectedRollId === rollId && item.selectedBoxId === boxId)
      )
    );
  };

  const cartTotal = cart.reduce((sum, item) => {
    const qty = item.cutLength !== undefined ? item.cutLength : item.quantity;
    return sum + item.product.price * qty;
  }, 0);

  // Auto initialize amountPaid when cart changes or customer selection changes
  useEffect(() => {
    setAmountPaid(cartTotal.toString());
  }, [cartTotal, selectedCustomerId]);

  const handleCheckout = async () => {
    setError(null);
    setSuccess(false);

    if (isSubmitting) return;

    if (cart.length === 0) {
      setError("Sepetiniz boş.");
      return;
    }

    const paidVal = amountPaid === "" ? cartTotal : Number(amountPaid);
    if (isNaN(paidVal) || paidVal < 0) {
      setError("Lütfen geçerli bir ödeme miktarı girin.");
      return;
    }

    if (selectedCustomerId === "" && paidVal < cartTotal) {
      setError("Anonim (peşin) satışlarda eksik ödeme girilemez. Veresiye kaydetmek için lütfen bir müşteri seçin.");
      return;
    }

    const activeKey = currentIdempotencyKey || `sale_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").substring(0, 12)}`;
    if (!currentIdempotencyKey) {
      setCurrentIdempotencyKey(activeKey);
    }

    setIsSubmitting(true);

    try {
      const itemsPayload = cart.map((item) => ({
        productId: item.product.id,
        quantity: item.cutLength !== undefined ? item.cutLength : item.quantity,
        selectedRollId: item.selectedRollId,
        cutLength: item.cutLength,
        selectedBoxId: item.selectedBoxId,
      }));

      const result = await onRecordSale(
        itemsPayload, 
        selectedCustomerId || undefined, 
        paidVal,
        activeKey,
        paymentMethod
      );

      // Create local Sale object for Receipt Print Modal
      const recordedSale: Sale = result || {
        id: activeKey,
        items: cart.map(i => ({
          productId: i.product.id,
          productName: i.product.name,
          name: i.product.name,
          quantity: i.cutLength !== undefined ? i.cutLength : i.quantity,
          price: i.product.price,
          selectedRollId: i.selectedRollId,
          cutLength: i.cutLength,
          selectedBoxId: i.selectedBoxId,
          selectedBoxNumber: i.selectedBoxNumber,
          unit: i.unit
        })),
        totalAmount: cartTotal,
        amountPaid: paidVal,
        paymentMethod: paymentMethod === "kredi_karti" ? "Kredi Kartı" : paymentMethod === "havale" ? "Havale / EFT" : "Nakit",
        timestamp: new Date().toISOString(),
        customerId: selectedCustomerId || undefined
      };

      setCompletedSale(recordedSale);
      setCart([]);
      setSelectedCustomerId("");
      setAmountPaid("");
      setPaymentMethod("nakit");
      setCurrentIdempotencyKey(null);
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Satış tamamlanamadı.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(val);
  };

  const calculatedDebt = selectedCustomerId && amountPaid 
    ? Math.max(0, cartTotal - (Number(amountPaid) || 0)) 
    : 0;

  return (
    <div className="space-y-6 animate-fade-in" id="quick-sale-root">
      {/* Receipt Print Modal */}
      {showReceiptModal && completedSale && (
        <ReceiptPrintModal
          sale={completedSale}
          products={products}
          onClose={() => setShowReceiptModal(false)}
        />
      )}

      {/* Success Notification with Immediate Print Action */}
      {success && completedSale && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-xl shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
            <div>
              <span className="font-bold text-sm block">Satış Başarıyla Tamamlandı!</span>
              <span className="text-xs text-emerald-600">
                Fiş #{completedSale.id} — Toplam: {formatCurrency(completedSale.totalAmount)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setShowReceiptModal(true)}
              className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Fiş / Makbuz Yazdır (Termal)</span>
            </button>
            <button
              type="button"
              onClick={() => setSuccess(false)}
              className="p-2 text-emerald-600 hover:text-emerald-800 rounded-lg hover:bg-emerald-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Grid: Catalog / Selector & Cart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (Catalog & Product Configuration): 7 cols */}
        <div className="lg:col-span-7 space-y-4">
          {/* Search & Category Filter Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-800 text-sm tracking-wide uppercase">Ürün Kataloğu & Satış</h3>
              </div>
              <span className="text-xs font-bold text-slate-400">
                {displayedProducts.length} Ürün Mevcut
              </span>
            </div>

            {/* Search Input & Camera */}
            <div className="relative flex items-center">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Barkod okutun veya ürün adı yazın..."
                className="w-full pl-10 pr-24 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 font-medium"
              />
              <button
                type="button"
                onClick={() => setShowCameraScanner(true)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-md text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                title="Kamera ile barkod okut"
              >
                <Camera className="w-3.5 h-3.5" />
                <span className="text-[11px]">Kamera</span>
              </button>
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-lg font-bold text-xs whitespace-nowrap transition-all cursor-pointer ${
                    selectedCategory === cat
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {cat === "all" ? "Tüm Ürünler" : cat}
                </button>
              ))}
            </div>
          </div>

          {/* Active Product Configuration Modal/Card */}
          {selectedProduct && (
            <div className="bg-white p-5 rounded-xl border-2 border-indigo-500 shadow-md space-y-4 animate-fade-in relative">
              <button
                type="button"
                onClick={() => setSelectedProduct(null)}
                className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex justify-between items-start pr-8">
                <div>
                  <span className="text-[10px] font-bold uppercase text-indigo-600 tracking-wider bg-indigo-50 px-2 py-0.5 rounded">
                    {selectedProduct.category || "Genel"}
                  </span>
                  <h4 className="text-base font-bold text-slate-800 mt-1">{selectedProduct.name}</h4>
                  <span className="text-xs text-slate-400 font-mono">Birim Fiyat: {formatCurrency(selectedProduct.price)}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Mevcut Stok</span>
                  <span className="text-lg font-black text-slate-800 block">
                    {selectedProduct.stock} {selectedProduct.unit || "Adet"}
                  </span>
                </div>
              </div>

              {/* 1. KUMAŞ RULO SEÇİMİ */}
              {((selectedProduct.category?.toLowerCase() === "kumaş" || selectedProduct.category?.toLowerCase() === "kumas") || (selectedProduct.rolls && selectedProduct.rolls.length > 0)) && (
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-3 text-xs">
                  <span className="font-bold text-slate-700 flex items-center gap-1.5 border-b border-slate-200 pb-1.5">
                    <Scissors className="w-4 h-4 text-indigo-600" />
                    Kumaş Topu / Rulo Seçimi
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Top / Rulo Seçimi</label>
                      <select
                        value={selectedRollId}
                        onChange={(e) => {
                          const rollId = e.target.value;
                          setSelectedRollId(rollId);
                          const matchedRoll = selectedProduct.rolls?.find(r => r.id === rollId);
                          if (matchedRoll) {
                            setCutLength(String(matchedRoll.length));
                            setQuantity(Math.ceil(matchedRoll.length));
                          } else {
                            setCutLength("");
                            setQuantity(1);
                          }
                        }}
                        className="w-full p-2 border border-slate-200 rounded-lg bg-white focus:outline-none text-xs font-medium"
                      >
                        <option value="">Otomatik Sıralı Eksiltme (FIFO - En Eski Top)</option>
                        {selectedProduct.rolls
                          ?.filter((r) => r.status === "available" && r.length > 0)
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.rollNumber} {r.colorName ? `(${r.colorName})` : ""} - Kalan: {r.length} m
                            </option>
                          ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                        Kesim Boyu (Metre)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={cutLength}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCutLength(val);
                          const parsedVal = parseFloat(val);
                          if (!isNaN(parsedVal) && parsedVal > 0) {
                            setQuantity(Math.ceil(parsedVal));
                          }
                        }}
                        placeholder={`Maks: ${
                          selectedRollId 
                            ? (selectedProduct.rolls?.find(r => r.id === selectedRollId)?.length || selectedProduct.stock) 
                            : selectedProduct.stock
                        } m`}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                      />
                    </div>
                  </div>
                  <span className="text-[10px] text-indigo-600 block leading-tight font-medium">
                    Belirli bir top seçildiğinde o toptan kesim yapılır; seçilmezse en eski toplardan sıralı düşülür.
                  </span>
                </div>
              )}

              {/* 2. KOLİ / KUPON SEÇİMİ */}
              {selectedProduct.boxes && selectedProduct.boxes.length > 0 && (
                <div className="bg-amber-50/60 p-3.5 rounded-xl border border-amber-200 space-y-3 text-xs">
                  <span className="font-bold text-amber-900 flex items-center gap-1.5 border-b border-amber-200 pb-1.5">
                    <Package className="w-4 h-4 text-amber-600" />
                    Koli / Kupon Paket Seçimi
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Giriş Yapılan Koli</label>
                      <select
                        value={selectedBoxId}
                        onChange={(e) => setSelectedBoxId(e.target.value)}
                        className="w-full p-2 border border-amber-200 rounded-lg bg-white focus:outline-none text-xs font-medium"
                      >
                        <option value="">Otomatik Sıralı Koli (FIFO)</option>
                        {selectedProduct.boxes
                          ?.filter((b) => b.status === "available" && b.quantity > 0)
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.boxNumber} - Kalan: {b.quantity} adet
                            </option>
                          ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                        Satış Adedi
                      </label>
                      <div className="flex items-center bg-white border border-amber-200 rounded-lg p-1">
                        <button
                          type="button"
                          onClick={() => setQuantity(Math.max(1, quantity - 1))}
                          className="p-1 rounded hover:bg-slate-100 text-slate-500"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="number"
                          min="1"
                          max={selectedBoxId ? (selectedProduct.boxes.find(b => b.id === selectedBoxId)?.quantity || selectedProduct.stock) : selectedProduct.stock}
                          value={quantity}
                          onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                          className="flex-1 text-xs font-bold text-center bg-transparent outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setQuantity(quantity + 1)}
                          className="p-1 rounded hover:bg-slate-100 text-slate-500"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {selectedProduct.metersPerUnit && selectedProduct.metersPerUnit > 0 && (
                    <div className="bg-white p-2.5 rounded-lg border border-amber-200 flex items-center justify-between">
                      <span className="text-[11px] text-slate-600 font-medium">
                        Kupon Eşdeğeri: <strong className="text-amber-800">{selectedProduct.metersPerUnit} m / adet</strong>
                      </span>
                      <span className="text-xs font-bold text-amber-700">
                        {roundQty(quantity * selectedProduct.metersPerUnit)} Metre Kumaş
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 3. STANDART MİKTAR SEÇİMİ (Kumaş veya Koli değilse) */}
              {!(selectedProduct.category?.toLowerCase() === "kumaş" || selectedProduct.category?.toLowerCase() === "kumas") &&
               !(selectedProduct.boxes && selectedProduct.boxes.length > 0) && (
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Satış Miktarı {selectedProduct.unit ? `(${selectedProduct.unit})` : ""}
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1 max-w-[140px]">
                      <button
                        type="button"
                        onClick={() => {
                          const step = (selectedProduct.unit?.toLowerCase() === "kg" || selectedProduct.unit?.toLowerCase() === "litre") ? 0.5 : 1;
                          setQuantity(Math.max(step, roundQty(quantity - step)));
                        }}
                        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 active:scale-90 transition-all cursor-pointer"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        max={selectedProduct.stock}
                        value={quantity}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (!isNaN(val) && val > 0) {
                            setQuantity(val);
                          } else if (e.target.value === "") {
                            setQuantity(0 as any);
                          }
                        }}
                        onBlur={() => {
                          if (!quantity || quantity <= 0) setQuantity(1);
                        }}
                        className="flex-1 text-sm font-bold text-slate-700 text-center w-14 bg-transparent outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const step = (selectedProduct.unit?.toLowerCase() === "kg" || selectedProduct.unit?.toLowerCase() === "litre") ? 0.5 : 1;
                          setQuantity(Math.min(selectedProduct.stock, roundQty(quantity + step)));
                        }}
                        className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 active:scale-90 transition-all cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {selectedProduct.unit && (
                      <span className="text-xs font-semibold text-slate-500">
                        {selectedProduct.unit}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => addToCart(selectedProduct, quantity)}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-lg transition-all shadow-sm cursor-pointer flex items-center justify-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Sepete Ekle — {formatCurrency(selectedProduct.price * (cutLength ? parseFloat(cutLength) : quantity))}</span>
              </button>
            </div>
          )}

          {/* Product Touch Cards Grid (Mobile/Touch Friendly) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto pr-1">
            {displayedProducts.length === 0 ? (
              <div className="col-span-full py-12 text-center bg-white rounded-xl border border-slate-200">
                <Search className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-500 font-bold">Aramanıza uygun ürün bulunamadı.</p>
              </div>
            ) : (
              displayedProducts.map((p) => {
                const isFabric = p.category?.toLowerCase() === "kumaş" || p.category?.toLowerCase() === "kumas" || (p.rolls && p.rolls.length > 0);
                const hasBoxes = p.boxes && p.boxes.length > 0;

                return (
                  <div
                    key={p.id}
                    onClick={() => selectProductToConfigure(p)}
                    className="bg-white p-3 rounded-xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group active:scale-98"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wider truncate">
                          {p.category || "Genel"}
                        </span>
                        {isFabric && (
                          <span className="text-[9px] bg-indigo-50 text-indigo-700 font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <Scissors className="w-2.5 h-2.5" />
                            Rulo
                          </span>
                        )}
                        {hasBoxes && (
                          <span className="text-[9px] bg-amber-50 text-amber-700 font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5">
                            <Package className="w-2.5 h-2.5" />
                            Koli
                          </span>
                        )}
                      </div>
                      <h5 className="text-xs font-bold text-slate-800 line-clamp-2 leading-tight group-hover:text-indigo-600 transition-colors">
                        {p.name}
                      </h5>
                      {p.sku && (
                        <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                          {p.sku}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-xs font-black text-slate-800">
                        {formatCurrency(p.price)}
                      </span>
                      <span className={`text-[10px] font-bold ${p.stock <= p.minStock ? "text-rose-500" : "text-emerald-600"}`}>
                        {p.stock} {p.unit || (isFabric ? "m" : "ad")}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column (Cart, CRM, Checkout): 5 cols */}
        <div className="lg:col-span-5 space-y-4">
          {error && (
            <div className="bg-rose-50 text-rose-600 text-xs p-3 rounded-xl border border-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-[400px]">
            {/* Cart Header */}
            <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex justify-between items-center rounded-t-xl">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-indigo-600" />
                <span className="font-bold text-slate-800 text-xs uppercase tracking-wider">Satış Sepeti</span>
                <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.2 rounded-full">
                  {cart.length}
                </span>
              </div>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors uppercase tracking-wider"
                >
                  Temizle
                </button>
              )}
            </div>

            {/* Cart Items List */}
            <div className="flex-1 divide-y divide-slate-100 overflow-y-auto max-h-[260px]">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center h-full">
                  <ShoppingCart className="w-10 h-10 text-slate-300 mb-2" />
                  <span className="text-xs font-bold text-slate-600">Sepetiniz Boş</span>
                  <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                    Soldaki listeden ürün seçerek sepete ekleyin ve satışı tamamlayın.
                  </p>
                </div>
              ) : (
                cart.map((item, idx) => {
                  const uniqueKey = `${item.product.id}-${item.selectedRollId || "auto"}-${item.selectedBoxId || "none"}-${idx}`;
                  const itemQty = item.cutLength !== undefined ? item.cutLength : item.quantity;
                  const rollInfo = item.selectedRollId 
                    ? item.product.rolls?.find(r => r.id === item.selectedRollId) 
                    : null;
                  const boxInfo = item.selectedBoxId
                    ? item.product.boxes?.find(b => b.id === item.selectedBoxId)
                    : null;

                  return (
                    <div key={uniqueKey} className="p-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-bold text-slate-800 block truncate">{item.product.name}</span>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span className="text-[11px] text-slate-400 font-mono">
                            {formatCurrency(item.product.price)}
                          </span>
                          {rollInfo && (
                            <span className="text-[9px] bg-indigo-50 text-indigo-700 font-bold px-1 py-0.5 rounded flex items-center gap-0.5">
                              <Scissors className="w-2.5 h-2.5" />
                              {rollInfo.rollNumber} ({item.cutLength}m)
                            </span>
                          )}
                          {boxInfo && (
                            <span className="text-[9px] bg-amber-50 text-amber-800 font-bold px-1 py-0.5 rounded flex items-center gap-0.5">
                              <Package className="w-2.5 h-2.5" />
                              {boxInfo.boxNumber}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        {item.cutLength !== undefined ? (
                          <div className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                            {item.cutLength}m
                          </div>
                        ) : (
                          <div className="flex items-center bg-slate-50 border border-slate-200 rounded p-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                const step = (item.product.unit?.toLowerCase() === "kg" || item.product.unit?.toLowerCase() === "litre") ? 0.5 : 1;
                                updateCartQuantity(item.product.id, roundQty(item.quantity - step), item.selectedRollId, item.selectedBoxId);
                              }}
                              className="p-1 hover:bg-white text-slate-500 rounded"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-8 text-[11px] font-bold text-center text-slate-800">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const step = (item.product.unit?.toLowerCase() === "kg" || item.product.unit?.toLowerCase() === "litre") ? 0.5 : 1;
                                updateCartQuantity(item.product.id, roundQty(item.quantity + step), item.selectedRollId, item.selectedBoxId);
                              }}
                              className="p-1 hover:bg-white text-slate-500 rounded"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        <span className="text-xs font-bold text-slate-800 min-w-[65px] text-right">
                          {formatCurrency(item.product.price * itemQty)}
                        </span>

                        <button
                          type="button"
                          onClick={() => removeFromCart(item.product.id, item.selectedRollId, item.selectedBoxId)}
                          className="text-slate-300 hover:text-rose-500 transition-colors p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* CRM & Payment Options */}
            {cart.length > 0 && (
              <div className="p-3.5 bg-slate-50 border-t border-slate-200 space-y-2.5 text-xs">
                {/* Customer selector */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1 flex items-center gap-1">
                    <User className="w-3 h-3 text-indigo-500" />
                    Müşteri (Veresiye / Cari Hesap)
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                  >
                    <option value="">-- Peşin / Anonim Satış --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Payment Method & Paid Amount in 2 cols */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1 flex items-center gap-1">
                      <CreditCard className="w-3 h-3 text-indigo-500" />
                      Ödeme Tipi
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                    >
                      <option value="nakit">Nakit</option>
                      <option value="kredi_karti">Kredi Kartı</option>
                      <option value="havale">Havale / EFT</option>
                      <option value="cek">Çek</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1 flex items-center gap-1">
                      <DollarSign className="w-3 h-3 text-emerald-500" />
                      Ödenen (₺)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      max={cartTotal}
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none font-bold text-emerald-600 font-mono"
                    />
                  </div>
                </div>

                {calculatedDebt > 0 && (
                  <span className="text-[10px] text-rose-500 font-bold block">
                    Müşteri Hesabına Borç: {formatCurrency(calculatedDebt)}
                  </span>
                )}
              </div>
            )}

            {/* Total and Checkout Button */}
            <div className="p-4 bg-slate-50/80 border-t border-slate-200 rounded-b-xl flex items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Toplam Tutar</span>
                <span className="text-xl font-black text-indigo-600">{formatCurrency(cartTotal)}</span>
              </div>

              <button
                type="button"
                onClick={handleCheckout}
                disabled={cart.length === 0 || isSubmitting}
                className={`px-6 py-2.5 rounded-lg font-bold text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer ${
                  cart.length === 0 || isSubmitting
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-100 active:scale-95"
                }`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>İşleniyor...</span>
                  </>
                ) : (
                  <span>Satışı Tamamla</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Camera Barcode Scanner Modal */}
      {showCameraScanner && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl border border-slate-200 relative animate-fade-in">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <BarcodeIcon className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-800 text-sm">Satış İçin Barkod / QR Okut</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCameraScanner(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <QRScanner onScanSuccess={handleCameraScanSuccess} />
          </div>
        </div>
      )}
    </div>
  );
}
