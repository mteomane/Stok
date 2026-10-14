import React, { useState, useEffect } from "react";
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  ArrowRight, 
  Sliders, 
  RefreshCw, 
  Layers, 
  ShieldCheck, 
  Sparkles,
  HelpCircle,
  Eye,
  Check
} from "lucide-react";
import { Product, SectorField, SectorSettings } from "../types";
import { importService } from "../lib/export/ImportService";
import { ColumnMapping, ImportPreview, ImportRowError } from "../lib/export/types";
import { auth } from "../lib/firebase";
import { getSectorSettings } from "../lib/firestoreService";

interface UniversalImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
  existingProducts: Product[];
  activeSector?: string;
}

type ImportStep = "upload" | "mapping" | "preview" | "importing" | "complete";

export function UniversalImportModal({
  isOpen,
  onClose,
  onSuccess,
  existingProducts,
  activeSector
}: UniversalImportModalProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Sector Settings & Custom Fields
  const [sectorSettings, setSectorSettings] = useState<SectorSettings | null>(null);

  // Parsed File Data
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<any[][]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);

  // Column Mappings
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);

  // Preview & Validation
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [duplicateAction, setDuplicateAction] = useState<"skip" | "update">("skip");

  // Import Progress
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [processedCount, setProcessedCount] = useState<number>(0);
  const [totalToProcess, setTotalToProcess] = useState<number>(0);
  const [importResult, setImportResult] = useState<{
    insertedCount: number;
    skippedCount: number;
    failedCount: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Reset state
      setStep("upload");
      setSelectedFile(null);
      setParseError(null);
      setPreview(null);
      setProgressPercent(0);
      setImportResult(null);

      // Fetch active custom fields
      const fetchSettings = async () => {
        try {
          const uid = auth.currentUser?.uid || "demo-user";
          const settings = await getSectorSettings(uid);
          setSectorSettings(settings);
        } catch (err) {
          console.warn("Could not fetch sector settings for import modal:", err);
        }
      };
      fetchSettings();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const customFields: SectorField[] = sectorSettings?.customFields || [];

  // ==========================================
  // STEP 1: FILE UPLOAD & TEMPLATE DOWNLOAD
  // ==========================================

  const handleDownloadTemplate = () => {
    importService.downloadProductsTemplateXlsx(customFields);
  };

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setParseError(null);
    setIsParsing(true);

    try {
      const parsed = await importService.parseFile(file);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        throw new Error("Seçilen dosyada ürün başlıkları veya veri satırları bulunamadı.");
      }

      setHeaders(parsed.headers);
      setRawRows(parsed.rows);
      setSheetNames(parsed.sheetNames);

      // Auto-detect column mappings
      const detected = importService.autoDetectColumnMapping(parsed.headers, customFields);
      setMappings(detected);

      // Move to Column Mapping Step
      setStep("mapping");
    } catch (err: any) {
      console.error("File parsing error:", err);
      setParseError(err.message || "Dosya ayrıştırılırken hata oluştu. Lütfen dosya formatını kontrol edin.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // ==========================================
  // STEP 2: COLUMN MAPPING CONFIGURATION
  // ==========================================

  const handleUpdateMapping = (excelCol: string, targetField: string) => {
    setMappings(prev => prev.map(m => {
      if (m.excelColumn !== excelCol) return m;

      if (targetField === "_ignore") {
        return { ...m, targetField: "_ignore", isCustomField: false };
      }

      if (targetField.startsWith("custom:")) {
        const key = targetField.replace("custom:", "");
        const cf = customFields.find(f => f.key === key);
        return {
          ...m,
          targetField,
          isCustomField: true,
          customFieldKey: key,
          customFieldLabel: cf?.label || key,
          customFieldType: cf?.type || "text"
        };
      }

      if (targetField === "_new_custom") {
        const cleanKey = excelCol.toLowerCase().replace(/[^a-z0-9_]/g, "_") || `f_${Date.now()}`;
        return {
          ...m,
          targetField: `custom:${cleanKey}`,
          isCustomField: true,
          customFieldKey: cleanKey,
          customFieldLabel: excelCol,
          customFieldType: "text"
        };
      }

      return {
        ...m,
        targetField,
        isCustomField: false
      };
    }));
  };

  const handleProceedToPreview = () => {
    // Generate preview
    const res = importService.previewUniversalImport(
      rawRows,
      headers,
      mappings,
      "products",
      existingProducts,
      { duplicateAction }
    );
    setPreview(res);
    setStep("preview");
  };

  // ==========================================
  // STEP 3: PREVIEW & DUPLICATE HANDLING
  // ==========================================

  const handleDuplicateActionChange = (action: "skip" | "update") => {
    setDuplicateAction(action);
    if (preview) {
      const updated = importService.previewUniversalImport(
        rawRows,
        headers,
        mappings,
        "products",
        existingProducts,
        { duplicateAction: action }
      );
      setPreview(updated);
    }
  };

  const handleDownloadFailedRows = () => {
    if (!preview || preview.errors.length === 0) return;
    const failedRows = preview.previewRows.filter(r => r._hasError);
    importService.downloadFailedRowsXlsx(failedRows, headers, preview.errors);
  };

  // ==========================================
  // STEP 4: EXECUTE BATCH IMPORT
  // ==========================================

  const handleExecuteImport = async () => {
    if (!preview || preview.validRows === 0) return;

    setStep("importing");
    setProgressPercent(0);
    setTotalToProcess(preview.previewRows.length);
    setProcessedCount(0);

    try {
      const uid = auth.currentUser?.uid || "demo-user";
      const validRowsToImport = preview.previewRows.filter(r => !r._hasError);

      const result = await importService.executeUniversalBatchImport(
        uid,
        "products",
        validRowsToImport,
        {
          duplicateAction,
          onProgress: (processed, total, percent) => {
            setProcessedCount(processed);
            setProgressPercent(percent);
          }
        }
      );

      setImportResult({
        insertedCount: result.insertedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount
      });
      setStep("complete");
    } catch (err: any) {
      console.error("Execute import error:", err);
      setParseError(err.message || "İçe aktarma sırasında beklenmeyen hata oluştu.");
      setStep("preview");
    }
  };

  const handleFinish = async () => {
    await onSuccess();
    onClose();
  };

  // Standard Target Field Options
  const standardFields = [
    { value: "name", label: "Ürün Adı * (Zorunlu)", group: "Temel Bilgiler" },
    { value: "price", label: "Satış Fiyatı * (Zorunlu)", group: "Temel Bilgiler" },
    { value: "stock", label: "Güncel Stok * (Zorunlu)", group: "Temel Bilgiler" },
    { value: "barcode", label: "Barkod (Opsiyonel / Üretici Barkodu)", group: "Kod & Tanımlayıcılar" },
    { value: "sku", label: "SKU / Ürün Kodu (Opsiyonel)", group: "Kod & Tanımlayıcılar" },
    { value: "brand", label: "Marka / Üretici", group: "Katalog Detayları" },
    { value: "category", label: "Kategori", group: "Katalog Detayları" },
    { value: "costPrice", label: "Alış / Maliyet Fiyatı (₺)", group: "Fiyat & Maliyet" },
    { value: "minStock", label: "Minimum / Kritik Stok", group: "Stok Yönetimi" },
    { value: "unit", label: "Birim (Adet, Metre, Kg, Koli vb.)", group: "Stok Yönetimi" },
    { value: "description", label: "Ürün Açıklaması / Detay", group: "Katalog Detayları" },
  ];

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-5 animate-fade-in">
      <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="p-4 sm:px-6 sm:py-4 border-b border-slate-150 flex justify-between items-center bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-200">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base sm:text-lg flex items-center gap-2">
                Toplu Ürün Yükleme & Excel (.xlsx) İçe Aktarıcı
              </h3>
              <p className="text-xs text-slate-400">
                Tüm sektörlerle uyumlu • Barkodsuz/Barkodlu ürün desteği • Dinamik alan eşleme
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

        {/* Stepper indicator */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-500">
          <div className={`flex items-center gap-2 ${step === "upload" ? "text-emerald-600 font-bold" : ""}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === "upload" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"}`}>1</span>
            <span>Dosya Yükle</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
          <div className={`flex items-center gap-2 ${step === "mapping" ? "text-emerald-600 font-bold" : ""}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === "mapping" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"}`}>2</span>
            <span>Kolon Eşleme</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
          <div className={`flex items-center gap-2 ${step === "preview" ? "text-emerald-600 font-bold" : ""}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === "preview" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"}`}>3</span>
            <span>Doğrulama & Önizleme</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-300" />
          <div className={`flex items-center gap-2 ${step === "importing" || step === "complete" ? "text-emerald-600 font-bold" : ""}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === "complete" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"}`}>4</span>
            <span>Aktarım</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">

          {/* ======================================================== */}
          {/* STEP 1: UPLOAD */}
          {/* ======================================================== */}
          {step === "upload" && (
            <div className="space-y-6">
              
              {/* Feature Highlights Banner */}
              <div className="bg-gradient-to-r from-emerald-50 via-teal-50/40 to-slate-50 p-4 rounded-xl border border-emerald-150 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-800 block">Sektör Bağımsız Evrensel İçe Aktarım</span>
                    <span className="text-slate-500">
                      Market, tekstil, oto yedek parça, hırdavat veya genel ticaret fark etmeksizin tüm ürünlerinizi aktarın. <strong>Barkod zorunlu değildir</strong>; barkodsuz ürünlere sistem otomatik QR ve SKU üretebilir.
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="flex items-center gap-2 px-3.5 py-2 bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-bold rounded-lg transition-all shadow-sm flex-shrink-0 cursor-pointer text-xs"
                >
                  <Download className="w-4 h-4" />
                  <span>Excel Şablonu İndir (.xlsx)</span>
                </button>
              </div>

              {/* Drag & Drop Zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50/50 hover:bg-emerald-50/20 rounded-2xl p-8 text-center transition-all cursor-pointer flex flex-col items-center justify-center space-y-3"
                onClick={() => document.getElementById("universal-file-input")?.click()}
              >
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-inner">
                  <Upload className="w-7 h-7" />
                </div>
                
                <div>
                  <span className="text-sm font-bold text-slate-800 block">
                    Excel (.xlsx, .xls) veya CSV dosyanızı buraya sürükleyin
                  </span>
                  <span className="text-xs text-slate-400 block mt-1">
                    ya da bilgisayarınızdan seçmek için tıklayın (5.000+ ürün desteklenir)
                  </span>
                </div>

                <input
                  id="universal-file-input"
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />

                <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Önerilen format: Microsoft Excel (.xlsx)
                </div>
              </div>

              {isParsing && (
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-center gap-3 text-emerald-800 text-xs font-semibold">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                  <span>Excel dosyası çözümleniyor ve kolonlar taranıyor...</span>
                </div>
              )}

              {parseError && (
                <div className="p-4 bg-red-50 rounded-xl border border-red-200 flex items-start gap-3 text-red-700 text-xs">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
                  <span>{parseError}</span>
                </div>
              )}

              {/* Information Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-150">
                  <span className="font-bold text-slate-800 block mb-1">1. Barkodsuz Ürünler</span>
                  <span>Kumaş, parça veya genel ürünlerinizde barkod yoksa sorun değil. Sistem bunları reddetmez.</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-150">
                  <span className="font-bold text-slate-800 block mb-1">2. Dinamik Alanlar</span>
                  <span>Renk, en, SKT, parti no veya OEM kodları gibi sektörünüze özel kolonları eşleyebilirsiniz.</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-150">
                  <span className="font-bold text-slate-800 block mb-1">3. Yüksek Hız & Güvenlik</span>
                  <span>Veriler 400'lük paketler halinde atomik yazılır. Tenant izolasyonu tam korunur.</span>
                </div>
              </div>

            </div>
          )}

          {/* ======================================================== */}
          {/* STEP 2: COLUMN MAPPING */}
          {/* ======================================================== */}
          {step === "mapping" && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">Excel Kolonlarını StokPro Alanlarıyla Eşleyin</h4>
                  <p className="text-xs text-slate-400">
                    Dosyanızdaki ({rawRows.length} satır) kolonlar otomatik eşleştirildi. İhtiyaç halinde değiştirebilirsiniz.
                  </p>
                </div>
                <span className="text-xs font-mono font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg border border-slate-200">
                  {selectedFile?.name}
                </span>
              </div>

              {/* Column Mapping Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3 w-1/3">Excel Kolon Başlığı</th>
                      <th className="p-3 w-1/4">Örnek Veri (1. Satır)</th>
                      <th className="p-3 w-5/12">StokPro Hedef Alanı</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mappings.map((m, idx) => {
                      const sampleVal = rawRows[0] && rawRows[0][idx] !== undefined ? String(rawRows[0][idx]) : "—";
                      const isIgnored = m.targetField === "_ignore";

                      return (
                        <tr key={m.excelColumn} className={`hover:bg-slate-50 transition-colors ${isIgnored ? "opacity-50 bg-slate-50/50" : ""}`}>
                          <td className="p-3 font-semibold text-slate-800">
                            <span className="font-mono text-slate-900">{m.excelColumn}</span>
                          </td>
                          <td className="p-3 text-slate-500 truncate max-w-xs font-mono text-[11px]">
                            {sampleVal || "—"}
                          </td>
                          <td className="p-3">
                            <select
                              value={m.targetField}
                              onChange={(e) => handleUpdateMapping(m.excelColumn, e.target.value)}
                              className={`w-full px-2.5 py-1.5 rounded-lg border text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white ${
                                m.targetField.startsWith("custom:") 
                                  ? "border-indigo-300 text-indigo-700 font-semibold"
                                  : isIgnored 
                                  ? "border-slate-200 text-slate-400"
                                  : "border-slate-200 text-slate-800"
                              }`}
                            >
                              <optgroup label="Standart Alanlar">
                                {standardFields.map(f => (
                                  <option key={f.value} value={f.value}>
                                    {f.label}
                                  </option>
                                ))}
                              </optgroup>

                              {customFields.length > 0 && (
                                <optgroup label="Sektörünüze Özel Dinamik Alanlar">
                                  {customFields.map(cf => (
                                    <option key={cf.key} value={`custom:${cf.key}`}>
                                      ✨ Dinamik: {cf.label} ({cf.key})
                                    </option>
                                  ))}
                                </optgroup>
                              )}

                              <optgroup label="Özel İşlemler">
                                <option value="_new_custom">
                                  ➕ Yeni Dinamik Alan Olarak Ekle ({m.excelColumn})
                                </option>
                                <option value="_ignore">
                                  ❌ Bu Kolonu Atla (İçe Aktarma)
                                </option>
                              </optgroup>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() => setStep("upload")}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Geri (Farklı Dosya Seç)
                </button>

                <button
                  type="button"
                  onClick={handleProceedToPreview}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-200 flex items-center gap-2 transition-all cursor-pointer"
                >
                  <span>Doğrula ve Önizlemeye Geç</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STEP 3: PREVIEW & VALIDATION */}
          {/* ======================================================== */}
          {step === "preview" && preview && (
            <div className="space-y-5">
              
              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-slate-400 font-bold block text-[10px] uppercase">Toplam Satır</span>
                  <span className="text-lg font-black text-slate-800 font-mono">{preview.totalRows}</span>
                </div>

                <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                  <span className="text-emerald-600 font-bold block text-[10px] uppercase">Geçerli Ürünler</span>
                  <span className="text-lg font-black text-emerald-700 font-mono">{preview.validRows}</span>
                </div>

                <div className={`p-3 rounded-xl border ${preview.duplicateRows > 0 ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
                  <span className="text-amber-700 font-bold block text-[10px] uppercase">Mükerrer / Çakışan</span>
                  <span className="text-lg font-black text-amber-700 font-mono">{preview.duplicateRows}</span>
                </div>

                <div className={`p-3 rounded-xl border ${preview.invalidRows > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
                  <span className="text-red-600 font-bold block text-[10px] uppercase">Hatalı Satırlar</span>
                  <span className="text-lg font-black text-red-700 font-mono">{preview.invalidRows}</span>
                </div>
              </div>

              {/* Duplicate Handling Option */}
              {preview.duplicateRows > 0 && (
                <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <span className="text-amber-900 font-medium">
                      Dosyanızda sistemde zaten kayıtlı <strong>{preview.duplicateRows} adet</strong> mükerrer ürün tespit edildi.
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDuplicateActionChange("skip")}
                      className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                        duplicateAction === "skip"
                          ? "bg-amber-600 text-white shadow-sm"
                          : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      Mükerrerleri Atla (Yükleme)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicateActionChange("update")}
                      className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                        duplicateAction === "update"
                          ? "bg-amber-600 text-white shadow-sm"
                          : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      Mevcutları Güncelle
                    </button>
                  </div>
                </div>
              )}

              {/* Errors Section (if any) */}
              {preview.errors.length > 0 && (
                <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-red-800 flex items-center gap-1.5">
                      <XCircle className="w-4 h-4 text-red-600" />
                      Düzeltilmesi Gereken Hatalı Satırlar ({preview.errors.length})
                    </span>

                    <button
                      type="button"
                      onClick={handleDownloadFailedRows}
                      className="text-red-700 hover:text-red-900 font-bold underline flex items-center gap-1 text-[11px] cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Hatalı Satırları Excel Olarak İndir
                    </button>
                  </div>

                  <div className="max-h-28 overflow-y-auto divide-y divide-red-100 pr-1 text-[11px] text-red-700">
                    {preview.errors.slice(0, 15).map((err, i) => (
                      <div key={i} className="py-1 flex justify-between">
                        <span><strong>Satır {err.rowNumber}:</strong> {err.message}</span>
                        {err.field && <span className="font-mono text-red-500">[{err.field}]</span>}
                      </div>
                    ))}
                    {preview.errors.length > 15 && (
                      <div className="py-1 font-semibold text-red-600 text-center">
                        ...ve {preview.errors.length - 15} hata daha.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sample Preview Rows Table */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 block">
                  İçe Aktarılacak Ürünlerden Örnekler (İlk 10 Satır)
                </span>

                <div className="border border-slate-200 rounded-xl overflow-x-auto shadow-sm max-h-56">
                  <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="p-2.5">Durum</th>
                        <th className="p-2.5">Ürün Adı</th>
                        <th className="p-2.5">Barkod</th>
                        <th className="p-2.5">SKU</th>
                        <th className="p-2.5">Fiyat</th>
                        <th className="p-2.5">Stok</th>
                        <th className="p-2.5">Kategori</th>
                        <th className="p-2.5">Birim</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.previewRows.slice(0, 10).map((row, idx) => {
                        const p = row._parsed;
                        const isErr = row._hasError;
                        const isDup = row._isDuplicate;

                        return (
                          <tr key={idx} className={`hover:bg-slate-50 ${isErr ? "bg-red-50/40" : isDup ? "bg-amber-50/30" : ""}`}>
                            <td className="p-2.5">
                              {isErr ? (
                                <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold text-[10px]">Hatalı</span>
                              ) : isDup ? (
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold text-[10px]">
                                  {duplicateAction === "update" ? "Güncellenecek" : "Atlanacak"}
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[10px]">Geçerli</span>
                              )}
                            </td>
                            <td className="p-2.5 font-bold text-slate-800">{p.name || "—"}</td>
                            <td className="p-2.5 font-mono text-[11px] text-slate-500">
                              {p.barcode ? p.barcode : <span className="text-slate-400 italic">Barkodsuz (QR)</span>}
                            </td>
                            <td className="p-2.5 font-mono text-[11px] text-slate-600">{p.sku || "—"}</td>
                            <td className="p-2.5 font-bold text-slate-900">₺{p.price}</td>
                            <td className="p-2.5 font-bold text-indigo-700">{p.stock} {p.unit}</td>
                            <td className="p-2.5 text-slate-600">{p.category}</td>
                            <td className="p-2.5 text-slate-500">{p.unit}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-between items-center pt-2">
                <button
                  type="button"
                  onClick={() => setStep("mapping")}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Kolon Eşlemeye Dön
                </button>

                <button
                  type="button"
                  disabled={preview.validRows === 0}
                  onClick={handleExecuteImport}
                  className={`px-6 py-2.5 font-bold rounded-xl text-xs text-white shadow-md flex items-center gap-2 transition-all cursor-pointer active:scale-95 ${
                    preview.validRows === 0
                      ? "bg-slate-300 text-slate-500 cursor-not-allowed shadow-none"
                      : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200"
                  }`}
                >
                  <Check className="w-4 h-4" />
                  <span>{preview.validRows} Adet Ürünü İçe Aktar</span>
                </button>
              </div>

            </div>
          )}

          {/* ======================================================== */}
          {/* STEP 4: IMPORTING PROGRESS */}
          {/* ======================================================== */}
          {step === "importing" && (
            <div className="py-12 flex flex-col items-center justify-center space-y-5 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shadow-inner animate-pulse">
                <RefreshCw className="w-8 h-8 animate-spin" />
              </div>

              <div>
                <h4 className="text-base font-bold text-slate-800">Ürünler Sisteme Aktarılıyor</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Veriler Firestore ve multi-tenant güvenlik katmanına 400'lük atomik paketler halinde aktarılıyor. Lütfen pencereyi kapatmayın.
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-full max-w-md space-y-1.5">
                <div className="flex justify-between text-xs font-bold text-slate-600">
                  <span>İlerleme: %{progressPercent}</span>
                  <span className="font-mono">{processedCount} / {totalToProcess} Ürün</span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.max(5, progressPercent)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* STEP 5: COMPLETE */}
          {/* ======================================================== */}
          {step === "complete" && importResult && (
            <div className="py-10 flex flex-col items-center justify-center space-y-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-200">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <h4 className="text-lg font-black text-slate-900">İçe Aktarma Başarıyla Tamamlandı!</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Ürünler şirket envanterinize işlendi ve satışa hazır hale getirildi.
                </p>
              </div>

              <div className="flex gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold font-mono text-slate-700">
                <div>
                  <span className="text-emerald-600 block text-base">{importResult.insertedCount}</span>
                  <span className="text-[10px] text-slate-400 uppercase">Eklenen / Güncellenen</span>
                </div>
                {importResult.skippedCount > 0 && (
                  <div className="border-l border-slate-200 pl-4">
                    <span className="text-amber-600 block text-base">{importResult.skippedCount}</span>
                    <span className="text-[10px] text-slate-400 uppercase">Atlanan Mükerrer</span>
                  </div>
                )}
                {importResult.failedCount > 0 && (
                  <div className="border-l border-slate-200 pl-4">
                    <span className="text-red-600 block text-base">{importResult.failedCount}</span>
                    <span className="text-[10px] text-slate-400 uppercase">Hatalı</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleFinish}
                className="px-8 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-200 transition-all cursor-pointer active:scale-95"
              >
                Envanteri Güncelle & Kapat
              </button>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
