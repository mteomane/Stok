import React, { useState, useEffect, useMemo } from "react";
import { Product, SectorSettings } from "../types";
import { round2, roundQty, getSectorSettings } from "../lib/firestoreService";
import { auth } from "../lib/firebase";
import { getSectorProfile } from "../lib/sectorConfig";
import { 
  Plus, 
  X, 
  Sparkles, 
  AlertCircle, 
  Barcode as BarcodeIcon, 
  QrCode, 
  Check, 
  Tag, 
  Package, 
  Layers, 
  DollarSign, 
  TrendingUp,
  ArrowRight
} from "lucide-react";

interface QuickProductModalProps {
  initialBarcode?: string;
  initialName?: string;
  existingProducts: Product[];
  onAddProduct: (product: Omit<Product, "id">) => Promise<void>;
  onSelectExistingProduct?: (product: Product) => void;
  onClose: () => void;
}

const COMMON_UNITS = [
  "Adet",
  "Paket",
  "Koli",
  "Kilogram",
  "Litre",
  "Metre"
];

export function QuickProductModal({
  initialBarcode,
  initialName,
  existingProducts,
  onAddProduct,
  onSelectExistingProduct,
  onClose
}: QuickProductModalProps) {
  const [name, setName] = useState(initialName || "");
  const [barcode, setBarcode] = useState(initialBarcode || "");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("Genel");
  const [price, setPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [stock, setStock] = useState("10");
  const [minStock, setMinStock] = useState("5");
  const [unit, setUnit] = useState("Adet");

  // Dynamic Sector Settings
  const [sectorSettings, setSectorSettings] = useState<SectorSettings | null>(null);
  const [attributes, setAttributes] = useState<Record<string, string>>({});

  // Packaged / sub-unit
  const [isPackaged, setIsPackaged] = useState(false);
  const [packageUnitsCount, setPackageUnitsCount] = useState("10");
  const [packageUnitName, setPackageUnitName] = useState("Adet");

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load sector settings
  useEffect(() => {
    const fetchSector = async () => {
      try {
        const uid = auth.currentUser?.uid || "demo-user";
        const settings = await getSectorSettings(uid);
        setSectorSettings(settings);
        const profile = getSectorProfile(settings?.activeSector);
        if (profile?.defaultUnit && !unit) {
          setUnit(profile.defaultUnit);
        }
      } catch (err) {
        console.warn("Failed to load sector settings in QuickProductModal", err);
      }
    };
    fetchSector();
  }, []);

  // Real-time Barcode Conflict Check within current company products
  const conflictingProduct = useMemo(() => {
    const clean = barcode.trim().toLowerCase();
    if (!clean) return null;
    return existingProducts.find(
      (p) => p.isActive !== false && (
        (p.barcode && p.barcode.trim().toLowerCase() === clean) ||
        (p.sku && p.sku.trim().toLowerCase() === clean)
      )
    ) || null;
  }, [barcode, existingProducts]);

  // Existing categories for quick suggestions
  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    existingProducts.forEach((p) => {
      if (p.category && p.category.trim()) set.add(p.category.trim());
    });
    if (set.size === 0) {
      set.add("Genel");
      set.add("Gıda");
      set.add("İçecek");
      set.add("Tekstil");
      set.add("Temizlik");
    }
    return Array.from(set);
  }, [existingProducts]);

  // Auto-generate internal store barcode (GS1 Restricted Distribution prefix 200.. with valid EAN-13 Modulo-10 checksum)
  const generateInternalBarcode = () => {
    // GS1 prefix 200-299 is internationally reserved for in-store/internal circulation (never clashes with manufacturer GTINs)
    const raw = "200" + Math.floor(Math.random() * 1000000000).toString().padStart(9, "0");
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      const digit = parseInt(raw[i], 10);
      sum += i % 2 === 0 ? digit : digit * 3;
    }
    const checksum = (10 - (sum % 10)) % 10;
    const generated = raw + checksum;
    setBarcode(generated);
    if (!sku) {
      setSku("PRD-" + generated.slice(-6));
    }
  };

  // Auto-generate clean SKU
  const generateSku = () => {
    const randomHex = Math.random().toString(36).substring(2, 8).toUpperCase();
    setSku(`PRD-${randomHex}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanName = name.trim();
    if (!cleanName) {
      setFormError("Lütfen ürün adını girin.");
      return;
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      setFormError("Lütfen geçerli bir satış fiyatı girin (0 veya daha büyük olmalı).");
      return;
    }

    const parsedStock = parseFloat(stock);
    if (isNaN(parsedStock) || parsedStock < 0) {
      setFormError("Lütfen geçerli bir stok miktarı girin (0 veya daha büyük olmalı).");
      return;
    }

    const parsedMinStock = minStock.trim() !== "" ? parseFloat(minStock) : 0;
    const parsedCost = costPrice.trim() !== "" ? parseFloat(costPrice) : undefined;

    if (parsedCost !== undefined && (isNaN(parsedCost) || parsedCost < 0)) {
      setFormError("Lütfen geçerli bir alış fiyatı girin.");
      return;
    }

    // Check conflict
    if (conflictingProduct) {
      setFormError(`Bu barkod (${barcode.trim()}) zaten '${conflictingProduct.name}' ürününde kayıtlı! Mükerrer ürün oluşturulamaz.`);
      return;
    }

    try {
      setIsSubmitting(true);
      await onAddProduct({
        name: cleanName,
        barcode: barcode.trim() || undefined,
        sku: sku.trim() || undefined as any,
        category: category.trim() || "Genel",
        unit: unit.trim() || "Adet",
        price: round2(parsedPrice),
        costPrice: parsedCost !== undefined ? round2(parsedCost) : undefined,
        stock: roundQty(parsedStock),
        minStock: !isNaN(parsedMinStock) && parsedMinStock >= 0 ? roundQty(parsedMinStock) : 0,
        attributes,
        metadata: attributes,
        isPackaged,
        packageUnitsCount: isPackaged ? parseInt(packageUnitsCount, 10) : undefined,
        packageUnitName: isPackaged ? packageUnitName.trim() : undefined,
        subUnitStock: isPackaged ? parseFloat(packageUnitsCount) : undefined
      });

      onClose();
    } catch (err: any) {
      setFormError(err.message || "Ürün eklenirken bir hata oluştu.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg p-5 sm:p-6 shadow-2xl border border-slate-200 animate-fade-in flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex justify-between items-start border-b border-slate-100 pb-3 mb-4">
          <div>
            <h3 className="font-extrabold text-slate-800 text-lg sm:text-xl flex items-center gap-2">
              <Plus className="w-5 h-5 text-indigo-600" />
              <span>{initialBarcode ? "Yeni Barkodlu Ürün Ekle" : "Hızlı Ürün Ekle"}</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {initialBarcode 
                ? "Okutulan barkod için ürün detaylarını doldurun ve stoğunuza ekleyin." 
                : "Barkodlu veya barkodsuz ürününüzü birkaç saniyede kaydedin."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scanned Barcode Active Notification Banner */}
        {initialBarcode && (
          <div className="bg-indigo-50 border border-indigo-200 p-3 rounded-xl mb-4 flex items-center justify-between gap-2 text-xs text-indigo-900 shadow-2xs">
            <div className="flex items-center gap-2 min-w-0">
              <BarcodeIcon className="w-4 h-4 text-indigo-600 flex-shrink-0" />
              <div className="truncate">
                <span className="font-bold">Okutulan Barkod: </span>
                <span className="font-mono bg-white px-2 py-0.5 rounded border border-indigo-200 text-indigo-700">
                  {initialBarcode}
                </span>
              </div>
            </div>
            <span className="text-[10px] bg-indigo-600 text-white font-bold px-2 py-0.5 rounded-full flex-shrink-0">
              Yeni Kayıt
            </span>
          </div>
        )}

        {/* Barcode Duplicate Conflict Warning */}
        {conflictingProduct && (
          <div className="bg-amber-50 border border-amber-300 p-3.5 rounded-xl mb-4 text-xs text-amber-900 shadow-sm animate-fade-in">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-bold block">Bu barkod zaten sistemde kayıtlı!</span>
                <span className="text-amber-800 text-[11px] block mt-0.5">
                  <strong>"{conflictingProduct.name}"</strong> (Mevcut Stok: {conflictingProduct.stock} {conflictingProduct.unit || "Adet"}) ürünü bu barkoda sahip. Mükerrer ürün oluşturulamaz.
                </span>

                {onSelectExistingProduct && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectExistingProduct(conflictingProduct);
                    }}
                    className="mt-2.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <span>Bu Ürünün Stoğunu Artır</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {formError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3 rounded-xl mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        {/* Product Form */}
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 pr-1">
          {/* 1. Product Name */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Ürün Adı *
            </label>
            <input
              type="text"
              required
              autoFocus={!initialBarcode}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn: Pepsi 330ml Kutu, Pamuk Poplin Kumaş, Fren Balatası..."
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50 focus:bg-white transition-all"
            />
          </div>

          {/* 2. Barcode & Auto Generate */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <BarcodeIcon className="w-4 h-4 text-slate-400" />
                <span>Ürün Barkodu (Global GTIN/EAN)</span>
              </label>

              <button
                type="button"
                onClick={generateInternalBarcode}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-white hover:bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200 transition-colors cursor-pointer flex items-center gap-1"
                title="İşletme içi kullanım için GS1 standartlarına uygun dahili (200..) EAN-13 barkod oluşturur"
              >
                <Sparkles className="w-3 h-3 text-indigo-500" />
                <span>Dahili Barkod (200..)</span>
              </button>
            </div>

            <input
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Paket üstündeki barkodu okutun veya boş bırakın"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-[10px] text-slate-400">
              Barkodsuz yerel ürünler için boş bırakabilirsiniz; sistem otomatik dahili stok kodu (SKU) atar.
            </p>
          </div>

          {/* 3. Unit Selector (Quick Chips + Input) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">Takip Birimi *</label>
              <span className="text-[11px] text-slate-400">Seçilen: <strong>{unit}</strong></span>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-2">
              {COMMON_UNITS.map((u) => (
                <button
                  type="button"
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    unit === u
                      ? "bg-indigo-600 text-white shadow-2xs"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Farklı bir birim yazın (örn: Top, Koli, Çuval...)"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* 4. Price & Stock Inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Satış Fiyatı (₺) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="45.00"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Giriş Stoğu *
              </label>
              <input
                type="number"
                step="any"
                min="0"
                required
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="10"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">
                Alış Fiyatı (₺)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="İsteğe bağlı"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">
                Min. Stok
              </label>
              <input
                type="number"
                step="any"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder="5"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white"
              />
            </div>
          </div>

          {/* 5. Category & Internal SKU */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">Kategori</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Genel, İçecek, Kumaş..."
                list="category-suggestions"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <datalist id="category-suggestions">
                {existingCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-600">Dahili Kod / SKU</label>
                <button
                  type="button"
                  onClick={generateSku}
                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                >
                  Kod Üret
                </button>
              </div>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Boş bırakılırsa otomatik üretilir"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-mono bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* 6. Dynamic Sector Custom Fields if configured */}
          {sectorSettings && sectorSettings.customFields && sectorSettings.customFields.length > 0 && (
            <div className="bg-indigo-50/40 p-3 rounded-xl border border-indigo-150 space-y-2">
              <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-500" />
                Sektörel Özellikler ({getSectorProfile(sectorSettings.activeSector).name})
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {sectorSettings.customFields.map((field) => (
                  <div key={field.key}>
                    <label className="text-[11px] font-bold text-slate-600 block mb-0.5">{field.label}</label>
                    <input
                      type={field.type}
                      value={attributes[field.key] || ""}
                      onChange={(e) => setAttributes({ ...attributes, [field.key]: e.target.value })}
                      placeholder={`${field.label} girin`}
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7. Packaged Sub-unit Option */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPackaged}
                onChange={(e) => setIsPackaged(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
              />
              <span className="text-xs font-bold text-slate-700">Bu ürün paketli / koli içi kısmi satışa uygun</span>
            </label>

            {isPackaged && (
              <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Paket İçi Adet</label>
                  <input
                    type="number"
                    value={packageUnitsCount}
                    onChange={(e) => setPackageUnitsCount(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 block mb-0.5">Alt Birim Adı</label>
                  <input
                    type="text"
                    value={packageUnitName}
                    onChange={(e) => setPackageUnitName(e.target.value)}
                    placeholder="Adet, Şişe..."
                    className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !!conflictingProduct}
              className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 active:scale-98 transition-all cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              <span>{isSubmitting ? "Kaydediliyor..." : "Ürünü Kaydet ve Stoğa Ekle"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
