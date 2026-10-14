import React, { useState, useEffect } from "react";
import { 
  Download, 
  Upload, 
  FileSpreadsheet, 
  FileJson, 
  ShieldCheck, 
  Package, 
  Users, 
  Truck, 
  Receipt, 
  BarChart3, 
  Archive, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Filter, 
  Warehouse as WarehouseIcon, 
  Scissors, 
  ClipboardList, 
  ArrowLeftRight, 
  CreditCard, 
  RotateCcw,
  Eye,
  Check,
  X,
  FileCheck,
  RefreshCw,
  ShieldAlert,
  AlertTriangle,
  Database,
  FileText,
  Cloud
} from "lucide-react";
import { auth } from "../lib/firebase";
import { exportService } from "../lib/export/ExportService";
import { importService } from "../lib/export/ImportService";
import { triggerFileDownload } from "../lib/export/fileDownload";
import { getWarehouses, getProducts, getCustomers, getSuppliers, getOrCreateTenantContext } from "../lib/firestoreService";
import { Warehouse, TenantRole } from "../types";
import { 
  ExportDomain, 
  ExportFormat, 
  ExportFilterOptions, 
  ImportPreview,
  BackupRestoreMode,
  BackupValidationResult,
  RestoreExecutionResult
} from "../lib/export/types";

interface DataExportProps {
  companyName?: string;
  tenantId?: string;
}

interface ExportItem {
  id: ExportDomain;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badge: string;
  category: "catalog" | "crm" | "logistics" | "finance" | "backup";
  handler: (uid: string, format: ExportFormat, filters?: ExportFilterOptions) => Promise<any>;
}

export function DataExport({ companyName, tenantId }: DataExportProps) {
  const [activeSubTab, setActiveSubTab] = useState<"export" | "import" | "backup">("export");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [lastExported, setLastExported] = useState<{ title: string; count: number; time: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // User Role & Permissions State
  const [userRole, setUserRole] = useState<TenantRole | "owner">("owner");

  // Filter State
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<ExportFilterOptions>({
    startDate: "",
    endDate: "",
    warehouseId: "",
    saleStatus: "",
    orderStatus: "",
    paymentMethod: ""
  });
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // Import State
  const [importDomain, setImportDomain] = useState<"products" | "customers" | "suppliers">("products");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);

  // Backup Restore State
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreValidation, setRestoreValidation] = useState<BackupValidationResult | null>(null);
  const [restoreMode, setRestoreMode] = useState<BackupRestoreMode>("safe_append");
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgressMsg, setRestoreProgressMsg] = useState<string | null>(null);
  const [restoreSuccessResult, setRestoreSuccessResult] = useState<RestoreExecutionResult | null>(null);
  const [allowLegacyRestore, setAllowLegacyRestore] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Cloud Backup State (FAZ 5A)
  const [cloudBackupLoading, setCloudBackupLoading] = useState(false);
  const [cloudBackupStatus, setCloudBackupStatus] = useState<{
    lastBackupTime?: string;
    status?: "success" | "pending" | "failed";
    totalRecords?: number;
    checksum?: string;
    message?: string;
  } | null>(null);

  const handleTriggerCloudBackup = async () => {
    if (userRole !== "owner" && userRole !== "admin") return;
    setCloudBackupLoading(true);
    try {
      const uid = auth.currentUser?.uid || "demo-user";
      const archive = await exportService.createTenantBackup(uid);
      const res = await fetch(`/api/backup/tenant/${archive.metadata.tenantId}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: archive.metadata.companyName,
          data: archive.data
        })
      });
      const data = await res.json();
      if (data.status === "success") {
        setCloudBackupStatus({
          lastBackupTime: data.completedAt,
          status: "success",
          totalRecords: data.totalRecords,
          checksum: data.checksum,
          message: "Bulut yedeği özel depolama alanına başarıyla yüklendi ve SHA-256 ile doğrulandı."
        });
      } else {
        setCloudBackupStatus({
          status: "failed",
          message: data.error || "Yedekleme sırasında hata oluştu."
        });
      }
    } catch (e: any) {
      setCloudBackupStatus({
        status: "failed",
        message: e.message || "Bağlantı hatası oluştu."
      });
    } finally {
      setCloudBackupLoading(false);
    }
  };

  useEffect(() => {
    const uid = auth.currentUser?.uid || "demo-user";
    getWarehouses(uid).then(res => setWarehouses(res)).catch(() => {});
    getOrCreateTenantContext(uid).then(ctx => {
      if (ctx && ctx.role) {
        setUserRole(ctx.role);
      }
    }).catch(() => {});
  }, []);

  const exportOptions: ExportItem[] = [
    {
      id: "products",
      title: "Ürün Kataloğu",
      description: "Tüm aktif ve arşivdeki ürünler, barkodlar, fiyatlar, kategoriler ve birimler.",
      icon: Package,
      color: "text-indigo-600 bg-indigo-50 border-indigo-100",
      badge: "Ürünler",
      category: "catalog",
      handler: (uid, format, f) => exportService.exportProducts(uid, format, f)
    },
    {
      id: "stock",
      title: "Detaylı Stok Raporu",
      description: "Mevcut stok adetleri, kritik eşik farkları, toplam stok değeri ve sağlık durumu.",
      icon: BarChart3,
      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
      badge: "Envanter",
      category: "catalog",
      handler: (uid, format, f) => exportService.exportStockReport(uid, format, f)
    },
    {
      id: "warehouses",
      title: "Depolar & Şubeler",
      description: "Kayıtlı fiziksel depolar, şube kodları, konumlar ve varsayılan depo bilgisi.",
      icon: WarehouseIcon,
      color: "text-blue-600 bg-blue-50 border-blue-100",
      badge: "Depolar",
      category: "logistics",
      handler: (uid, format) => exportService.exportWarehouses(uid, format)
    },
    {
      id: "rolls",
      title: "Rulolar / Kumaş Stokları",
      description: "Tüm kumaş topları, rulo numaraları, başlangıç ve kalan metrajlar, kesim durumları.",
      icon: Scissors,
      color: "text-amber-600 bg-amber-50 border-amber-100",
      badge: "Tekstil / Rulo",
      category: "logistics",
      handler: (uid, format, f) => exportService.exportRolls(uid, format, f)
    },
    {
      id: "customers",
      title: "Müşteriler & Cari Defter",
      description: "Müşteri rehberi, telefon, Instagram, kalan borç ve toplam tahsilat bakiyeleri.",
      icon: Users,
      color: "text-sky-600 bg-sky-50 border-sky-100",
      badge: "Müşteriler",
      category: "crm",
      handler: (uid, format, f) => exportService.exportCustomers(uid, format, f)
    },
    {
      id: "suppliers",
      title: "Tedarikçiler",
      description: "Toptancı ve tedarikçi firma rehberi, yetkililer, telefonlar, adresler ve bakiyeler.",
      icon: Truck,
      color: "text-orange-600 bg-orange-50 border-orange-100",
      badge: "Toptancılar",
      category: "crm",
      handler: (uid, format, f) => exportService.exportSuppliers(uid, format, f)
    },
    {
      id: "sales",
      title: "Satış Geçmişi",
      description: "Tüm POS fişleri, tarihler, satılan kalem sayıları, tutarlar ve ödeme türleri.",
      icon: Receipt,
      color: "text-purple-600 bg-purple-50 border-purple-100",
      badge: "Satışlar",
      category: "finance",
      handler: (uid, format, f) => exportService.exportSales(uid, format, f)
    },
    {
      id: "orders",
      title: "Siparişler & İrsaliyeler",
      description: "Sipariş numaraları, sevk durumları, irsaliye numaraları ve müşteri detayları.",
      icon: ClipboardList,
      color: "text-indigo-600 bg-indigo-50 border-indigo-100",
      badge: "Siparişler",
      category: "logistics",
      handler: (uid, format, f) => exportService.exportOrders(uid, format, f)
    },
    {
      id: "transactions",
      title: "Cari Hareketler",
      description: "Müşterilere ait tüm veresiye borçlandırma ve tahsilat hareket dökümü.",
      icon: ArrowLeftRight,
      color: "text-teal-600 bg-teal-50 border-teal-100",
      badge: "Cari Hareket",
      category: "finance",
      handler: (uid, format, f) => exportService.exportTransactions(uid, format, f)
    },
    {
      id: "payments",
      title: "Ödemeler & Tahsilatlar",
      description: "Kasa ve bankaya giren/çıkan tüm tahsilat ve tediye makbuz kayıtları.",
      icon: CreditCard,
      color: "text-rose-600 bg-rose-50 border-rose-100",
      badge: "Kasa / Ödeme",
      category: "finance",
      handler: (uid, format, f) => exportService.exportPayments(uid, format, f)
    },
    {
      id: "stock_movements",
      title: "Stok Hareketleri",
      description: "Giriş, çıkış, depo transferi, sayım düzeltmesi ve kesim hareket kayıtları.",
      icon: RotateCcw,
      color: "text-slate-700 bg-slate-100 border-slate-200",
      badge: "Hareketler",
      category: "logistics",
      handler: (uid, format, f) => exportService.exportStockMovements(uid, format, f)
    },
    {
      id: "full_backup",
      title: "Tam İşletme Yedeği (Snapshot)",
      description: "Tüm şirket veritabanını içeren, güvenlik garantili ve taşınabilir JSON paketi.",
      icon: Archive,
      color: "text-slate-800 bg-slate-100 border-slate-300",
      badge: "Tam Yedek",
      category: "backup",
      handler: (uid) => exportService.exportFullTenantBackup(uid)
    }
  ];

  const handleExport = async (item: ExportItem, format: ExportFormat = "csv") => {
    setErrorMsg(null);
    const uid = auth.currentUser?.uid || "demo-user";
    const downloadKey = `${item.id}_${format}`;
    setDownloadingId(downloadKey);

    try {
      const activeFilters = showFilters ? filters : undefined;
      const result = await item.handler(uid, format, activeFilters);
      triggerFileDownload(result.content, result.fileName, result.mimeType);

      setLastExported({
        title: item.title,
        count: result.recordCount,
        time: new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
      });
    } catch (err: any) {
      console.error("Export error:", err);
      setErrorMsg(err.message || "Veri dışa aktarılırken bir hata oluştu.");
    } finally {
      setDownloadingId(null);
    }
  };

  // Import file handler & preview generator
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setImportPreview(null);
    setImportSuccessMsg(null);
    setErrorMsg(null);

    try {
      const uid = auth.currentUser?.uid || "demo-user";

      let existingItems: any[] = [];
      if (importDomain === "products") {
        existingItems = await getProducts(uid, true);
      } else if (importDomain === "customers") {
        existingItems = await getCustomers(uid);
      } else if (importDomain === "suppliers") {
        existingItems = await getSuppliers(uid);
      }

      const parsed = await importService.parseFile(file);
      const mapping = importService.autoDetectColumnMapping(parsed.headers);
      const preview = importService.previewUniversalImport(
        parsed.rows, 
        parsed.headers, 
        mapping, 
        importDomain, 
        existingItems
      );
      setImportPreview(preview);
    } catch (err: any) {
      setErrorMsg("Dosya okunurken veya ayrıştırılırken hata oluştu: " + err.message);
    }
  };

  const handleExecuteImport = async () => {
    if (!importPreview || importPreview.validRows === 0) return;
    setIsImporting(true);
    setErrorMsg(null);
    setImportSuccessMsg(null);

    try {
      const uid = auth.currentUser?.uid || "demo-user";
      const validItems = importPreview.previewRows.filter(r => !r._hasError);
      const res = await importService.executeUniversalBatchImport(uid, importDomain, validItems);

      setImportSuccessMsg(`${res.insertedCount} adet kayıt başarıyla içe aktarıldı ve tenant verinize eklendi.`);
      setImportPreview(null);
      setSelectedFile(null);
    } catch (err: any) {
      setErrorMsg(err.message || "İçe aktarma yürütülürken hata oluştu.");
    } finally {
      setIsImporting(false);
    }
  };

  // Backup restore file parser & validation handler
  const handleBackupFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreFile(file);
    setRestoreValidation(null);
    setRestoreSuccessResult(null);
    setAllowLegacyRestore(false);
    setErrorMsg(null);

    try {
      const activeTenantId = tenantId || auth.currentUser?.uid || "demo-user";
      const text = await file.text();
      const val = await exportService.previewBackupFile(text, activeTenantId);
      setRestoreValidation(val);
      if (!val.isValid) {
        setErrorMsg(val.error || "Yedek dosyası doğrulamadan geçemedi.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Yedek dosyası okunurken hata oluştu.");
    }
  };

  // Execute restore backup
  const handleExecuteRestore = async () => {
    if (!restoreValidation || !restoreValidation.isValid || !restoreValidation.archive) {
      setErrorMsg("Geçerli bir yedek doğrulanmadı.");
      return;
    }

    const uid = auth.currentUser?.uid || "demo-user";
    setIsRestoring(true);
    setErrorMsg(null);
    setRestoreProgressMsg("Yedekten geri yükleme başlatılıyor...");

    try {
      const result = await exportService.restoreTenantBackup(uid, restoreValidation.archive, {
        mode: restoreMode,
        allowLegacyUnverified: allowLegacyRestore,
        onProgress: (p, t, msg) => setRestoreProgressMsg(msg)
      });

      setRestoreSuccessResult(result);
      setShowConfirmModal(false);
      setRestoreFile(null);
      setRestoreValidation(null);
      
      // Refresh local warehouses
      getWarehouses(uid).then(res => setWarehouses(res)).catch(() => {});
    } catch (err: any) {
      console.error("Backup restore execution error:", err);
      setErrorMsg(err.message || "Yedekten geri yükleme işlemi sırasında bir hata oluştu.");
    } finally {
      setIsRestoring(false);
      setRestoreProgressMsg(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Multi-Tenant Isolation Guarantee */}
      <div className="bg-gradient-to-r from-emerald-50 via-teal-50/50 to-slate-50 p-5 rounded-2xl border border-emerald-150 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-800 text-sm">İşletme Veri Güvenliği ve İzolasyon Garantisi</h3>
              <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                Tenant Korumalı
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-xl leading-relaxed">
              Dışa aktarılan veya yedeklenen tüm dosyalar yalnızca şirketiniz ({companyName || "Aktif İşletme"}) adına kayıtlı verileri içerir. Sistem mimarisi gereği başka hiçbir işletmenin verisine erişilemez. Hassas API anahtarları ve şifreler otomatik olarak arındırılır.
            </p>
          </div>
        </div>

        {tenantId && (
          <div className="text-right sm:border-l sm:border-emerald-200/60 sm:pl-4 flex-shrink-0">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Yetkili Kiracı ID</span>
            <span className="text-xs font-mono font-bold text-slate-700">{tenantId.slice(0, 14)}...</span>
          </div>
        )}
      </div>

      {/* 2. Sub-Tabs Bar: Export / Import / Backup */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setActiveSubTab("export")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === "export"
                ? "bg-white text-emerald-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>Veri Dışa Aktarma (Export)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("import")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === "import"
                ? "bg-white text-indigo-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Upload className="w-4 h-4 text-indigo-600" />
            <span>İçe Aktarma Önizleme (Import)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab("backup")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeSubTab === "backup"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Archive className="w-4 h-4 text-slate-700" />
            <span>Yedekleme & Arşiv (Backup)</span>
          </button>
        </div>

        {activeSubTab === "export" && (
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border transition-all cursor-pointer ${
              showFilters || Object.values(filters).some(Boolean)
                ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Filter className="w-3.5 h-3.5 text-indigo-600" />
            <span>Filtreli Dışa Aktar</span>
            {Object.values(filters).filter(Boolean).length > 0 && (
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center font-bold">
                {Object.values(filters).filter(Boolean).length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Notification Messages */}
      {lastExported && (
        <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 p-4 rounded-xl text-xs flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>
              <strong>{lastExported.title}</strong> başarıyla indirildi. ({lastExported.count} kayıt, Saat: {lastExported.time})
            </span>
          </div>
          <button type="button" onClick={() => setLastExported(null)} className="text-emerald-700 hover:text-emerald-900 font-bold ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {importSuccessMsg && (
        <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 p-4 rounded-xl text-xs flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{importSuccessMsg}</span>
          </div>
          <button type="button" onClick={() => setImportSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 font-bold ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 text-rose-700 border border-rose-200 p-4 rounded-xl text-xs flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button type="button" onClick={() => setErrorMsg(null)} className="text-rose-700 hover:text-rose-900 font-bold ml-2 cursor-pointer">✕</button>
        </div>
      )}

      {/* FILTER DRAWER / PANEL */}
      {activeSubTab === "export" && showFilters && (
        <div className="bg-white p-5 rounded-2xl border border-indigo-150 shadow-sm space-y-4 animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-indigo-600" />
              <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider">Aktif Export Filtreleri</h4>
            </div>
            <button
              type="button"
              onClick={() => setFilters({ startDate: "", endDate: "", warehouseId: "", saleStatus: "", orderStatus: "", paymentMethod: "" })}
              className="text-xs text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
            >
              Filtreleri Temizle
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="font-bold text-slate-600 block mb-1">Başlangıç Tarihi</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={e => setFilters({ ...filters, startDate: e.target.value })}
                className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white"
              />
            </div>

            <div>
              <label className="font-bold text-slate-600 block mb-1">Bitiş Tarihi</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={e => setFilters({ ...filters, endDate: e.target.value })}
                className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white"
              />
            </div>

            <div>
              <label className="font-bold text-slate-600 block mb-1">Depo Filtresi</label>
              <select
                value={filters.warehouseId}
                onChange={e => setFilters({ ...filters, warehouseId: e.target.value })}
                className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white"
              >
                <option value="">Tüm Depolar</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-600 block mb-1">Stok Durumu</label>
              <select
                value={filters.saleStatus}
                onChange={e => setFilters({ ...filters, saleStatus: e.target.value })}
                className="w-full p-2 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white"
              >
                <option value="">Tümü</option>
                <option value="critical">Kritik Stoktaki Ürünler</option>
                <option value="out_of_stock">Tükenen Ürünler</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: EXPORT CARDS GRID */}
      {activeSubTab === "export" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {exportOptions.filter(o => o.id !== "full_backup").map((item) => {
            const Icon = item.icon;
            const isDownloadingCsv = downloadingId === `${item.id}_csv`;
            const isDownloadingJson = downloadingId === `${item.id}_json`;

            return (
              <div
                key={item.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${item.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">
                      {item.badge}
                    </span>
                  </div>

                  <h4 className="font-bold text-slate-800 text-sm">{item.title}</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed min-h-[38px]">
                    {item.description}
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleExport(item, "csv")}
                    disabled={Boolean(downloadingId)}
                    className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs active:scale-95"
                    title="Excel ve Google E-Tablolar uyumlu UTF-8 Türkçe CSV formatı"
                  >
                    {isDownloadingCsv ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Hazırlanıyor...</span>
                      </>
                    ) : (
                      <>
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
                        <span>Excel / CSV</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExport(item, "json")}
                    disabled={Boolean(downloadingId)}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                    title="Yazılımsal API entegrasyonları için JSON formatı"
                  >
                    {isDownloadingJson ? (
                      <div className="w-3.5 h-3.5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <FileJson className="w-3.5 h-3.5 text-slate-500" />
                        <span>JSON</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: IMPORT PREVIEW & VALIDATION FOUNDATION */}
      {activeSubTab === "import" && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
              <Upload className="w-5 h-5 text-indigo-600" />
              <span>Güvenli CSV Veri İçe Aktarma Altyapısı</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Toplu ürün, müşteri veya tedarikçi listelerinizi sisteme yükleyin. Veritabanına yazılmadan önce kolon eşleştirmesi, duplicate kontrolü ve geçersiz satırlar önizlenir.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1.5">Hedef Veri Tipi</label>
              <div className="grid grid-cols-3 gap-2">
                {(["products", "customers", "suppliers"] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setImportDomain(d); setImportPreview(null); setSelectedFile(null); }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      importDomain === d 
                        ? "bg-indigo-600 border-indigo-600 text-white shadow-xs" 
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {d === "products" ? "Ürünler" : d === "customers" ? "Müşteriler" : "Tedarikçiler"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1.5">Excel (.xlsx) veya CSV Dosyası Seç</label>
              <input
                type="file"
                accept=".xlsx, .xls, .csv, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer"
              />
            </div>
          </div>

          {/* Import Preview Card */}
          {importPreview && (
            <div className="border border-slate-200 rounded-xl p-5 bg-slate-50/50 space-y-4 animate-fade-in">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase">Toplam Satır</span>
                  <span className="text-lg font-bold text-slate-800">{importPreview.totalRows}</span>
                </div>
                <div className="bg-white p-3 rounded-lg border border-emerald-200">
                  <span className="text-[10px] font-bold text-emerald-600 block uppercase">Geçerli Satır</span>
                  <span className="text-lg font-bold text-emerald-700">{importPreview.validRows}</span>
                </div>
                <div className="bg-white p-3 rounded-lg border border-amber-200">
                  <span className="text-[10px] font-bold text-amber-600 block uppercase">Mükerrer (Duplicate)</span>
                  <span className="text-lg font-bold text-amber-700">{importPreview.duplicateRows}</span>
                </div>
                <div className="bg-white p-3 rounded-lg border border-rose-200">
                  <span className="text-[10px] font-bold text-rose-600 block uppercase">Hatalı Satır</span>
                  <span className="text-lg font-bold text-rose-700">{importPreview.invalidRows}</span>
                </div>
              </div>

              {/* Errors List */}
              {importPreview.errors.length > 0 && (
                <div className="bg-rose-50 border border-rose-200 p-4 rounded-xl text-xs space-y-1">
                  <span className="font-bold text-rose-800 block mb-1">Tespit Edilen Satır Hataları:</span>
                  {importPreview.errors.slice(0, 5).map((err, i) => (
                    <div key={i} className="text-rose-700">
                      • Satır {err.rowNumber} {err.field ? `(${err.field})` : ""}: {err.message}
                    </div>
                  ))}
                  {importPreview.errors.length > 5 && (
                    <div className="text-rose-500 font-semibold mt-1">
                      ...ve {importPreview.errors.length - 5} diğer satır hatası
                    </div>
                  )}
                </div>
              )}

              {/* Commit Button */}
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-500">
                  İçe aktarma sırasında kayıtlar otomatik olarak yalnızca şirketinizin <strong>{tenantId?.slice(0, 8)}...</strong> kiracı kimliğine bağlanır.
                </span>

                <button
                  type="button"
                  onClick={handleExecuteImport}
                  disabled={isImporting || importPreview.validRows === 0}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all shadow-sm active:scale-95"
                >
                  {isImporting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>İçe Aktarılıyor...</span>
                    </>
                  ) : (
                    <>
                      <FileCheck className="w-4 h-4" />
                      <span>{importPreview.validRows} Kaydı İçe Aktar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: BACKUP & DISASTER RECOVERY */}
      {activeSubTab === "backup" && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-8">
          {/* Header */}
          <div className="border-b border-slate-100 pb-4">
            <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
              <Archive className="w-5 h-5 text-slate-800" />
              <span>Çoklu Veritabanı Uyumlu Yedekleme & Geri Yükleme Motoru (Backup & Disaster Recovery)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              İşletmenizin ürün, stok, depo, rulo, müşteri, tedarikçi, satış, sipariş ve cari hareketlerinin tamamını içeren tam arşiv snapshot paketi oluşturun veya mevcut yedeği güvenli biçimde geri yükleyin.
            </p>
          </div>

          {/* Architecture badges */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <span className="text-[10px] font-bold text-indigo-600 block uppercase tracking-wider">Aktif Depolama Adapteri</span>
              <h4 className="font-bold text-slate-800 text-sm">Firebase / Firestore</h4>
              <p className="text-xs text-slate-500">Mevcut bulut veritabanınız üzerinden anlık tenant snapshot'ı üretilir ve atomik geri yüklenir.</p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <span className="text-[10px] font-bold text-emerald-600 block uppercase tracking-wider">Gelecek Mimarisi Desteği</span>
              <h4 className="font-bold text-slate-800 text-sm">Supabase / PostgreSQL</h4>
              <p className="text-xs text-slate-500">Sistem abstraction katmanı sayesinde gelecekte doğrudan ilişkisel SQL yedeğine çevrilebilir.</p>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <span className="text-[10px] font-bold text-purple-600 block uppercase tracking-wider">Bütünlük & Güvenlik</span>
              <h4 className="font-bold text-slate-800 text-sm">Bütünlük & Tenant Kilidi</h4>
              <p className="text-xs text-slate-500">Yedekler şirket ID'si ile kilitlenir; başka bir şirkete yüklenmesi mimari olarak engellenir.</p>
            </div>
          </div>

          {/* SECTION 1: DOWNLOAD BACKUP */}
          <div className="p-5 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <Download className="w-4 h-4 text-slate-700" />
                  <span>1. Tam Şirket Snapshot Yedeği İndir</span>
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tüm ürün katalogları, stok hareketleri, depolar, cari defterler ve satış fişlerini tek bir JSON paketine aktarın.
                </p>
              </div>

              <button
                type="button"
                disabled={Boolean(downloadingId)}
                onClick={() => handleExport(exportOptions.find(o => o.id === "full_backup")!, "json")}
                className="px-5 py-2.5 bg-slate-900 hover:bg-black disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all shadow-sm active:scale-95 flex-shrink-0"
              >
                {downloadingId === "full_backup_json" ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Paketleniyor...</span>
                  </>
                ) : (
                  <>
                    <Archive className="w-4 h-4 text-slate-300" />
                    <span>Yedek Dosyasını İndir (.json)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* SECTION 2: RESTORE BACKUP */}
          <div className="p-5 rounded-2xl border border-amber-200/80 bg-amber-50/30 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <Upload className="w-4 h-4 text-amber-700" />
                  <span>2. Güvenli Yedekten Geri Yükleme (Restore Engine)</span>
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Önceden indirilmiş StokPro JSON yedek dosyasını sisteme yükleyin. Veriler veritabanına işlenmeden önce şema doğrulanır ve önizleme sunulur.
                </p>
              </div>

              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rolünüz:</span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                  userRole === "owner" ? "bg-amber-100 text-amber-800" :
                  userRole === "admin" ? "bg-indigo-100 text-indigo-800" :
                  "bg-slate-200 text-slate-700"
                }`}>
                  {userRole.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Role restriction notice if not owner/admin */}
            {userRole !== "owner" && userRole !== "admin" && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Yetki Kısıtlaması</span>
                  Yedekten geri yükleme işlemi şirket verilerini doğrudan güncellediğinden yalnızca <strong>'Owner'</strong> veya <strong>'Admin'</strong> yetkisine sahip kullanıcılar tarafından yürütülebilir. Mevcut rolünüz ({userRole}) ile geri yükleme yapılamaz.
                </div>
              </div>
            )}

            {/* File Input & Options */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">Yedek Dosyası (.json)</label>
                <input
                  type="file"
                  accept=".json, application/json"
                  disabled={userRole !== "owner" && userRole !== "admin"}
                  onChange={handleBackupFileChange}
                  className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-amber-100 file:text-amber-800 hover:file:bg-amber-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">Geri Yükleme ve Çatışma Stratejisi</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRestoreMode("safe_append")}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      restoreMode === "safe_append"
                        ? "bg-amber-600 border-amber-600 text-white shadow-xs"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Yalnızca Eksikleri Ekle (Güvenli)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestoreMode("merge_non_financial")}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      restoreMode === "merge_non_financial" || restoreMode === "merge_upsert"
                        ? "bg-amber-600 border-amber-600 text-white shadow-xs"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Katalogları Güncelle (Finansal Hariç)
                  </button>
                </div>
              </div>
            </div>

            {/* Validation Preview Card */}
            {restoreValidation && restoreValidation.isValid && restoreValidation.itemCounts && (
              <div className={`border bg-white rounded-xl p-5 space-y-4 animate-fade-in shadow-xs ${
                restoreValidation.isLegacy ? "border-amber-300" : "border-emerald-200"
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                  {restoreValidation.isLegacy ? (
                    <div className="flex items-center gap-2 text-amber-800 text-xs font-bold">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span>Dosyanın Kriptografik Bütünlüğü Doğrulanamadı (Eski v{restoreValidation.schemaVersion} Formatı)</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-emerald-700 text-xs font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Kriptografik SHA-256 Bütünlüğü Doğrulandı (Şema v{restoreValidation.schemaVersion})</span>
                    </div>
                  )}
                  <span className="text-[11px] font-mono text-slate-500">
                    Oluşturulma: {restoreValidation.exportedAt ? new Date(restoreValidation.exportedAt).toLocaleString("tr-TR") : "-"}
                  </span>
                </div>

                {/* Legacy Unverified Archive Warning & Explicit Consent */}
                {restoreValidation.isLegacy && (
                  <div className="p-4 bg-amber-50/80 border border-amber-300 rounded-xl space-y-2.5 text-xs text-amber-900">
                    <div className="font-bold flex items-center gap-2 text-amber-800">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span>Eski Yedek Formatı Koruması (Doğrulanmamış Arşiv)</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-amber-800">
                      Bu yedek dosyası eski format etiketine sahip olup (<code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-[10px]">sha256_...</code>) aktarım sırasında bozulup bozulmadığını veya değiştirilip değiştirilmediğini saptayan modern SHA-256 kriptografik özeti içermemektedir. Güvenlik gereği eski formatlı yedeklerin yüklenmesi varsayılan olarak kapalıdır.
                    </p>
                    <label className="flex items-start gap-2.5 pt-1 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allowLegacyRestore}
                        onChange={(e) => setAllowLegacyRestore(e.target.checked)}
                        className="mt-0.5 w-4 h-4 text-amber-600 rounded border-amber-300 focus:ring-amber-500 cursor-pointer"
                      />
                      <span className="font-semibold text-amber-950 text-xs">
                        Bu eski yedeğin kriptografik olarak doğrulanamadığını ve riskleri anladığımı onaylıyorum.
                      </span>
                    </label>
                  </div>
                )}

                {/* Company match & Tenant Isolation indicator */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Yedekteki Kaynak Şirket</span>
                    <span className="font-bold text-slate-800">{restoreValidation.companyName || "Şirket Bilgisi"}</span>
                    <span className="block text-[11px] font-mono text-slate-500">{restoreValidation.sourceTenantId}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-emerald-600 block uppercase">Hedef Aktif Şirket</span>
                    <span className="font-bold text-slate-800">{companyName || "Aktif Şirket"}</span>
                    <span className="block text-[11px] font-mono text-emerald-700">{tenantId || auth.currentUser?.uid || "Aktif Kiracı"}</span>
                  </div>
                </div>

                {/* Warnings (if any) */}
                {restoreValidation.warnings && restoreValidation.warnings.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                    <span className="font-bold block">Dikkat Edilmesi Gereken Durumlar:</span>
                    {restoreValidation.warnings.map((w, i) => (
                      <div key={i}>• {w}</div>
                    ))}
                  </div>
                )}

                {/* Record Counts Breakdown */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Ürünler</span>
                    <span className="text-base font-bold text-slate-800">{restoreValidation.itemCounts.products}</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Müşteriler</span>
                    <span className="text-base font-bold text-slate-800">{restoreValidation.itemCounts.customers}</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Tedarikçiler</span>
                    <span className="text-base font-bold text-slate-800">{restoreValidation.itemCounts.suppliers}</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Satış Fişleri</span>
                    <span className="text-base font-bold text-slate-800">{restoreValidation.itemCounts.sales}</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Depolar</span>
                    <span className="text-base font-bold text-slate-800">{restoreValidation.itemCounts.warehouses}</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Siparişler</span>
                    <span className="text-base font-bold text-slate-800">{restoreValidation.itemCounts.orders}</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Ödemeler / Kasa</span>
                    <span className="text-base font-bold text-slate-800">{restoreValidation.itemCounts.payments}</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 block uppercase">Stok Hareketleri</span>
                    <span className="text-base font-bold text-slate-800">{restoreValidation.itemCounts.stockMovements}</span>
                  </div>
                </div>

                {/* Safety and merge explanation */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 space-y-1">
                  <div className="font-bold text-slate-700">Veri Güvenliği ve Birleştirme (Merge) Garantisi:</div>
                  <div>• Mevcut şirket verileri topluca silinmez veya veritabanı sıfırlanmaz.</div>
                  <div>• Aynı ID'ye sahip ürün ve kayıtlar güncellenir; yeni ID'ye sahip kayıtlar eklenir.</div>
                  <div>• Tüm kayıtlar zorunlu olarak aktif firmanızın ({tenantId?.slice(0, 10)}...) ID'sine mühürlenir.</div>
                  <div>• Kullanıcı rolleri, abonelik izinleri ve sistem sırları asla değiştirilemez.</div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                  <div className="text-xs text-slate-500">
                    Toplam <strong>{restoreValidation.totalRecords}</strong> kayıt geri yüklenecektir.
                    {restoreValidation.isLegacy && !allowLegacyRestore && (
                      <span className="block text-[11px] text-amber-700 font-medium mt-0.5">
                        * Doğrulanmamış eski formatı yükleyebilmek için lütfen yukarıdaki onay kutusunu işaretleyiniz.
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    disabled={isRestoring || (userRole !== "owner" && userRole !== "admin") || (Boolean(restoreValidation.isLegacy) && !allowLegacyRestore)}
                    className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all shadow-sm active:scale-95 flex-shrink-0"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Geri Yüklemeyi Başlat...</span>
                  </button>
                </div>
              </div>
            )}

            {/* Restore Progress Display */}
            {isRestoring && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <span className="text-xs font-bold text-amber-800">
                  {restoreProgressMsg || "Yedekten geri yükleme yürütülüyor, lütfen bekleyiniz..."}
                </span>
              </div>
            )}

            {/* Restore Result Summary Card */}
            {restoreSuccessResult && (
              <div className={`p-5 rounded-xl space-y-3 animate-fade-in border ${
                restoreSuccessResult.errors.length === 0 
                  ? "bg-emerald-50 border-emerald-200" 
                  : "bg-amber-50 border-amber-200"
              }`}>
                <div className="flex items-center gap-2 font-bold text-sm">
                  {restoreSuccessResult.errors.length === 0 ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <span className="text-emerald-800">Yedekten Geri Yükleme Başarıyla Tamamlandı!</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-5 h-5 text-amber-600" />
                      <span className="text-amber-800">Geri Yükleme Kısmen Tamamlandı (Bazı Kayıtlar Uyarılı)</span>
                    </>
                  )}
                </div>
                <div className="text-xs text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Eklenen Yeni Kayıt: <strong className="text-emerald-700">{restoreSuccessResult.totalRestored}</strong></span>
                  <span>Korunan / Atlanan Mevcut Kayıt: <strong className="text-amber-700">{restoreSuccessResult.totalSkipped || 0}</strong></span>
                  {restoreSuccessResult.checkpointFingerprint && (
                    <span className="text-[11px] font-mono text-slate-500">Parmak İzi: {restoreSuccessResult.checkpointFingerprint.slice(0, 20)}...</span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] text-slate-800">
                  <div>• Ürünler: +{restoreSuccessResult.restoredCounts.products} (Atlanan: {restoreSuccessResult.skippedCounts?.products || 0})</div>
                  <div>• Müşteriler: +{restoreSuccessResult.restoredCounts.customers} (Atlanan: {restoreSuccessResult.skippedCounts?.customers || 0})</div>
                  <div>• Tedarikçiler: +{restoreSuccessResult.restoredCounts.suppliers} (Atlanan: {restoreSuccessResult.skippedCounts?.suppliers || 0})</div>
                  <div>• Satışlar: +{restoreSuccessResult.restoredCounts.sales} (Atlanan: {restoreSuccessResult.skippedCounts?.sales || 0})</div>
                  <div>• Depolar: +{restoreSuccessResult.restoredCounts.warehouses} (Atlanan: {restoreSuccessResult.skippedCounts?.warehouses || 0})</div>
                  <div>• Siparişler: +{restoreSuccessResult.restoredCounts.orders} (Atlanan: {restoreSuccessResult.skippedCounts?.orders || 0})</div>
                  <div>• Ödemeler: +{restoreSuccessResult.restoredCounts.payments} (Atlanan: {restoreSuccessResult.skippedCounts?.payments || 0})</div>
                  <div>• Hareketler: +{restoreSuccessResult.restoredCounts.stockMovements} (Atlanan: {restoreSuccessResult.skippedCounts?.stockMovements || 0})</div>
                </div>

                {restoreSuccessResult.errors.length > 0 && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-1.5 mt-2">
                    <span className="font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                      Kısmi Aktarım - Karşılaşılan Batch Hataları:
                    </span>
                    <div className="space-y-1 pl-5">
                      {restoreSuccessResult.errors.map((err, i) => (
                        <div key={i} className="font-mono text-[11px]">• {err}</div>
                      ))}
                    </div>
                    <div className="pt-1.5 border-t border-rose-200/60 text-[11px] text-rose-700 flex items-center gap-1">
                      <RefreshCw className="w-3.5 h-3.5 flex-shrink-0 text-rose-600" />
                      <span><strong>Güvenli Yeniden Deneme:</strong> Başarıyla yazılan kayıtlar veritabanında korunmuştur. Dosyayı tekrar seçip işlemi yeniden başlattığınızda önceden eklenen kayıtlar çiftlenmez (mükerrer kayıt engeli aktiftir).</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SECTION 3: AUTOMATIC CLOUD BACKUP & SCHEDULERS (FAZ 5A) */}
          <div className="p-5 rounded-2xl border border-indigo-200/80 bg-indigo-50/30 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <Cloud className="w-4 h-4 text-indigo-600" />
                  <span>3. Otomatik Bulut Yedekleme (Cloud Schedulers & Retention)</span>
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Kullanıcı bilgisayarı açık olmasa dahi sunucu tarafında her gece 02:00 TSİ'de şirket verileriniz otomatik olarak yedeklenir.
                </p>
              </div>

              {(userRole === "owner" || userRole === "admin") && (
                <button
                  type="button"
                  onClick={handleTriggerCloudBackup}
                  disabled={cloudBackupLoading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all shadow-xs active:scale-95 flex-shrink-0"
                >
                  {cloudBackupLoading ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Buluta Paketleniyor...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Şimdi Bulut Yedeği Al</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Cloud Backup Badges & Specs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <div className="p-2.5 bg-white border border-indigo-100 rounded-xl text-[11px]">
                <span className="text-indigo-600 font-bold block mb-0.5">Zamanlama Döngüsü</span>
                <span className="text-slate-700 font-medium">Her Gece 02:00 (Europe/Istanbul)</span>
              </div>
              <div className="p-2.5 bg-white border border-indigo-100 rounded-xl text-[11px]">
                <span className="text-indigo-600 font-bold block mb-0.5">Saklama Süresi (Retention)</span>
                <span className="text-slate-700 font-medium">30 Günlük Otomatik Döngü</span>
              </div>
              <div className="p-2.5 bg-white border border-indigo-100 rounded-xl text-[11px]">
                <span className="text-indigo-600 font-bold block mb-0.5">Depolama Konumu</span>
                <span className="text-slate-700 font-medium">Özel Cloud Storage (İzole Bucket)</span>
              </div>
            </div>

            {/* Status Feedback */}
            {cloudBackupStatus && (
              <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                cloudBackupStatus.status === "success" 
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                  : "bg-rose-50 border-rose-200 text-rose-800"
              }`}>
                {cloudBackupStatus.status === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="font-bold">{cloudBackupStatus.message}</div>
                  {cloudBackupStatus.status === "success" && (
                    <div className="text-[11px] text-emerald-700">
                      Son Yedek: {new Date(cloudBackupStatus.lastBackupTime || "").toLocaleString("tr-TR")} | 
                      Toplam: <strong>{cloudBackupStatus.totalRecords}</strong> kayıt | 
                      SHA-256: <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono text-[10px]">{cloudBackupStatus.checksum?.slice(0, 16)}...</code>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Confirmation Modal */}
          {showConfirmModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-in">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-base">Geri Yükleme Onayı</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Bu işlem seçilen yedek dosyasındaki verileri ({restoreValidation?.totalRecords} kayıt) şirketinizin aktif veri alanına ({tenantId?.slice(0, 10)}...) yazacaktır.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-800 space-y-1">
                  <div><strong>Seçilen Strateji:</strong> {restoreMode === "safe_append" ? "Yalnızca Eksikleri Ekle (Mevcut Veriler Ezilmez)" : "Katalogları Güncelle (Finansal & Stok Hareketleri Korunur)"}</div>
                  <div className="text-[11px] text-amber-700 mt-1">
                    * Yalnızca 'owner' veya 'admin' rolüne sahip kullanıcılar bu işlemi yapabilir. İşlem denetim günlüğüne (audit log) kaydedilecektir.
                  </div>
                </div>

                {restoreValidation?.isLegacy && (
                  <div className="p-3 bg-rose-50 rounded-xl border border-rose-300 text-xs text-rose-800 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-rose-700">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span>DİKKAT: Doğrulanmamış Eski Format!</span>
                    </div>
                    <div className="text-[11px] leading-relaxed">
                      Bu yedeğin içeriği modern kriptografik SHA-256 özetiyle mühürlenmemiştir. Sadece tamamen güvendiğiniz eski yedek dosyalarını içeri aktarınız.
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteRestore}
                    className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer shadow-sm"
                  >
                    Onaylıyorum, Geri Yükle
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Helpful Technical Note */}
      <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-[11px] text-slate-500 flex items-center gap-2.5">
        <Clock className="w-4 h-4 text-slate-400 flex-shrink-0" />
        <span>
          Denetim İzi (Audit Log): Tüm dışa aktarma, içe aktarma ve yedekten geri yükleme işlemleri işlem tipi, kullanıcı kimliği ve kayıt sayılarıyla birlikte denetim kütüğüne otomatik olarak kaydedilir.
        </span>
      </div>
    </div>
  );
}
