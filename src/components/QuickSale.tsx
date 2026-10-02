import { useState, useEffect } from "react";
import { Product, CartItem, Customer } from "../types";
import { auth } from "../lib/firebase";
import { getCustomers } from "../lib/firestoreService";
import { 
  ShoppingCart, 
  Search, 
  Plus, 
  Minus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  UserCheck, 
  CreditCard,
  User,
  DollarSign,
  Scissors,
  Layers
} from "lucide-react";

interface QuickSaleProps {
  products: Product[];
  onRecordSale: (items: { productId: string; quantity: number; selectedRollId?: string; cutLength?: number }[], customerId?: string, amountPaid?: number) => Promise<void>;
}

export function QuickSale({ products, onRecordSale }: QuickSaleProps) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Roll selection states
  const [selectedRollId, setSelectedRollId] = useState<string>("");
  const [cutLength, setCutLength] = useState<string>("");

  // CRM integration states
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [amountPaid, setAmountPaid] = useState<string>("");
  const [isCrmLoading, setIsCrmLoading] = useState(false);

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
  }, [success]); // re-fetch when sales success to ensure clean data

  // Filter products for suggestions dropdown
  const suggestions = products.filter((p) => {
    if (!search) return false;
    return (
      p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase())
    );
  });

  const addToCart = (product: Product, qty: number) => {
    setError(null);
    setSuccess(false);

    const isFabric = product.category?.toLowerCase() === "kumaş" || product.category?.toLowerCase() === "kumas";
    const finalRollId = isFabric && selectedRollId ? selectedRollId : undefined;
    const finalCutLength = isFabric && cutLength ? parseFloat(cutLength) : undefined;

    // Validate stock limit on the specific roll if selected
    if (finalRollId) {
      const selectedRoll = product.rolls?.find(r => r.id === finalRollId);
      if (selectedRoll) {
        const requiredAmt = finalCutLength || qty;
        if (selectedRoll.length < requiredAmt) {
          setError(`Seçilen topta yeterli kumaş yok! Kalan: ${selectedRoll.length} m`);
          return;
        }
      }
    } else {
      if (product.stock < qty) {
        setError(`Stok yetersiz! Mevcut stok: ${product.stock}`);
        return;
      }
    }

    const existingIndex = cart.findIndex(
      (item) => 
        item.product.id === product.id && 
        item.selectedRollId === finalRollId
    );

    if (existingIndex !== -1) {
      const currentQtyInCart = cart[existingIndex].quantity;
      const updatedCart = [...cart];
      
      if (finalCutLength) {
        const newCutLen = (updatedCart[existingIndex].cutLength || 0) + finalCutLength;
        // Check if exceeds roll stock
        if (finalRollId) {
          const selectedRoll = product.rolls?.find(r => r.id === finalRollId);
          if (selectedRoll && selectedRoll.length < newCutLen) {
            setError(`Seçilen topta yeterli kumaş yok! Toplam istenen: ${newCutLen} m`);
            return;
          }
        }
        updatedCart[existingIndex].cutLength = newCutLen;
        updatedCart[existingIndex].quantity = Math.ceil(newCutLen);
      } else {
        if (product.stock < currentQtyInCart + qty) {
          setError(`Stok limiti aşılıyor! Maksimum: ${product.stock}`);
          return;
        }
        updatedCart[existingIndex].quantity += qty;
      }
      setCart(updatedCart);
    } else {
      setCart([
        ...cart,
        {
          product,
          quantity: finalCutLength ? Math.ceil(finalCutLength) : qty,
          selectedRollId: finalRollId,
          cutLength: finalCutLength
        }
      ]);
    }

    // Reset selection
    setSearch("");
    setSelectedProduct(null);
    setQuantity(1);
    setSelectedRollId("");
    setCutLength("");
  };

  const updateCartQuantity = (productId: string, newQty: number) => {
    setError(null);
    const cartItem = cart.find((item) => item.product.id === productId);
    if (!cartItem) return;

    if (newQty <= 0) {
      removeFromCart(productId);
      return;
    }

    if (cartItem.product.stock < newQty) {
      setError(`${cartItem.product.name} için stok yetersiz! Maksimum stok: ${cartItem.product.stock}`);
      return;
    }

    setCart(cart.map((item) => (item.product.id === productId ? { ...item, quantity: newQty } : item)));
  };

  const removeFromCart = (productId: string, rollId?: string) => {
    setCart(cart.filter((item) => !(item.product.id === productId && item.selectedRollId === rollId)));
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

    try {
      const itemsPayload = cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        selectedRollId: item.selectedRollId,
        cutLength: item.cutLength,
      }));

      await onRecordSale(
        itemsPayload, 
        selectedCustomerId || undefined, 
        paidVal
      );
      
      setCart([]);
      setSelectedCustomerId("");
      setAmountPaid("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 5000);
    } catch (err: any) {
      setError(err.message || "Satış tamamlanamadı.");
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(val);
  };

  const calculatedDebt = selectedCustomerId && amountPaid 
    ? Math.max(0, cartTotal - (Number(amountPaid) || 0)) 
    : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in" id="quick-sale-root">
      {/* Left panel: Add item */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-slate-800 border-b border-slate-100 pb-2">
            <ShoppingCart className="w-5 h-5 text-indigo-500" />
            <h3 className="font-bold text-slate-800 text-sm tracking-wide uppercase">Ürün Ekle</h3>
          </div>

          <div className="relative">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Ürün veya Barkod / SKU Ara</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Örn: Pamuk Kumaş veya Barkod..."
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50"
              />
            </div>

            {/* Suggestions list */}
            {suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-52 overflow-y-auto divide-y divide-slate-100">
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedProduct(p);
                      setSearch(p.name);
                    }}
                    className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors flex justify-between items-center"
                  >
                    <div>
                      <span className="text-sm font-bold text-slate-800 block">{p.name}</span>
                      <span className="text-xs font-medium text-slate-400 font-mono">SKU: {p.sku}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold text-slate-800 block">{formatCurrency(p.price)}</span>
                      <span className={`text-[10px] font-bold ${p.stock <= p.minStock ? 'text-rose-500' : 'text-emerald-500'}`}>Stok: {p.stock} adet</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedProduct && (
            <div className="bg-slate-50 rounded-lg p-4 border border-slate-200 space-y-4 animate-fade-in">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-bold uppercase text-indigo-600 tracking-wider bg-indigo-50 px-2 py-0.5 rounded">
                    {selectedProduct.category}
                  </span>
                  <span className="text-sm font-bold text-slate-800 block mt-1">{selectedProduct.name}</span>
                  <span className="text-xs text-slate-400 font-mono">Birim Fiyat: {formatCurrency(selectedProduct.price)}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Mevcut Stok</span>
                  <span className="text-base font-bold text-slate-800 block">{selectedProduct.stock} Adet</span>
                </div>
              </div>

              {/* Roll selection for Fabric products */}
              {(selectedProduct.category?.toLowerCase() === "kumaş" || selectedProduct.category?.toLowerCase() === "kumas") && (
                <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-3 text-xs">
                  <span className="font-bold text-slate-700 block flex items-center gap-1 border-b border-slate-100 pb-1.5">
                    <Scissors className="w-3.5 h-3.5 text-indigo-500" />
                    Kumaş Topu / Rulo Seçin
                  </span>
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
                      className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 focus:outline-none"
                    >
                      <option value="">Otomatik Sıralı Eksiltme (En Eski Top)</option>
                      {selectedProduct.rolls
                        ?.filter((r) => r.status === "available" && r.length > 0)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.rollNumber} - Kalan: {r.length} m
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
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                    />
                    <span className="text-[9px] text-indigo-500 block mt-1 leading-normal font-semibold">
                      Spesifik rulo seçtiğinizde bu top üzerinden girilen metre kadar kesim yapılıp satılır.
                    </span>
                  </div>
                </div>
              )}

              {/* Only show standard quantity if NOT fabric or if no custom cutLength is active */}
              {!(selectedProduct.category?.toLowerCase() === "kumaş" || selectedProduct.category?.toLowerCase() === "kumas") && (
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1">Satış Miktarı</label>
                  <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1 max-w-[120px]">
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.max(1, quantity - 1))}
                      className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 active:scale-90 transition-all"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="flex-1 text-sm font-bold text-slate-700 text-center">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity(Math.min(selectedProduct.stock, quantity + 1))}
                      className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500 active:scale-90 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => addToCart(selectedProduct, quantity)}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-lg transition-all cursor-pointer"
              >
                Sepete Ekle — {formatCurrency(selectedProduct.price * (cutLength ? parseFloat(cutLength) : quantity))}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Checkout & CRM Link */}
      <div className="lg:col-span-2 space-y-4">
        {/* Error / Success Notifications */}
        {error && (
          <div className="bg-rose-50 text-rose-600 text-xs p-3 rounded-lg border border-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 text-emerald-600 text-xs p-3 rounded-lg border border-emerald-200 flex items-center gap-2 animate-pulse">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>Satış başarıyla tamamlandı, stoklar envanterden düşüldü!</span>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col min-h-[300px]">
          <div className="p-4 bg-slate-50/50 border-b border-slate-200 flex justify-between items-center rounded-t-xl">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-indigo-500" />
              <span className="font-bold text-slate-800 text-xs uppercase tracking-wider">Satış Sepeti</span>
            </div>
            {cart.length > 0 && (
              <button
                onClick={() => setCart([])}
                className="text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors uppercase tracking-wider"
              >
                Temizle
              </button>
            )}
          </div>

          {/* Cart list */}
          <div className="flex-1 divide-y divide-slate-100 overflow-y-auto max-h-[220px]">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center h-full">
                <ShoppingCart className="w-12 h-12 text-slate-300 mb-2" />
                <span className="text-sm font-bold text-slate-600">Sepetiniz Boş</span>
                <p className="text-xs text-slate-400 mt-1 max-w-xs">
                  Soldaki arama çubuğunu kullanarak sepete ürün ekleyin ve hızlıca satış kaydedin.
                </p>
              </div>
            ) : (
              cart.map((item, idx) => {
                const uniqueKey = `${item.product.id}-${item.selectedRollId || "auto"}-${idx}`;
                const itemQty = item.cutLength !== undefined ? item.cutLength : item.quantity;
                const rollInfo = item.selectedRollId 
                  ? item.product.rolls?.find(r => r.id === item.selectedRollId) 
                  : null;

                return (
                  <div key={uniqueKey} className="p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-bold text-slate-800 block truncate">{item.product.name}</span>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-slate-400 font-mono">Birim: {formatCurrency(item.product.price)}</span>
                        {rollInfo && (
                          <span className="text-[10px] bg-indigo-50 text-indigo-700 font-black px-1.5 py-0.5 rounded flex items-center gap-0.5 font-mono">
                            <Layers className="w-2.5 h-2.5" />
                            {rollInfo.rollNumber} ({item.cutLength}m)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 flex-shrink-0">
                      {/* For fabric custom cuts, standard increment/decrement is disabled as it is a precise piece, only removal or re-adding is preferred */}
                      {item.cutLength !== undefined ? (
                        <div className="text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200">
                          {item.cutLength} Metre Kesim
                        </div>
                      ) : (
                        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5">
                          <button
                            type="button"
                            onClick={() => updateCartQuantity(item.product.id, item.quantity - 1)}
                            className="p-1 rounded-md hover:bg-white text-slate-500 active:scale-90 transition-all cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="px-2 text-xs font-bold text-slate-700 min-w-[16px] text-center">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateCartQuantity(item.product.id, item.quantity + 1)}
                            className="p-1 rounded-md hover:bg-white text-slate-500 active:scale-90 transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      <div className="text-right min-w-[70px]">
                        <span className="text-sm font-bold text-slate-800 block">
                          {formatCurrency(item.product.price * itemQty)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeFromCart(item.product.id, item.selectedRollId)}
                        className="text-slate-300 hover:text-rose-500 active:scale-90 transition-all cursor-pointer p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* CRM Account Association Section */}
          {cart.length > 0 && (
            <div className="p-4 bg-slate-50 border-t border-b border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1 flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-indigo-500" />
                  Satış Yapılacak Müşteri (CRM/Veresiye)
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                >
                  <option value="">-- Peşin / Anonim Satış --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.phone ? `(${c.phone})` : ""}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Veresiye borçlandırmak için sistemden bir müşteri seçmelisiniz.
                </span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                  Ödenen Tutar (₺)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  max={cartTotal}
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none font-mono font-bold text-emerald-600"
                />
                {calculatedDebt > 0 ? (
                  <span className="text-[10px] text-rose-500 font-bold mt-0.5 block animate-pulse">
                    Müşteri Veresiye Borcu: {formatCurrency(calculatedDebt)} olarak yazılacaktır.
                  </span>
                ) : (
                  <span className="text-[10px] text-emerald-600 font-semibold mt-0.5 block">
                    Ödemenin tamamı tahsil edildi (Peşin).
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Checkout pricing footer */}
          <div className="p-5 bg-slate-50 border-t border-slate-200 rounded-b-xl flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="text-center sm:text-left">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Toplam Tutar</span>
              <span className="text-2xl font-bold text-indigo-600">{formatCurrency(cartTotal)}</span>
            </div>

            <button
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className={`w-full sm:w-auto px-8 py-3 rounded-lg font-bold text-sm transition-all shadow-md active:scale-95 ${
                cart.length === 0
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-100"
              }`}
            >
              Satışı Tamamla
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
