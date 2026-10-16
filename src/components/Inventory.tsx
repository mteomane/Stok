import React, { useState, useEffect, useMemo } from "react";
import { Product, SectorField, SectorSettings, FabricRoll } from "../types";
import { auth } from "../lib/firebase";
import { getSectorSettings, addProduct, round2, roundQty } from "../lib/firestoreService";
import { 
  Search, 
  Plus, 
  Minus, 
  QrCode, 
  Trash2, 
  Edit2, 
  AlertCircle,
  AlertTriangle, 
  FileSpreadsheet, 
  Sparkles, 
  CheckCircle2, 
  HelpCircle,
  Scissors,
  Package,
  Layers,
  FileText,
  Printer,
  X,
  RotateCcw,
  Archive,
  Tag,
  Calendar,
  Wrench,
  Apple,
  Store,
  Clock,
  Download,
  Barcode as BarcodeIcon,
  Camera,
  TrendingUp
} from "lucide-react";
import { QRImage } from "./QRImage";
import { BulkQRPrintModal } from "./BulkQRPrintModal";
import { UniversalImportModal } from "./UniversalImportModal";
import { QuickProductModal } from "./QuickProductModal";
import { QuickReplenishModal } from "./QuickReplenishModal";
import { QRScanner } from "./QRScanner";
import { getSectorProfile, shouldShowRolls, SECTOR_PROFILES } from "../lib/sectorConfig";
import { exportService } from "../lib/export/ExportService";
import { triggerFileDownload } from "../lib/export/fileDownload";

interface InventoryProps {
  products: Product[];
  onAddProduct: (product: Omit<Product, "id">) => Promise<void>;
  onUpdateProduct: (id: string, updates: Partial<Product>) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  onRestoreProduct?: (id: string) => Promise<void>;
  onReplenishProduct?: (productId: string, quantityToAdd: number, options?: { costPrice?: number; note?: string }) => Promise<void>;
  onRefreshData?: () => Promise<void>;
  initialFilter?: {
    onlyLowStock?: boolean;
    search?: string;
    highlightProductId?: string;
  } | null;
  onClearInitialFilter?: () => void;
}

export function Inventory({ 
  products, 
  onAddProduct, 
  onUpdateProduct, 
  onDeleteProduct, 
  onRestoreProduct,
  onReplenishProduct,
  onRefreshData,
  initialFilter,
  onClearInitialFilter 
}: InventoryProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Tümü");
  const [onlyLowStock, setOnlyLowStock] = useState<boolean>(false);
  const [showArchived, setShowArchived] = useState<boolean>(false);
  const [highlightProductId, setHighlightProductId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [isExporting, setIsExporting] = useState(false);

  // Quick product & Barcode modals
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickAddInitialBarcode, setQuickAddInitialBarcode] = useState<string | undefined>(undefined);
  const [quickAddInitialName, setQuickAddInitialName] = useState<string | undefined>(undefined);
  const [replenishProduct, setReplenishProduct] = useState<Product | null>(null);
  const [showScannerModal, setShowScannerModal] = useState(false);

  // Debounce search by 200ms to eliminate UI stuttering on mobile
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  // Handle hardware scanner / keyboard Enter press in search input
  const handleSearchEnter = () => {
    const q = search.trim().toLowerCase();
    if (!q) return;

    // Check exact match for barcode or SKU
    const exactMatch = products.find(
      (p) => p.isActive !== false && (
        (p.barcode && p.barcode.trim().toLowerCase() === q) ||
        (p.sku && p.sku.trim().toLowerCase() === q) ||
        p.id.toLowerCase() === q
      )
    );

    if (exactMatch) {
      setReplenishProduct(exactMatch);
      setSearch("");
      return;
    }

    // If barcode-like (numbers 5-18 chars) and not found, offer quick add
    if (/^\d{5,18}$/.test(q)) {
      setQuickAddInitialBarcode(search.trim());
      setQuickAddInitialName(undefined);
      setShowQuickAddModal(true);
      setSearch("");
    }
  };

  // Handle inline camera scan result
  const handleInlineScanSuccess = (decodedText: string) => {
    const clean = decodedText.trim();
    setShowScannerModal(false);

    const matched = products.find(
      (p) => p.isActive !== false && (
        (p.barcode && p.barcode.trim().toLowerCase() === clean.toLowerCase()) ||
        (p.sku && p.sku.trim().toLowerCase() === clean.toLowerCase()) ||
        p.id.toLowerCase() === clean.toLowerCase()
      )
    );

    if (matched) {
      setReplenishProduct(matched);
    } else {
      setQuickAddInitialBarcode(clean);
      setQuickAddInitialName(undefined);
      setShowQuickAddModal(true);
    }
  };

  // Stock Replenish caller
  const handleReplenish = async (
    productId: string, 
    quantityToAdd: number, 
    options?: { costPrice?: number; note?: string }
  ) => {
    if (onReplenishProduct) {
      await onReplenishProduct(productId, quantityToAdd, options);
    } else {
      const prod = products.find(p => p.id === productId);
      const cur = prod ? Number(prod.stock || 0) : 0;
      await onUpdateProduct(productId, { 
        stock: roundQty(cur + quantityToAdd),
        ...(options?.costPrice !== undefined ? { costPrice: options.costPrice } : {})
      });
    }
    if (onRefreshData) await onRefreshData();
  };

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, selectedCategory, onlyLowStock, showArchived, pageSize]);

  // Sync with quick navigation filter
  useEffect(() => {
    if (initialFilter) {
      if (initialFilter.onlyLowStock !== undefined) {
        setOnlyLowStock(initialFilter.onlyLowStock);
      }
      if (initialFilter.search !== undefined) {
        setSearch(initialFilter.search);
      }
      if (initialFilter.highlightProductId) {
        setHighlightProductId(initialFilter.highlightProductId);
        const timerScroll = setTimeout(() => {
          const el = document.getElementById(`product-card-${initialFilter.highlightProductId}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 150);

        const timerClearHighlight = setTimeout(() => {
          setHighlightProductId(null);
        }, 4500);

        return () => {
          clearTimeout(timerScroll);
          clearTimeout(timerClearHighlight);
        };
      }
    }
  }, [initialFilter]);

  // Sector settings
  const [sectorSettings, setSectorSettings] = useState<SectorSettings | null>(null);
  
  // Add product form modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [minStock, setMinStock] = useState("");
  const [sku, setSku] = useState("");
  const [unit, setUnit] = useState("Adet");
  
  // Dynamic fields state for new product
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  
  // Packaged/Sub-unit settings for new product
  const [isPackaged, setIsPackaged] = useState(false);
  const [packageUnitsCount, setPackageUnitsCount] = useState("10");
  const [packageUnitName, setPackageUnitName] = useState("Adet");
  const [subUnitStock, setSubUnitStock] = useState("10");

  const [formError, setFormError] = useState("");

  // Edit product states
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Bulk Excel/CSV upload states
  const [showBulkModal, setShowBulkModal] = useState(false);

  // QR Modal states
  const [activeQrProduct, setActiveQrProduct] = useState<Product | null>(null);

  // Bulk QR & Label Print Modal states
  const [showBulkPrintModal, setShowBulkPrintModal] = useState(false);
  const [bulkPrintInitialIds, setBulkPrintInitialIds] = useState<string[] | undefined>(undefined);

  // Fabric rolls management states
  const [selectedRollProduct, setSelectedRollProduct] = useState<Product | null>(null);
  const [newRollNumber, setNewRollNumber] = useState("");
  const [newRollLength, setNewRollLength] = useState("");
  const [editingRollId, setEditingRollId] = useState<string | null>(null);
  const [editingRollNumber, setEditingRollNumber] = useState("");
  const [editingRollLength, setEditingRollLength] = useState("");
  const [editingRollStatus, setEditingRollStatus] = useState<"available" | "sold" | "reserved">("available");
  const [rollQrValue, setRollQrValue] = useState<string | null>(null);

  const handleAddRoll = async () => {
    if (!selectedRollProduct) return;
    const len = round2(parseFloat(newRollLength));
    if (isNaN(len) || len <= 0) {
      alert("Lütfen geçerli bir rulo uzunluğu girin.");
      return;
    }

    const currentRolls = selectedRollProduct.rolls || [];
    const rollNum = newRollNumber.trim() || `Top #${currentRolls.length + 1}`;
    
    const newRoll: FabricRoll = {
      id: "R-" + Math.random().toString(36).substring(2, 8).toUpperCase(),
      rollNumber: rollNum,
      length: len,
      initialLength: len,
      soldLength: 0,
      status: "available"
    };

    const updatedRolls = [...currentRolls, newRoll];
    const newTotalStock = round2(updatedRolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));
    
    try {
      await onUpdateProduct(selectedRollProduct.id, { 
        rolls: updatedRolls,
        stock: newTotalStock
      });
      const updatedProduct = {
        ...selectedRollProduct,
        rolls: updatedRolls,
        stock: newTotalStock
      };
      setSelectedRollProduct(updatedProduct);
      setNewRollNumber("");
      setNewRollLength("");
      if (onRefreshData) await onRefreshData();
    } catch (err) {
      alert("Top eklenirken bir hata oluştu.");
    }
  };

  const handleUpdateRoll = async (rollId: string) => {
    if (!selectedRollProduct) return;
    const newLen = round2(parseFloat(editingRollLength));
    if (isNaN(newLen) || newLen < 0) {
      alert("Lütfen geçerli bir rulo uzunluğu girin.");
      return;
    }

    const updatedRolls = (selectedRollProduct.rolls || []).map((r) => {
      if (r.id === rollId) {
        const initLen = r.initialLength !== undefined ? Number(r.initialLength) : Math.max(Number(r.length), newLen);
        const autoStatus = newLen <= 0 ? ("sold" as const) : (editingRollStatus === "sold" ? ("available" as const) : editingRollStatus);
        return {
          ...r,
          rollNumber: editingRollNumber.trim() || r.rollNumber,
          length: newLen,
          initialLength: initLen,
          soldLength: round2(Math.max(0, initLen - newLen)),
          status: autoStatus
        };
      }
      return r;
    });

    const newTotalStock = round2(updatedRolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));

    try {
      await onUpdateProduct(selectedRollProduct.id, { 
        rolls: updatedRolls,
        stock: newTotalStock
      });
      const updatedProduct = {
        ...selectedRollProduct,
        rolls: updatedRolls,
        stock: newTotalStock
      };
      setSelectedRollProduct(updatedProduct);
      setEditingRollId(null);
      if (onRefreshData) await onRefreshData();
    } catch (err) {
      alert("Top güncellenirken bir hata oluştu.");
    }
  };

  const handleDeleteRoll = async (rollId: string) => {
    if (!selectedRollProduct) return;
    if (!confirm("Bu kumaş topunu silmek istediğinize emin misiniz? Bu işlem toplam stok miktarını güncelleyecektir.")) return;

    const updatedRolls = (selectedRollProduct.rolls || []).filter((r) => r.id !== rollId);
    const newTotalStock = round2(updatedRolls.reduce((sum, r) => sum + (Number(r.length) || 0), 0));

    try {
      await onUpdateProduct(selectedRollProduct.id, { 
        rolls: updatedRolls,
        stock: newTotalStock
      });
      const updatedProduct = {
        ...selectedRollProduct,
        rolls: updatedRolls,
        stock: newTotalStock
      };
      setSelectedRollProduct(updatedProduct);
      if (onRefreshData) await onRefreshData();
    } catch (err) {
      alert("Top silinirken bir hata oluştu.");
    }
  };

  // Fetch active sector and dynamic fields from server
  const fetchSectorSettings = async () => {
    try {
      const uid = auth.currentUser?.uid || "demo-user";
      const data = await getSectorSettings(uid);
      setSectorSettings(data);
      const profile = getSectorProfile(data.activeSector);
      if (profile?.defaultUnit) {
        setUnit(profile.defaultUnit);
      }
    } catch (err) {
      console.error("Failed to load sector settings in Inventory", err);
    }
  };

  useEffect(() => {
    fetchSectorSettings();
  }, [products]);

  const getSectorLabel = (key?: string) => {
    return getSectorProfile(key).name;
  };

  // Memoized categories extraction
  const categories = useMemo(() => ["Tümü", ...Array.from(new Set(products.map((p) => p.category || "Genel")))], [products]);

  // Low stock count (active products only)
  const lowStockCount = useMemo(() => products.filter((p) => p.isActive !== false && p.stock <= p.minStock).length, [products]);
  // Archived count
  const archivedCount = useMemo(() => products.filter((p) => p.isActive === false).length, [products]);

  // Memoized product filtering
  const filteredProducts = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    return products.filter((p) => {
      const isArchived = p.isActive === false;
      if (showArchived) {
        if (!isArchived) return false;
      } else {
        if (isArchived) return false;
      }

      const matchesSearch = !q ||
        p.name.toLowerCase().includes(q) || 
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q));
      const matchesCategory = selectedCategory === "Tümü" || p.category === selectedCategory;
      const matchesLowStock = !onlyLowStock || p.stock <= p.minStock;
      return matchesSearch && matchesCategory && matchesLowStock;
    });
  }, [products, showArchived, debouncedSearch, selectedCategory, onlyLowStock]);

  const totalPages = Math.ceil(filteredProducts.length / pageSize) || 1;
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, currentPage, pageSize]);

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    const parsedPrice = parseFloat(price);
    const parsedStock = parseFloat(stock);
    const parsedMinStock = parseFloat(minStock);

    if (!name.trim()) return setFormError("Ürün adı boş olamaz.");
    if (isNaN(parsedPrice) || parsedPrice < 0) return setFormError("Geçerli bir fiyat girin.");
    if (isNaN(parsedStock) || parsedStock < 0) return setFormError("Geçerli bir stok miktarı girin.");

    try {
      await onAddProduct({
        name: name.trim(),
        category: category.trim() || "Genel",
        price: round2(parsedPrice),
        stock: roundQty(parsedStock),
        minStock: !isNaN(parsedMinStock) && parsedMinStock >= 0 ? roundQty(parsedMinStock) : 0,
        sku: sku.trim() || undefined as any,
        unit: unit.trim() || undefined,
        attributes,
        metadata: attributes,
        isPackaged,
        packageUnitsCount: isPackaged ? parseInt(packageUnitsCount) : undefined,
        packageUnitName: isPackaged ? packageUnitName.trim() : undefined,
        subUnitStock: isPackaged ? parseFloat(subUnitStock) : undefined
      });
      
      // Reset form
      setName("");
      setCategory("");
      setPrice("");
      setStock("");
      setMinStock("");
      setSku("");
      const profile = getSectorProfile(sectorSettings?.activeSector);
      setUnit(profile?.defaultUnit || "Adet");
      setAttributes({});
      setIsPackaged(false);
      setPackageUnitsCount("10");
      setPackageUnitName("Adet");
      setSubUnitStock("10");
      setShowAddModal(false);
    } catch (err: any) {
      setFormError(err.message || "Ürün eklenirken bir hata oluştu.");
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!editingProduct) return;
    if (!editingProduct.name.trim()) return setFormError("Ürün adı boş olamaz.");
    if (isNaN(editingProduct.price) || editingProduct.price < 0) return setFormError("Geçerli bir fiyat girin.");
    if (isNaN(editingProduct.stock) || editingProduct.stock < 0) return setFormError("Geçerli bir stok miktarı girin.");

    try {
      await onUpdateProduct(editingProduct.id, {
        name: editingProduct.name,
        category: editingProduct.category || "Genel",
        price: round2(editingProduct.price),
        stock: roundQty(editingProduct.stock),
        minStock: roundQty(editingProduct.minStock || 0),
        sku: editingProduct.sku,
        unit: editingProduct.unit || undefined,
        attributes: editingProduct.attributes,
        metadata: editingProduct.metadata || editingProduct.attributes,
        isPackaged: editingProduct.isPackaged,
        packageUnitsCount: editingProduct.packageUnitsCount,
        packageUnitName: editingProduct.packageUnitName,
        subUnitStock: editingProduct.subUnitStock
      });
      setEditingProduct(null);
    } catch (err: any) {
      setFormError(err.message || "Ürün güncellenirken bir hata oluştu.");
    }
  };

  const adjustStock = async (productId: string, currentStock: number, adjustment: number) => {
    const newStock = roundQty(Math.max(0, currentStock + adjustment));
    await onUpdateProduct(productId, { stock: newStock });
  };

  // Kısmi Alt Birim Al (Sub-unit package depletion)
  const handleExtractSubunit = async (productId: string, amount: number = 1) => {
    try {
      const product = products.find(p => p.id === productId);
      if (!product) {
        alert("Ürün bulunamadı.");
        return;
      }
      if (!product.isPackaged) {
        alert("Bu ürün paket içi kısmi eksiltmeye uygun değildir.");
        return;
      }

      let currentOpen = product.subUnitStock || 0;
      const packageUnits = product.packageUnitsCount || 1;
      const totalSubUnitsAvailable = currentOpen + (product.stock * packageUnits);

      if (totalSubUnitsAvailable < amount) {
        alert(`Yetersiz stok! Toplam kalan kısmi miktar (${totalSubUnitsAvailable} ${product.packageUnitName || 'Adet'}) istenen miktardan (${amount}) az.`);
        return;
      }

      let newStock = product.stock;
      let newSubUnitStock = currentOpen;

      if (currentOpen >= amount) {
        newSubUnitStock = currentOpen - amount;
      } else {
        let needed = amount - currentOpen;
        const packagesToOpen = Math.ceil(needed / packageUnits);
        newStock -= packagesToOpen;
        newSubUnitStock = (packagesToOpen * packageUnits) - needed;
      }

      await onUpdateProduct(productId, {
        stock: newStock,
        subUnitStock: newSubUnitStock
      });

      if (onRefreshData) {
        await onRefreshData();
      }
    } catch (err) {
      console.error("Subunit extraction error", err);
      alert("Kısmi stok düşülemedi.");
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(val);
  };

  return (
    <div className="space-y-6 animate-fade-in" id="inventory-tab-root">
      {/* Top action block */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Ürün Listesi & Envanter Kontrolü</h2>
          <p className="text-xs text-slate-400">Ürünlerinizi ekleyin, güncelleyin, paket içi kısmi birimleri çıkarın ve QR kod üretin.</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap sm:flex-nowrap">
          {/* Toplu QR & Etiket Yazdır Button */}
          <button
            onClick={() => {
              setBulkPrintInitialIds(undefined);
              setShowBulkPrintModal(true);
            }}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm"
          >
            <Printer className="w-4 h-4 text-indigo-600" />
            Toplu QR & Etiket Yazdır
          </button>

          {/* Bulk Upload Button */}
          <button
            onClick={() => setShowBulkModal(true)}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer shadow-sm"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            Excel (.xlsx) Yükle
          </button>

          {/* Quick Export Button */}
          <button
            type="button"
            disabled={isExporting}
            onClick={async () => {
              try {
                setIsExporting(true);
                const uid = auth.currentUser?.uid || "demo-user";
                const result = await exportService.exportProducts(uid, "csv");
                triggerFileDownload(result.content, result.fileName, result.mimeType);
              } catch (err: any) {
                alert(err.message || "Dışa aktarma sırasında hata oluştu.");
              } finally {
                setIsExporting(false);
              }
            }}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer disabled:opacity-50"
            title="Tüm ürün kataloğunu Excel uyumlu CSV olarak indir"
          >
            <Download className="w-4 h-4 text-indigo-600" />
            <span>{isExporting ? "İndiriliyor..." : "Excel/CSV İndir"}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setQuickAddInitialBarcode(undefined);
              setQuickAddInitialName(undefined);
              setShowQuickAddModal(true);
            }}
            className="flex-1 sm:flex-none px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-sm shadow-indigo-100 active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Yeni Ürün Ekle</span>
          </button>
        </div>
      </div>

      {/* Filter and search controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 flex items-center">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSearchEnter();
              }
            }}
            placeholder="Barkod okutun veya ürün adı, SKU, marka arayın..."
            className="w-full pl-10 pr-24 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white font-medium"
          />
          <button
            type="button"
            onClick={() => setShowScannerModal(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-md text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
            title="Kamera ile barkod / QR okut"
          >
            <Camera className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Kamera</span>
          </button>
        </div>

        {/* Quick Low Stock Toggle Filter */}
        <button
          type="button"
          onClick={() => {
            setOnlyLowStock(!onlyLowStock);
            if (onlyLowStock && onClearInitialFilter) {
              onClearInitialFilter();
            }
          }}
          className={`px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap border cursor-pointer ${
            onlyLowStock
              ? "bg-rose-600 text-white border-rose-600 shadow-sm shadow-rose-200"
              : "bg-white border-slate-200 text-slate-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200"
          }`}
          title="Yalnızca minimum eşik altındaki ürünleri listele"
        >
          <AlertTriangle className={`w-3.5 h-3.5 ${onlyLowStock ? "text-white" : "text-rose-500"}`} />
          <span>Kritik Stoktakiler</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
              onlyLowStock ? "bg-white text-rose-600" : "bg-rose-100 text-rose-700"
            }`}
          >
            {lowStockCount}
          </span>
        </button>

        {/* Toggle Archived / Trash Bin */}
        {archivedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className={`px-3 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap border cursor-pointer ${
              showArchived
                ? "bg-slate-800 text-white border-slate-800 shadow-sm"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
            title="Silinen / Arşivlenen ürünleri göster"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>{showArchived ? "Aktif Ürünlere Dön" : "Arşiv"}</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-700">
              {archivedCount}
            </span>
          </button>
        )}

        {/* Categories scroll horizontally */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                selectedCategory === cat
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Low stock active filter reminder banner */}
      {onlyLowStock && (
        <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-800 animate-fade-in shadow-2xs">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-rose-100 text-rose-600 rounded-lg flex-shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <span className="font-bold block">Kritik Stok Filtresi Devrede:</span>
              <span className="text-[11px] text-rose-700">
                Şu an yalnızca minimum stok eşiğinin altında kalan ({filteredProducts.length} adet) ürün listeleniyor.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setOnlyLowStock(false);
              if (search) setSearch("");
              if (onClearInitialFilter) onClearInitialFilter();
            }}
            className="self-start sm:self-center px-3 py-1.5 bg-white hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-lg border border-rose-200 transition-colors cursor-pointer"
          >
            Filtreyi Temizle (Tümünü Göster)
          </button>
        </div>
      )}

      {/* Products Grid */}
      {filteredProducts.length === 0 ? (
        <div className="bg-white p-10 text-center border border-slate-200 rounded-2xl shadow-sm">
          <AlertCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <span className="text-base font-bold text-slate-800 block">
            {debouncedSearch ? `"${debouncedSearch}" ile eşleşen ürün bulunamadı` : "Henüz ürün eklenmemiş"}
          </span>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {debouncedSearch 
              ? "Bu barkod veya isimle stoğunuza tek adımda yeni ürün kaydedebilirsiniz." 
              : "Yeni ürün ekleyerek stoklarınızı ve satışlarınızı kolayca takip etmeye başlayın."}
          </p>
          <button
            type="button"
            onClick={() => {
              const isBarcodeLike = /^\d{5,18}$/.test(debouncedSearch.trim());
              setQuickAddInitialBarcode(isBarcodeLike ? debouncedSearch.trim() : "");
              setQuickAddInitialName(!isBarcodeLike ? debouncedSearch.trim() : "");
              setShowQuickAddModal(true);
            }}
            className="mt-4 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-indigo-600/20 active:scale-95 transition-all inline-flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{debouncedSearch ? `"${debouncedSearch}" Olarak Yeni Ürün Ekle` : "Yeni Ürün Ekle"}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {paginatedProducts.map((p) => {
            const isLowStock = p.stock <= p.minStock;
            const isHighlighted = p.id === highlightProductId;
            return (
              <div
                id={`product-card-${p.id}`}
                key={p.id}
                className={`bg-white rounded-xl border p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group ${
                  isHighlighted 
                    ? "ring-4 ring-indigo-500/80 border-indigo-400 shadow-xl bg-indigo-50/20" 
                    : isLowStock 
                      ? "border-rose-200 bg-rose-50/20" 
                      : "border-slate-200"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[9px] font-black uppercase text-indigo-600 tracking-wider bg-indigo-50 px-2 py-0.5 rounded">
                          {p.category}
                        </span>
                        {p.isPackaged && (
                          <span className="text-[9px] font-black uppercase text-emerald-600 tracking-wider bg-emerald-50 px-2 py-0.5 rounded flex items-center gap-0.5">
                            <Package className="w-2.5 h-2.5" />
                            Kısmi Birim
                          </span>
                        )}
                      </div>

                      <h3 className="font-bold text-slate-800 text-base mt-2 leading-snug truncate group-hover:text-indigo-600 transition-colors">
                        {p.name}
                      </h3>
                      <span className="text-xs text-slate-400 font-mono mt-0.5 block">SKU: {p.sku}</span>
                    </div>

                    <button
                      onClick={() => setActiveQrProduct(p)}
                      title="QR Kod Göster"
                      className="p-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition-all flex-shrink-0"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Dynamic Sector Attributes & Smart Badges */}
                  {((p.metadata && Object.keys(p.metadata).length > 0) || (p.attributes && Object.keys(p.attributes).length > 0)) && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {/* Food SKT / Expiry Smart Badge */}
                      {(() => {
                        const expiry = p.metadata?.expiryDate || p.attributes?.SKT || p.attributes?.expiryDate;
                        if (!expiry) return null;
                        const expDate = new Date(expiry);
                        const isExpired = !isNaN(expDate.getTime()) && expDate.getTime() < new Date().setHours(0, 0, 0, 0);
                        const diffDays = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                        const isExpiringSoon = !isExpired && diffDays <= 30;

                        return (
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1 border ${
                              isExpired
                                ? "bg-rose-100 text-rose-800 border-rose-300 animate-pulse"
                                : isExpiringSoon
                                ? "bg-amber-100 text-amber-800 border-amber-300"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"
                            }`}
                            title={`Son Tüketim Tarihi: ${expiry}`}
                          >
                            <Calendar className="w-2.5 h-2.5" />
                            SKT: {expiry} {isExpired ? "(Geçmiş!)" : isExpiringSoon ? `(${diffDays} gün)` : ""}
                          </span>
                        );
                      })()}

                      {/* Food Batch/Lot Smart Badge */}
                      {(() => {
                        const batch = p.metadata?.batchNumber || p.attributes?.batchNumber;
                        if (!batch) return null;
                        return (
                          <span className="text-[9px] bg-slate-100 border border-slate-200 text-slate-700 font-mono font-bold px-1.5 py-0.5 rounded-md">
                            Lot: {batch}
                          </span>
                        );
                      })()}

                      {/* Spare Parts OEM / Part Number Smart Badge */}
                      {(() => {
                        const partNo = p.metadata?.partNumber || p.attributes?.partNumber || p.attributes?.SeriNo;
                        if (!partNo) return null;
                        return (
                          <span className="text-[9px] bg-blue-50 border border-blue-200 text-blue-800 font-mono font-bold px-1.5 py-0.5 rounded-md flex items-center gap-1">
                            <Wrench className="w-2.5 h-2.5 text-blue-600" />
                            Parça No: {partNo}
                          </span>
                        );
                      })()}

                      {/* Spare Parts Vehicle Compatibility Smart Badge */}
                      {(() => {
                        const compat = p.metadata?.vehicleCompatibility || p.attributes?.vehicleCompatibility || p.attributes?.UyumluModel;
                        if (!compat) return null;
                        return (
                          <span className="text-[9px] bg-indigo-50 border border-indigo-200 text-indigo-800 font-medium px-1.5 py-0.5 rounded-md">
                            Uyum: {compat}
                          </span>
                        );
                      })()}

                      {/* Other dynamic attributes */}
                      {Object.entries({ ...(p.attributes || {}), ...(p.metadata || {}) }).map(([key, val]) => {
                        if (!val || ["expiryDate", "SKT", "batchNumber", "partNumber", "SeriNo", "vehicleCompatibility", "UyumluModel"].includes(key)) {
                          return null;
                        }
                        return (
                          <span key={key} className="text-[9px] bg-slate-100 border border-slate-200/55 text-slate-600 font-bold px-1.5 py-0.5 rounded-md">
                            {key}: <span className="font-semibold text-slate-800">{String(val)}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-baseline gap-2 mt-4">
                    <span className="text-xl font-bold text-slate-900">{formatCurrency(p.price)}</span>
                    <span className="text-xs text-slate-400">
                      / {p.unit ? p.unit.toLowerCase() : (p.category?.toLowerCase().includes("kumaş") || p.category?.toLowerCase().includes("kumas") ? "metre" : p.packageUnitName ? p.packageUnitName.toLowerCase() : "adet")}
                    </span>
                  </div>
                </div>

                {/* Packaged sub-unit stock section */}
                {p.isPackaged && (
                  <div className="mt-4 bg-emerald-50/40 p-3 rounded-lg border border-emerald-100 text-xs space-y-2">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Koli/Paket İçi Stok</span>
                        <span className="font-bold text-emerald-700">
                          {p.subUnitStock} / {p.packageUnitsCount} {p.packageUnitName || 'Birim'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleExtractSubunit(p.id, 1)}
                        className="p-1 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded flex items-center gap-1 active:scale-95 transition-all shadow-sm cursor-pointer"
                        title={`${p.packageUnitName || 'Birim'} Çıkar`}
                      >
                        <Scissors className="w-3 h-3" />
                        1 {p.packageUnitName || 'Birim'} Al
                      </button>
                    </div>
                    <span className="text-[9px] text-slate-400 block leading-tight">
                      İçinden alınan her parça stoğu düşürür. Sıfırlanırsa ana stoktan otomatik 1 paket açılır.
                    </span>
                  </div>
                )}

                {/* Fabric Rolls Tracking Section (Textile / Rolls enabled only) */}
                {shouldShowRolls(p, sectorSettings?.activeSector) && (
                  <div className="mt-4 bg-indigo-50/40 p-3 rounded-xl border border-indigo-100 text-xs space-y-2">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide block">Rulo / Top Takibi</span>
                        <span className="font-bold text-indigo-700">
                          {p.rolls?.length || 0} Adet Top ({p.stock} m)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedRollProduct(p)}
                        className="p-1 px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded flex items-center gap-1 active:scale-95 transition-all shadow-sm cursor-pointer"
                        title="Top Detaylarını Düzenle"
                      >
                        <Layers className="w-3 h-3" />
                        Topları Yönet
                      </button>
                    </div>
                    {/* Tiny roll badge visualization */}
                    {p.rolls && p.rolls.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1 max-h-[44px] overflow-y-auto">
                        {p.rolls.slice(0, 5).map((r) => (
                          <span
                            key={r.id}
                            className={`text-[9px] px-1.5 py-0.5 rounded font-bold font-mono ${
                              r.status === "sold"
                                ? "bg-slate-200 text-slate-500 line-through"
                                : r.status === "reserved"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {r.rollNumber} ({r.length}m)
                          </span>
                        ))}
                        {p.rolls.length > 5 && (
                          <span className="text-[9px] text-slate-400 font-bold font-mono px-1">
                            +{p.rolls.length - 5} top daha...
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-5 pt-4 border-t border-slate-150 flex items-center justify-between">
                  {/* Stock counter with alerts */}
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ana Stok</span>
                    <span
                      className={`text-lg font-bold mt-0.5 ${isLowStock ? "text-rose-600" : "text-emerald-600"}`}
                    >
                      {p.stock}{" "}
                      {p.unit || (p.category?.toLowerCase().includes("kumaş") || p.category?.toLowerCase().includes("kumas")
                        ? "Metre"
                        : p.packageUnitName || "Adet")}
                      {(p.category?.toLowerCase().includes("kumaş") || p.category?.toLowerCase().includes("kumas")) &&
                        p.rolls && p.rolls.length > 0 && (
                          <span className="text-xs font-semibold text-slate-500 ml-1">
                            ({p.rolls.length} Top)
                          </span>
                        )}
                    </span>
                    {isLowStock && (
                      <span className="text-[10px] text-rose-500 font-semibold flex items-center gap-0.5 mt-0.5">
                        <AlertCircle className="w-3 h-3" />
                        <span>Kritik (Min: {p.minStock})</span>
                      </span>
                    )}
                  </div>

                  {/* Stock quick adjustments and edit actions */}
                  <div className="flex items-center gap-1 sm:gap-2">
                    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-1">
                      <button
                        onClick={() => adjustStock(p.id, p.stock, -1)}
                        className="p-1 rounded-md hover:bg-white text-slate-500 hover:text-rose-500 active:scale-90 transition-all"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-2 text-xs sm:text-sm font-bold text-slate-700 min-w-[20px] text-center">
                        {p.stock}
                      </span>
                      <button
                        onClick={() => adjustStock(p.id, p.stock, 1)}
                        className="p-1 rounded-md hover:bg-white text-slate-500 hover:text-emerald-500 active:scale-90 transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Dedicated Quick Replenish Button */}
                    {p.isActive !== false && (
                      <button
                        type="button"
                        onClick={() => setReplenishProduct(p)}
                        title="Hızlı Stok Girişi Yap"
                        className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-lg border border-emerald-200 flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                      >
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="hidden sm:inline">Stok Ekle</span>
                      </button>
                    )}

                    {p.isActive === false ? (
                      onRestoreProduct && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`"${p.name}" ürününü arşivden geri yüklemek istiyor musunuz?`)) {
                              onRestoreProduct(p.id);
                            }
                          }}
                          title="Arşivden Geri Yükle"
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all cursor-pointer shadow-sm"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Geri Yükle</span>
                        </button>
                      )
                    ) : (
                      <>
                        <button
                          onClick={() => setEditingProduct(p)}
                          title="Düzenle"
                          className="p-1.5 text-slate-400 hover:text-indigo-600 active:scale-90 transition-all cursor-pointer"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => {
                            if (confirm(`"${p.name}" ürününü arşive kaldırmak istediğinize emin misiniz? (Ürün geçmiş satışlarda korunmaya devam edecektir)`)) {
                              onDeleteProduct(p.id);
                            }
                          }}
                          title="Arşive Kaldır (Soft Delete)"
                          className="p-1.5 text-slate-400 hover:text-rose-500 active:scale-90 transition-all cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {filteredProducts.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm mt-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Sayfa Başına:</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 focus:outline-none"
            >
              <option value={12}>12 Ürün</option>
              <option value={24}>24 Ürün</option>
              <option value={48}>48 Ürün</option>
              <option value={96}>96 Ürün</option>
            </select>
            <span className="ml-2">
              Toplam <strong>{filteredProducts.length}</strong> üründen <strong>{Math.min(filteredProducts.length, (currentPage - 1) * pageSize + 1)}-{Math.min(filteredProducts.length, currentPage * pageSize)}</strong> arası
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
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
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              Sonraki
            </button>
          </div>
        </div>
      )}

      {/* Add Product Modal Overlay */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl animate-fade-in border border-slate-200 flex flex-col max-h-[92vh]">
            <div className="flex justify-between items-center border-b border-slate-150 pb-3 mb-4">
              <h3 className="font-bold text-slate-800 text-lg flex items-center gap-1.5">
                <Plus className="w-5 h-5 text-indigo-500" />
                Yeni Ürün Ekle
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 font-semibold"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="space-y-4 overflow-y-auto flex-1 pr-1">
              {formError && (
                <div className="bg-rose-50 text-rose-600 text-xs p-3 rounded-lg border border-rose-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Ürün Adı *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn: Pamuk Goblen Kumaş"
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Kategori</label>
                  <input
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Kumaş, Aksesuar vb."
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Barkod / SKU</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="Boş bırakılırsa üretilir"
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
              </div>

              {/* DYNAMIC SECTOR FIELDS */}
              {sectorSettings && sectorSettings.customFields && sectorSettings.customFields.length > 0 && (
                <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-150 space-y-3">
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                    Sektöre Özel Dinamik Alanlar ({getSectorLabel(sectorSettings.activeSector)})
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {sectorSettings.customFields.map((field) => (
                      <div key={field.key}>
                        <label className="text-xs font-bold text-slate-600 block mb-1">{field.label}</label>
                        <input
                          type={field.type}
                          value={attributes[field.key] || ""}
                          onChange={(e) => setAttributes({ ...attributes, [field.key]: e.target.value })}
                          placeholder={`${field.label} girin`}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Fiyat (₺) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="120.00"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Stok *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                    placeholder="50"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Min. Stok</label>
                  <input
                    type="number"
                    step="any"
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                    placeholder="5"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Birim</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="Adet, Metre..."
                    list="unit-suggestions"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 font-medium"
                  />
                  <datalist id="unit-suggestions">
                    {getSectorProfile(sectorSettings?.activeSector).allowedUnits.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* KISMİ STOK SEÇENEKLERİ (Sub-unit/packaged stock) */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPackaged}
                    onChange={(e) => setIsPackaged(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                  />
                  <span className="text-xs font-bold text-slate-700">Bu Ürün Paketli mi? (Kısmi Birim Almayı Aç)</span>
                </label>

                {isPackaged && (
                  <div className="grid grid-cols-3 gap-3 pt-2 animate-fade-in text-xs">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">Paket İçi Adet</label>
                      <input
                        type="number"
                        required
                        value={packageUnitsCount}
                        onChange={(e) => setPackageUnitsCount(e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-200 bg-white rounded-lg text-center"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">Alt Birim Adı</label>
                      <input
                        type="text"
                        required
                        value={packageUnitName}
                        onChange={(e) => setPackageUnitName(e.target.value)}
                        placeholder="Metre, Adet..."
                        className="w-full px-2 py-1.5 border border-slate-200 bg-white rounded-lg text-center"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">Aktif Alt Stok</label>
                      <input
                        type="number"
                        required
                        value={subUnitStock}
                        onChange={(e) => setSubUnitStock(e.target.value)}
                        className="w-full px-2 py-1.5 border border-slate-200 bg-white rounded-lg text-center"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-slate-150 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50 text-slate-600 transition-all"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-100"
                >
                  Ürünü Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Product Modal Overlay */}
      {editingProduct && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl animate-fade-in border border-slate-200 flex flex-col max-h-[92vh]">
            <div className="flex justify-between items-center border-b border-slate-150 pb-3 mb-4">
              <h3 className="font-bold text-slate-800 text-lg">Ürünü Düzenle</h3>
              <button
                onClick={() => setEditingProduct(null)}
                className="text-slate-400 hover:text-slate-600 font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4 overflow-y-auto flex-1 pr-1">
              {formError && (
                <div className="bg-rose-50 text-rose-600 text-xs p-3 rounded-lg border border-rose-200 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-500 block mb-1">Ürün Adı *</label>
                <input
                  type="text"
                  required
                  value={editingProduct.name}
                  onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Kategori</label>
                  <input
                    type="text"
                    value={editingProduct.category}
                    onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Barkod / SKU</label>
                  <input
                    type="text"
                    value={editingProduct.sku}
                    onChange={(e) => setEditingProduct({ ...editingProduct, sku: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
              </div>

              {/* DYNAMIC SECTOR FIELDS EDIT */}
              {sectorSettings && sectorSettings.customFields && sectorSettings.customFields.length > 0 && (
                <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-150 space-y-3">
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider block flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
                    Sektöre Özel Dinamik Alanlar ({getSectorLabel(sectorSettings.activeSector)})
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {sectorSettings.customFields.map((field) => (
                      <div key={field.key}>
                        <label className="text-xs font-bold text-slate-600 block mb-1">{field.label}</label>
                        <input
                          type={field.type}
                          value={((editingProduct.metadata && editingProduct.metadata[field.key]) || (editingProduct.attributes && editingProduct.attributes[field.key])) || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            const newAttrs = { ...(editingProduct.attributes || {}), [field.key]: val };
                            const newMeta = { ...(editingProduct.metadata || {}), [field.key]: val };
                            setEditingProduct({ ...editingProduct, attributes: newAttrs, metadata: newMeta });
                          }}
                          placeholder={field.label}
                          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Fiyat (₺) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editingProduct.price}
                    onChange={(e) => setEditingProduct({ ...editingProduct, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Stok *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={editingProduct.stock}
                    onChange={(e) => setEditingProduct({ ...editingProduct, stock: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Min. Stok</label>
                  <input
                    type="number"
                    step="any"
                    value={editingProduct.minStock}
                    onChange={(e) => setEditingProduct({ ...editingProduct, minStock: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-1">Birim</label>
                  <input
                    type="text"
                    value={editingProduct.unit || "Adet"}
                    onChange={(e) => setEditingProduct({ ...editingProduct, unit: e.target.value })}
                    placeholder="Adet, Metre..."
                    list="edit-unit-suggestions"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 font-medium"
                  />
                  <datalist id="edit-unit-suggestions">
                    {getSectorProfile(sectorSettings?.activeSector).allowedUnits.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Kısmi Stok Düzenleme */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingProduct.isPackaged || false}
                    onChange={(e) => setEditingProduct({ ...editingProduct, isPackaged: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600 h-4 w-4"
                  />
                  <span className="text-xs font-bold text-slate-700">Kısmi Birim / Paket Yönetimi Aktif</span>
                </label>

                {editingProduct.isPackaged && (
                  <div className="grid grid-cols-3 gap-3 pt-2 text-xs">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">Paket İçi Birim</label>
                      <input
                        type="number"
                        required
                        value={editingProduct.packageUnitsCount || 0}
                        onChange={(e) => setEditingProduct({ ...editingProduct, packageUnitsCount: parseInt(e.target.value) || 1 })}
                        className="w-full px-2 py-1.5 border border-slate-200 bg-white rounded-lg text-center"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">Alt Birim Adı</label>
                      <input
                        type="text"
                        required
                        value={editingProduct.packageUnitName || ""}
                        onChange={(e) => setEditingProduct({ ...editingProduct, packageUnitName: e.target.value })}
                        className="w-full px-2 py-1.5 border border-slate-200 bg-white rounded-lg text-center"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">Açık Alt Stok</label>
                      <input
                        type="number"
                        required
                        value={editingProduct.subUnitStock || 0}
                        onChange={(e) => setEditingProduct({ ...editingProduct, subUnitStock: parseInt(e.target.value) || 0 })}
                        className="w-full px-2 py-1.5 border border-slate-200 bg-white rounded-lg text-center"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-slate-150 flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-semibold hover:bg-slate-50 text-slate-600 transition-all"
                >
                  İptal
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-100"
                >
                  Kaydet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Universal Excel (.xlsx) / CSV Toplu Ürün Yükleme Modalı */}
      <UniversalImportModal
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        onSuccess={async () => {
          if (onRefreshData) {
            await onRefreshData();
          }
        }}
        existingProducts={products}
        activeSector={sectorSettings?.activeSector}
      />

      {/* QR Code Viewer Modal Overlay */}
      {activeQrProduct && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl animate-fade-in border border-slate-200 text-center relative">
            <button
              onClick={() => setActiveQrProduct(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 font-semibold"
            >
              ✕
            </button>

            <h3 className="font-bold text-slate-800 text-lg mb-1">{activeQrProduct.name}</h3>
            <span className="text-xs text-indigo-600 font-bold bg-indigo-50 px-2.5 py-1 rounded-full uppercase tracking-wider inline-block mb-6">
              {activeQrProduct.category}
            </span>

            {/* Render the actual QR Code */}
            <QRImage value={activeQrProduct.sku} size={220} />

            <div className="mt-6 space-y-2">
              <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Barkod / SKU Değeri</span>
              <div className="bg-slate-50 border border-slate-200 p-2.5 rounded-lg font-mono text-sm font-bold text-slate-700 select-all">
                {activeQrProduct.sku}
              </div>
              <p className="text-[11px] text-slate-400 leading-normal max-w-xs mx-auto pt-2">
                Telefonunuzdan tarayıcıyı açarak bu QR kodunu kameraya gösterdiğinizde ürün anında bulunacaktır.
              </p>

              <button
                type="button"
                onClick={() => {
                  const pId = activeQrProduct.id;
                  setActiveQrProduct(null);
                  setBulkPrintInitialIds([pId]);
                  setShowBulkPrintModal(true);
                }}
                className="w-full mt-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all active:scale-95 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Etiket Yazdır Şablonuna Git
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toplu QR & Etiket Yazdırma Modalı */}
      {showBulkPrintModal && (
        <BulkQRPrintModal
          products={products}
          initialSelectedIds={bulkPrintInitialIds}
          onClose={() => setShowBulkPrintModal(false)}
        />
      )}

      {/* Fabric Rolls Detail Management Modal */}
      {selectedRollProduct && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] animate-fade-in">
            <div className="flex justify-between items-center border-b border-slate-150 pb-3 mb-4">
              <div>
                <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                  <Layers className="w-5 h-5 text-indigo-600" />
                  Kumaş Topu & Rulo Takip Kartı
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedRollProduct.name} (Toplam Stok: {selectedRollProduct.stock} m)
                </p>
              </div>
              <button
                onClick={() => setSelectedRollProduct(null)}
                className="text-slate-400 hover:text-slate-600 p-1 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Form to Add New Roll */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" />
                  Sisteme Yeni Kumaş Topu / Rulo Ekle
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">Top Numarası / Tanımı</label>
                    <input
                      type="text"
                      value={newRollNumber}
                      onChange={(e) => setNewRollNumber(e.target.value)}
                      placeholder={`Örn: Top #${(selectedRollProduct.rolls?.length || 0) + 1}`}
                      className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 block mb-1">Uzunluk (Metre) *</label>
                    <input
                      type="number"
                      step="0.1"
                      value={newRollLength}
                      onChange={(e) => setNewRollLength(e.target.value)}
                      placeholder="Örn: 25.5"
                      className="w-full px-3 py-2 border border-slate-200 bg-white rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleAddRoll}
                      className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1 transition-all"
                    >
                      <Plus className="w-4 h-4" />
                      Ruloyu Ekle
                    </button>
                  </div>
                </div>
              </div>

              {/* List of current rolls */}
              <div className="space-y-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Mevcut Kumaş Topları</span>
                
                {(!selectedRollProduct.rolls || selectedRollProduct.rolls.length === 0) ? (
                  <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                    Bu ürüne ait aktif kumaş topu bulunmuyor. Lütfen yukarıdaki formu kullanarak ekleyin.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedRollProduct.rolls.map((roll) => {
                      const isEditing = editingRollId === roll.id;
                      return (
                        <div
                          key={roll.id}
                          className={`p-3 rounded-xl border flex flex-col sm:flex-row justify-between sm:items-center gap-3 transition-colors ${
                            isEditing
                              ? "bg-indigo-50/30 border-indigo-300"
                              : "bg-white hover:bg-slate-50 border-slate-200"
                          }`}
                        >
                          {isEditing ? (
                            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div>
                                <label className="text-[9px] text-slate-400 font-bold uppercase block mb-0.5">Top No</label>
                                <input
                                  type="text"
                                  value={editingRollNumber}
                                  onChange={(e) => setEditingRollNumber(e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-slate-300 bg-white rounded-lg text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[9px] text-slate-400 font-bold uppercase block mb-0.5">Metre</label>
                                <input
                                  type="number"
                                  step="0.1"
                                  value={editingRollLength}
                                  onChange={(e) => setEditingRollLength(e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-slate-300 bg-white rounded-lg text-xs"
                                />
                              </div>
                              <div>
                                <label className="text-[9px] text-slate-400 font-bold uppercase block mb-0.5">Durum</label>
                                <select
                                  value={editingRollStatus}
                                  onChange={(e) => setEditingRollStatus(e.target.value as any)}
                                  className="w-full px-2.5 py-1.5 border border-slate-300 bg-white rounded-lg text-xs"
                                >
                                  <option value="available">Mevcut (Satışa Açık)</option>
                                  <option value="reserved">Ayrıldı (Rezerve)</option>
                                  <option value="sold">Tükendi (Satıldı)</option>
                                </select>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                                <Scissors className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-800 text-sm">{roll.rollNumber}</span>
                                  <span
                                    className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                      roll.status === "sold"
                                        ? "bg-slate-100 text-slate-500 font-bold"
                                        : roll.status === "reserved"
                                        ? "bg-amber-100 text-amber-700 font-bold"
                                        : "bg-emerald-100 text-emerald-800 font-bold"
                                    }`}
                                  >
                                    {roll.status === "sold" ? "Satıldı" : roll.status === "reserved" ? "Rezerve" : "Satışta"}
                                  </span>
                                </div>
                                <span className="text-[11px] text-slate-400 block font-mono mt-0.5">
                                  Uzunluk: <span className="font-extrabold text-slate-700">{roll.length} m</span> / {roll.initialLength} m
                                </span>
                              </div>
                            </div>
                          )}

                          <div className="flex items-center gap-2 self-end sm:self-center">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateRoll(roll.id)}
                                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                                >
                                  Kaydet
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingRollId(null)}
                                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-lg transition-colors cursor-pointer"
                                >
                                  İptal
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingRollId(roll.id);
                                    setEditingRollNumber(roll.rollNumber);
                                    setEditingRollLength(String(roll.length));
                                    setEditingRollStatus(roll.status);
                                  }}
                                  title="Düzenle"
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 border border-slate-200 rounded-lg transition-all"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRollQrValue(`${selectedRollProduct.sku}#${roll.id}`)}
                                  title="Rulo QR Kodunu Yazdır"
                                  className="p-1.5 text-slate-400 hover:text-emerald-600 bg-slate-50 hover:bg-emerald-50 border border-slate-200 rounded-lg transition-all"
                                >
                                  <QrCode className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRoll(roll.id)}
                                  title="Sil"
                                  className="p-1.5 text-slate-400 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 border border-slate-200 rounded-lg transition-all"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-150 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedRollProduct(null)}
                className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Specific Roll QR Viewer Modal */}
      {rollQrValue && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-55 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl animate-fade-in border border-slate-200 text-center relative">
            <button
              onClick={() => setRollQrValue(null)}
              className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 font-bold p-1 hover:bg-slate-50 rounded-lg cursor-pointer"
            >
              ✕
            </button>

            <h3 className="font-bold text-slate-800 text-base mb-1">Kumaş Topu QR Kodu</h3>
            <span className="text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-full uppercase tracking-wider inline-block mb-6">
              {selectedRollProduct?.name} - {selectedRollProduct?.rolls?.find(r => `${selectedRollProduct?.sku}#${r.id}` === rollQrValue)?.rollNumber || "Rulo"}
            </span>

            <div className="flex justify-center mb-6">
              <QRImage value={rollQrValue} size={200} />
            </div>

            <div className="space-y-2">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Barkod / SKU Değeri</span>
              <div className="bg-slate-50 border border-slate-200 p-2 rounded-lg font-mono text-xs font-bold text-slate-700 select-all">
                {rollQrValue}
              </div>
              <p className="text-[10px] text-slate-400 leading-normal max-w-xs mx-auto pt-2">
                Bu QR kodunu yazdırıp kumaş topunun üzerine yapıştırabilirsiniz. Barkod okuyucu veya telefon kamerası ile okutulduğunda doğrudan bu kumaş topu seçilecektir.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Product Modal (Barcoded or Unbarcoded) */}
      {showQuickAddModal && (
        <QuickProductModal
          initialBarcode={quickAddInitialBarcode}
          initialName={quickAddInitialName}
          existingProducts={products}
          onAddProduct={async (p) => {
            await onAddProduct(p);
            setShowQuickAddModal(false);
            setQuickAddInitialBarcode(undefined);
            setQuickAddInitialName(undefined);
            if (onRefreshData) await onRefreshData();
          }}
          onSelectExistingProduct={(existingProd) => {
            setShowQuickAddModal(false);
            setReplenishProduct(existingProd);
          }}
          onClose={() => {
            setShowQuickAddModal(false);
            setQuickAddInitialBarcode(undefined);
            setQuickAddInitialName(undefined);
          }}
        />
      )}

      {/* Quick Replenish Modal (Stock In) */}
      {replenishProduct && (
        <QuickReplenishModal
          product={replenishProduct}
          onReplenish={async (productId, quantityToAdd, options) => {
            await handleReplenish(productId, quantityToAdd, options);
          }}
          onClose={() => setReplenishProduct(null)}
        />
      )}

      {/* Inline Camera Scanner Modal for Inventory */}
      {showScannerModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-55 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl border border-slate-200 relative animate-fade-in">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <BarcodeIcon className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-800 text-sm">Barkod / QR Kod Tara</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowScannerModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <QRScanner onScanSuccess={handleInlineScanSuccess} />
          </div>
        </div>
      )}
    </div>
  );
}
