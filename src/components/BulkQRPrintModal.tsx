import React, { useState, useEffect } from "react";
import { Product, CompanyInfo } from "../types";
import { QRImage } from "./QRImage";
import { 
  Printer, 
  X, 
  CheckSquare, 
  Square, 
  Tag, 
  Sliders, 
  Check, 
  Package, 
  Building2,
  HelpCircle
} from "lucide-react";
import { auth } from "../lib/firebase";
import { getCompanyInfo } from "../lib/firestoreService";

interface BulkQRPrintModalProps {
  products: Product[];
  initialSelectedIds?: string[];
  onClose: () => void;
}

export function BulkQRPrintModal({
  products,
  initialSelectedIds,
  onClose
}: BulkQRPrintModalProps) {
  // Selected products state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (initialSelectedIds && initialSelectedIds.length > 0) {
      return new Set(initialSelectedIds);
    }
    // Default to all products
    return new Set(products.map((p) => p.id));
  });

  // Quantity strategy per product
  const [quantityMode, setQuantityMode] = useState<"single" | "stock" | "custom">("single");
  const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});

  // Layout preset: 
  // - "3x8": 24 labels per A4 page
  // - "2x5": 10 labels per A4 page
  // - "4x10": 40 labels per A4 page (mini tags)
  // - "thermal": Continuous roll / thermal label
  const [layoutPreset, setLayoutPreset] = useState<"3x8" | "2x5" | "4x10" | "thermal">("3x8");

  // Display fields options
  const [showCompanyName, setShowCompanyName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showSkuText, setShowSkuText] = useState(true);
  const [showCategory, setShowCategory] = useState(true);
  const [showAttributes, setShowAttributes] = useState(true);

  // Company Info for label header
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);

  useEffect(() => {
    const fetchCompany = async () => {
      try {
        const uid = auth.currentUser?.uid || "demo-user";
        const data = await getCompanyInfo(uid);
        setCompanyInfo(data);
      } catch (err) {
        console.error("Error fetching company info for label printing:", err);
      }
    };
    fetchCompany();
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map((p) => p.id)));
    }
  };

  const toggleSelectProduct = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Build flattened list of labels to print
  const selectedProductsList = products.filter((p) => selectedIds.has(p.id));

  const itemsToPrint: {
    product: Product;
    copyIndex: number;
    rollInfo?: { rollNumber: string; length: number };
  }[] = [];

  selectedProductsList.forEach((product) => {
    const isFabricWithRolls = product.rolls && product.rolls.length > 0;

    if (quantityMode === "stock") {
      if (isFabricWithRolls) {
        // Print 1 tag per physical ROLL (e.g. 2 rolls = 2 labels, not 45 meters)
        product.rolls!.forEach((roll, rIdx) => {
          itemsToPrint.push({
            product,
            copyIndex: rIdx + 1,
            rollInfo: {
              rollNumber: roll.rollNumber || `Top #${rIdx + 1}`,
              length: roll.length,
            },
          });
        });
      } else {
        const count = Math.max(1, Math.min(100, product.stock || 1));
        for (let i = 0; i < count; i++) {
          itemsToPrint.push({ product, copyIndex: i + 1 });
        }
      }
    } else if (quantityMode === "custom") {
      const count = Math.max(1, customQuantities[product.id] || 1);
      for (let i = 0; i < count; i++) {
        itemsToPrint.push({ product, copyIndex: i + 1 });
      }
    } else {
      // "single" mode -> 1 label per product variety
      itemsToPrint.push({ product, copyIndex: 1 });
    }
  });

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(val);
  };

  // Layout CSS grid columns according to layoutPreset
  const getGridClass = () => {
    switch (layoutPreset) {
      case "2x5":
        return "grid-cols-2 gap-3";
      case "4x10":
        return "grid-cols-4 gap-1.5";
      case "thermal":
        return "grid-cols-1 gap-4 max-w-[280px] mx-auto";
      case "3x8":
      default:
        return "grid-cols-3 gap-2";
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in">
      {/* Print Specific Global Styles injected dynamically */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-qr-labels-root, #printable-qr-labels-root * {
            visibility: visible !important;
          }
          #printable-qr-labels-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
          .label-card {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            border: 1px solid #cbd5e1 !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      <div className="bg-white rounded-2xl w-full max-w-5xl shadow-2xl border border-slate-200 flex flex-col h-[94vh] no-print">
        {/* Modal Header */}
        <div className="p-4 sm:px-6 sm:py-4 border-b border-slate-150 flex justify-between items-center bg-slate-50/50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-200">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base sm:text-lg flex items-center gap-2">
                Toplu QR Kod & Etiket Yazdırma Şablonu
              </h3>
              <p className="text-xs text-slate-400">
                Seçtiğiniz ürünler için hazır A4 etiket kağıdına veya termal barkod yazıcıya uygun QR çıktısı alın.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Settings Sidebar + Live Preview Area */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden divide-y md:divide-y-0 md:divide-x divide-slate-200">
          
          {/* Controls Panel (Left Side on Desktop) */}
          <div className="w-full md:w-80 p-4 space-y-5 overflow-y-auto bg-slate-50/70 flex-shrink-0 text-xs">
            
            {/* 1. Ürün Seçim Özeti */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-bold text-slate-700 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-indigo-600" />
                  Ürün Seçimi
                </span>
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="text-indigo-600 hover:text-indigo-800 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  {selectedIds.size === products.length ? (
                    <>
                      <CheckSquare className="w-3.5 h-3.5" />
                      Tümünü Kaldır
                    </>
                  ) : (
                    <>
                      <Square className="w-3.5 h-3.5" />
                      Tümünü Seç ({products.length})
                    </>
                  )}
                </button>
              </div>

              <div className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-150 flex justify-between items-center">
                <span>Seçili Çeşit:</span>
                <span className="font-bold text-indigo-600">{selectedIds.size} / {products.length} Ürün</span>
              </div>

              {/* Product Checkboxes List */}
              <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 pr-1">
                {products.map((p) => {
                  const isChecked = selectedIds.has(p.id);
                  const isFabric = p.rolls && p.rolls.length > 0;
                  const stockDisplay = isFabric
                    ? `${p.stock}m (${p.rolls!.length} Top)`
                    : `${p.stock} ${p.packageUnitName || 'Adet'}`;

                  return (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 py-1.5 hover:bg-slate-50 px-1 rounded cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleSelectProduct(p.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                      />
                      <div className="min-w-0 flex-1 flex justify-between items-center gap-1">
                        <span className="truncate font-semibold text-slate-700 text-[11px]">{p.name}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-1 rounded flex-shrink-0">
                            {stockDisplay}
                          </span>
                          <span className="text-[9px] font-mono text-slate-400 bg-slate-100 px-1 rounded flex-shrink-0">
                            {p.sku || p.barcode || p.id.slice(0, 8)}
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* 2. Adet ve Kopya Stratejisi */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
              <span className="font-bold text-slate-700 block flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-indigo-600" />
                Etiket Adet Mantığı
              </span>
              
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg border border-slate-150 hover:bg-slate-50">
                  <input
                    type="radio"
                    name="qtyMode"
                    checked={quantityMode === "single"}
                    onChange={() => setQuantityMode("single")}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="font-bold text-slate-800 block text-[11px]">Her Üründen 1 Adet Etiket</span>
                    <span className="text-[10px] text-slate-400 block">Her ürün çeşidi için tek bir örnek etiket basar.</span>
                  </div>
                </label>

                <label className="flex items-center gap-2 cursor-pointer p-1.5 rounded-lg border border-slate-150 hover:bg-slate-50">
                  <input
                    type="radio"
                    name="qtyMode"
                    checked={quantityMode === "stock"}
                    onChange={() => setQuantityMode("stock")}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="font-bold text-slate-800 block text-[11px]">Top / Stok Sayısı Kadar Etiket</span>
                    <span className="text-[10px] text-slate-400 block">
                      Top kumaşlarda kaç top varsa (örn. 2 Top) o kadar etiket; standart ürünlerde adet kadar basar.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* 3. Etiket Boyutu / Şablon Seçimi */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-2.5">
              <span className="font-bold text-slate-700 block flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-600" />
                Etiket Düzeni / Şablonu
              </span>

              <select
                value={layoutPreset}
                onChange={(e) => setLayoutPreset(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="3x8">Standart A4 - 24 Etiket (3 Sütun x 8 Satır)</option>
                <option value="2x5">Büyük A4 - 10 Etiket (2 Sütun x 5 Satır)</option>
                <option value="4x10">Mini A4 - 40 Etiket (4 Sütun x 10 Satır)</option>
                <option value="thermal">Termal / Rulo Barkod Yazıcısı (Tek Sütun)</option>
              </select>
            </div>

            {/* 4. Görünür Bilgiler (Özelleştirme) */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-2">
              <span className="font-bold text-slate-700 block mb-1">Etikette Görünecek Bilgiler</span>
              
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCompanyName}
                    onChange={(e) => setShowCompanyName(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>Firma Adı</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showPrice}
                    onChange={(e) => setShowPrice(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>Ürün Fiyatı</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSkuText}
                    onChange={(e) => setShowSkuText(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>SKU / Barkod</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCategory}
                    onChange={(e) => setShowCategory(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>Kategori</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer col-span-2">
                  <input
                    type="checkbox"
                    checked={showAttributes}
                    onChange={(e) => setShowAttributes(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  <span>Özel Varyasyonlar (Renk, En, vb.)</span>
                </label>
              </div>
            </div>

            {/* Summary Box */}
            <div className="bg-indigo-50 border border-indigo-150 p-3 rounded-xl text-indigo-900 space-y-1">
              <div className="flex justify-between items-center font-bold">
                <span>Basılacak Etiket Sayısı:</span>
                <span className="text-sm bg-indigo-600 text-white px-2 py-0.5 rounded-full font-mono">
                  {itemsToPrint.length}
                </span>
              </div>
              <span className="text-[10px] text-indigo-700/80 block">
                Yazdır butonuna bastığınızda tarayıcınızın baskı penceresi açılır.
              </span>
            </div>

          </div>

          {/* Live Preview Area (Right Side) */}
          <div className="flex-1 bg-slate-200/80 p-4 sm:p-6 overflow-y-auto flex flex-col items-center">
            
            {/* Preview Banner */}
            <div className="w-full max-w-3xl flex justify-between items-center mb-3 text-xs text-slate-500 font-semibold no-print">
              <span className="flex items-center gap-1">
                <Check className="w-4 h-4 text-emerald-600" />
                Baskı Önizleme (A4 / Sayfa Görünümü)
              </span>
              <span className="text-[11px] text-slate-400">
                Toplam {itemsToPrint.length} etiket listeleniyor
              </span>
            </div>

            {/* Printable Paper Canvas Container */}
            <div 
              id="printable-qr-labels-root" 
              className="bg-white shadow-xl rounded-lg p-6 w-full max-w-3xl min-h-[600px] border border-slate-300"
            >
              {itemsToPrint.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-80 text-slate-400 space-y-2">
                  <HelpCircle className="w-10 h-10 stroke-1 text-slate-300" />
                  <span className="font-bold text-sm">Yazdırılacak ürün seçilmedi</span>
                  <p className="text-xs">Lütfen sol taraftaki listeden en az 1 ürün işaretleyin.</p>
                </div>
              ) : (
                <div className={`grid ${getGridClass()}`}>
                  {itemsToPrint.map(({ product, copyIndex, rollInfo }, idx) => (
                    <div
                      key={`${product.id}-${copyIndex}-${idx}`}
                      className="label-card border border-slate-300 rounded-lg p-2.5 bg-white flex flex-col justify-between items-center text-center relative overflow-hidden transition-all hover:border-indigo-400"
                      style={{ minHeight: layoutPreset === "2x5" ? "185px" : layoutPreset === "4x10" ? "105px" : "140px" }}
                    >
                      {/* Company Header */}
                      {showCompanyName && (
                        <div className="w-full border-b border-slate-100 pb-1 mb-1">
                          <span className="text-[9px] font-black uppercase text-slate-800 tracking-wider block truncate">
                            {companyInfo?.name || "STOKPRO MAĞAZA"}
                          </span>
                        </div>
                      )}

                      {/* Product Name & Roll Info */}
                      <div className="w-full">
                        <span className="font-extrabold text-slate-900 block truncate leading-tight text-xs">
                          {product.name}
                        </span>

                        {rollInfo && (
                          <span className="text-[9px] font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 inline-block mt-0.5">
                            {rollInfo.rollNumber} ({rollInfo.length} Metre)
                          </span>
                        )}

                        {showCategory && product.category && !rollInfo && (
                          <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest block mt-0.5">
                            {product.category}
                          </span>
                        )}
                      </div>

                      {/* QR Code Graphic */}
                      <div className="my-1 flex items-center justify-center">
                        <QRImage 
                          value={product.sku || product.barcode || product.id} 
                          size={layoutPreset === "2x5" ? 110 : layoutPreset === "4x10" ? 55 : 80} 
                        />
                      </div>

                      {/* Footer Details: Price & SKU */}
                      <div className="w-full pt-1 border-t border-slate-100 space-y-0.5">
                        {showSkuText && (
                          <div className="text-center">
                            {product.barcode && (
                              <span className="text-[8px] font-mono text-slate-400 block truncate">
                                Barkod: {product.barcode}
                              </span>
                            )}
                            <span className="text-[9px] font-mono font-bold text-slate-600 block tracking-tight truncate">
                              {product.sku || `ID: ${product.id}`}
                            </span>
                          </div>
                        )}

                        {showAttributes && product.attributes && Object.keys(product.attributes).length > 0 && (
                          <div className="text-[8px] text-slate-500 flex flex-wrap justify-center gap-1">
                            {Object.entries(product.attributes).map(([k, v]) => (
                              v ? <span key={k} className="bg-slate-50 px-1 rounded">{k}: {v}</span> : null
                            ))}
                          </div>
                        )}

                        {showPrice && (
                          <div className="font-extrabold text-slate-900 text-xs mt-0.5">
                            {formatCurrency(product.price)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-between items-center no-print">
          <div className="text-xs text-slate-500 font-medium">
            <span className="font-bold text-slate-700">{itemsToPrint.length} adet</span> etiket basılacak.
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              İptal
            </button>

            <button
              type="button"
              disabled={itemsToPrint.length === 0}
              onClick={handlePrint}
              className={`px-6 py-2.5 font-bold text-xs rounded-xl text-white shadow-md flex items-center gap-2 transition-all cursor-pointer active:scale-95 ${
                itemsToPrint.length === 0
                  ? "bg-slate-300 text-slate-500 cursor-not-allowed shadow-none"
                  : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200"
              }`}
            >
              <Printer className="w-4 h-4" />
              <span>Etiketleri Yazdır (Print)</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
