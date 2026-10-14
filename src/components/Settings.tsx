import { useState, useEffect } from "react";
import { 
  Sliders, 
  HelpCircle, 
  Layers, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  Plus, 
  Trash2, 
  BadgePercent, 
  MessageSquare, 
  FileText, 
  Share2, 
  CloudLightning,
  Coins,
  Check,
  Package,
  Scissors,
  Wrench,
  Apple,
  Store,
  CreditCard,
  Download
} from "lucide-react";
import { SectorField, SectorSettings } from "../types";
import { CompanyInfo } from "./CompanyInfo";
import { DataExport } from "./DataExport";
import { auth } from "../lib/firebase";
import { getSectorSettings, saveSectorSettings } from "../lib/firestoreService";
import { SECTOR_PROFILES, getSectorProfile } from "../lib/sectorConfig";

interface SettingsProps {
  onRefreshSectorSettings?: () => void;
  onOpenSubscriptionModal?: () => void;
  companyName?: string;
  tenantId?: string;
}

export function Settings({ 
  onRefreshSectorSettings, 
  onOpenSubscriptionModal,
  companyName,
  tenantId
}: SettingsProps) {
  const [subTab, setSubTab] = useState<"dynamic" | "company" | "export">("dynamic");
  const [activeSector, setActiveSector] = useState("genel");
  const [customFields, setCustomFields] = useState<SectorField[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  // New field inputs
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<"text" | "number" | "date">("text");

  const sectorPresets = SECTOR_PROFILES;

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      const uid = auth.currentUser?.uid || "demo-user";
      const data = await getSectorSettings(uid);
      setActiveSector(data.activeSector);
      setCustomFields(data.customFields);
    } catch (err: any) {
      setError(err.message || "Ayar bilgileri alınırken hata oluştu.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleApplyPreset = (key: string) => {
    const preset = sectorPresets[key];
    if (preset) {
      setActiveSector(key);
      setCustomFields(preset.fields);
    }
  };

  const handleAddField = () => {
    if (!newFieldName.trim()) return;
    const key = newFieldName.trim().replace(/[^a-zA-Z0-9]/g, "");
    if (customFields.some(f => f.key.toLowerCase() === key.toLowerCase())) {
      setError("Bu isimde veya anahtarda bir dinamik alan zaten var.");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const newField: SectorField = {
      key,
      label: newFieldName.trim(),
      type: newFieldType,
      required: false
    };

    setCustomFields([...customFields, newField]);
    setNewFieldName("");
  };

  const handleRemoveField = (key: string) => {
    setCustomFields(customFields.filter(f => f.key !== key));
  };

  const handleSaveSettings = async () => {
    try {
      const uid = auth.currentUser?.uid || "demo-user";
      await saveSectorSettings(uid, {
        activeSector,
        customFields
      });
      setSuccess("Sektörel ayarlar ve dinamik alanlar başarıyla kaydedildi!");
      if (onRefreshSectorSettings) onRefreshSectorSettings();
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message || "Kaydetme sırasında bir hata oluştu.");
      setTimeout(() => setError(""), 4000);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in" id="settings-tab-root">
      {/* Settings Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Sliders className="w-6 h-6 text-indigo-500" />
              Sistem & Sektörel Ayarlar
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Sektörünüze özel ürün alanlarını yapılandırın ve irsaliye basımı için firma bilgilerinizi düzenleyin.
            </p>
          </div>

          {/* Sub-tabs toggle */}
          <div className="flex bg-slate-100 p-1 rounded-xl self-start sm:self-center border border-slate-200">
            <button
              onClick={() => setSubTab("dynamic")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                subTab === "dynamic"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Dinamik Alanlar
            </button>
            <button
              onClick={() => setSubTab("company")}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                subTab === "company"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Firma Bilgileri & Logo
            </button>
            <button
              onClick={() => setSubTab("export")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                subTab === "export"
                  ? "bg-white text-emerald-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Veri Dışa Aktar & Yedek</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (onOpenSubscriptionModal) {
                  onOpenSubscriptionModal();
                }
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 cursor-pointer bg-indigo-50/70 hover:bg-indigo-100/70 border border-indigo-200/50"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Abonelik & Planlar</span>
            </button>
          </div>
        </div>
      </div>

      {subTab === "export" ? (
        <DataExport companyName={companyName} tenantId={tenantId} />
      ) : subTab === "company" ? (
        <CompanyInfo />
      ) : isLoading ? (
        <div className="py-12 flex flex-col items-center justify-center space-y-2 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-slate-400">Yükleniyor...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel: Sector & Fields configuration */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status alerts */}
            {success && (
              <div className="bg-emerald-50 text-emerald-600 text-xs p-3.5 rounded-lg border border-emerald-200 flex items-center gap-2 animate-pulse">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{success}</span>
              </div>
            )}
            {error && (
              <div className="bg-rose-50 text-rose-600 text-xs p-3.5 rounded-lg border border-rose-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Presets and custom fields container */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-5">
              <div>
                <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1.5 uppercase tracking-wide">
                  <Layers className="w-4.5 h-4.5 text-indigo-500" />
                  Sektör Şablonu Seçin
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(sectorPresets).map(([key, data]) => {
                    const isSelected = activeSector === key;
                    const IconComponent = 
                      key === "tekstil" ? Scissors :
                      key === "gida" ? Apple :
                      key === "yedek_parca" ? Wrench : Store;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleApplyPreset(key)}
                        className={`p-3.5 text-left border rounded-xl text-xs font-semibold flex flex-col justify-between transition-all cursor-pointer ${
                          isSelected
                            ? "bg-indigo-50/70 border-indigo-500 ring-2 ring-indigo-500/20 shadow-sm"
                            : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        <div className="flex items-start justify-between w-full">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg ${isSelected ? "bg-indigo-600 text-white" : "bg-white text-slate-600 border border-slate-200"}`}>
                              <IconComponent className="w-4 h-4" />
                            </div>
                            <span className="font-bold text-slate-800 text-sm">{data.name}</span>
                          </div>
                          {isSelected && (
                            <span className="p-1 bg-indigo-600 text-white rounded-full">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 font-normal mt-2 leading-relaxed">
                          {data.description}
                        </p>
                        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-200/60 text-[10px]">
                          <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 font-bold">
                            Birim: {data.defaultUnit}
                          </span>
                          {data.supportsRolls && (
                            <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">
                              Kumaş Topu / Metraj
                            </span>
                          )}
                          {key === "gida" && (
                            <span className="bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-bold">
                              SKT & Parti / Lot
                            </span>
                          )}
                          {key === "yedek_parca" && (
                            <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">
                              OEM & Araç Uyumu
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-1.5 uppercase tracking-wide">
                  <Sliders className="w-4.5 h-4.5 text-indigo-500" />
                  Dinamik Ürün Alanları Düzenleyici
                </h3>
                <p className="text-xs text-slate-400 mb-3">
                  Bu alanlar, envanter sayfanızda ürün eklerken ve düzenlerken dinamik form elemanları olarak karşınıza gelecektir.
                </p>

                {/* List of active custom fields */}
                <div className="space-y-2 mb-4">
                  {customFields.length === 0 ? (
                    <div className="p-3 bg-slate-50 text-slate-400 text-xs rounded-lg text-center border border-dashed border-slate-200">
                      Hiç dinamik alan eklenmemiş. Ürünleriniz standart alanlarla kaydedilecektir.
                    </div>
                  ) : (
                    customFields.map((f) => (
                      <div key={f.key} className="flex justify-between items-center p-2 px-3 border border-slate-100 bg-slate-50 rounded-lg text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-700">{f.label}</span>
                          <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded uppercase font-mono font-bold">
                            {f.type}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveField(f.key)}
                          className="text-slate-400 hover:text-rose-500 p-1 rounded"
                          title="Alanı Sil"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Adding new Custom Field Form */}
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200/60 space-y-3">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Yeni Dinamik Alan Ekle</span>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      placeholder="Örn: Varyant, Seri No, Son Kullanma..."
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                    />
                    <select
                      value={newFieldType}
                      onChange={(e) => setNewFieldType(e.target.value as any)}
                      className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none"
                    >
                      <option value="text">Metin (Yazı)</option>
                      <option value="number">Sayı</option>
                      <option value="date">Tarih</option>
                    </select>
                    <button
                      type="button"
                      onClick={handleAddField}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ekle
                    </button>
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="border-t border-slate-100 pt-4 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveSettings}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all active:scale-95"
                >
                  Şablonu & Değişiklikleri Kaydet
                </button>
              </div>
            </div>
          </div>

          {/* Right panel: Monetization Strategy Panel (User consultation) */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-gradient-to-br from-[#1E293B] to-[#0F172A] p-5 rounded-xl border border-slate-800 text-slate-100 space-y-4 shadow-md">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="font-extrabold text-sm tracking-wide uppercase text-white">Monetizasyon & Kazanç Planı</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                "Uygulamanın bedava kalıp esnafa kolayca yayılması harika bir büyüme stratejisidir. Ancak bu esnada gelir elde etmek için şu 5 premium / pro entegrasyon modelini uygulayabiliriz:"
              </p>

              <div className="space-y-3.5 text-xs">
                {/* 1. SaaS limits */}
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <CloudLightning className="w-4 h-4 text-indigo-400" />
                    <span className="font-bold text-slate-200">1. Limitli Ücretsiz Model (Freemium)</span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-normal">
                    50 adet ürün ve 3 adet kayıtlı müşteriye kadar sistem %100 bedava kalır. Sınırı aşmak isteyen büyük işletmeler aylık ufak bir SaaS aboneliği (Pro Plan) öder.
                  </p>
                </div>

                {/* 2. Automated Reminders */}
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-slate-200">2. Otomatik WhatsApp API Bildirimi</span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-normal">
                    Manuel WhatsApp şablonu (mevcut) bedavadır. Ancak tek tuşla, müşteriye geciken borçları her gün otomatik hatırlatan premium API botu satılabilir.
                  </p>
                </div>

                {/* 3. Printing */}
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-slate-200">3. Barkod Çıktısı & Donanım</span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-normal">
                    Firma logolu profesyonel PDF Barkod çıktı şablonları, el terminali entegrasyonu ve etiket yazıcı desteği Pro pakette açılır.
                  </p>
                </div>

                {/* 4. Sync */}
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Share2 className="w-4 h-4 text-blue-400" />
                    <span className="font-bold text-slate-200">4. Çoklu Cihaz ve Bulut Yedekleme</span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-normal">
                    Tek cihazda çevrimdışı kullanım bedavadır. Birden fazla personelin aynı anda canlı stoğu eşzamanlı yönetmesi premium senkronizasyon gerektirir.
                  </p>
                </div>

                {/* 5. Payments fee */}
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-800 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Coins className="w-4 h-4 text-pink-400" />
                    <span className="font-bold text-slate-200">5. Online Tahsilat Komisyonu</span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-normal">
                    Müşteriye giden WhatsApp linkinde online kredi kartı ödemesi eklenir. Borçlu online ödediğinde sistem %1 - %2 arası aracı komisyonu keserek para kazanır.
                  </p>
                </div>
              </div>

              <div className="bg-indigo-600 p-3 rounded-lg text-center mt-4">
                <span className="text-[10px] font-bold uppercase tracking-wider block text-indigo-200">Sponsorlu / Gelecek Modül</span>
                <span className="text-xs font-bold text-white block mt-0.5">Gelir Modüllerini Aktifleştir (Pro Test)</span>
                <p className="text-[10px] text-indigo-100 mt-1">Stratejileri test etmek için Pro demo modunu her zaman kullanabilirsiniz.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
