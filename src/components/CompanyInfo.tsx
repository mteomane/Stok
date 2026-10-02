import React, { useState, useEffect } from "react";
import { Building2, Save, Upload, CheckCircle2, AlertCircle, Trash2 } from "lucide-react";
import { CompanyInfo as CompanyInfoType } from "../types";
import { auth } from "../lib/firebase";
import { getCompanyInfo, saveCompanyInfo } from "../lib/firestoreService";

export function CompanyInfo() {
  const [info, setInfo] = useState<CompanyInfoType>({
    name: "",
    address: "",
    phone: "",
    email: "",
    taxOffice: "",
    taxNumber: "",
    logo: ""
  });
  const [isLoading, setIsLoading] = useState(true);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid || "demo-user";
    getCompanyInfo(uid)
      .then((data) => {
        setInfo(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Firma bilgileri yüklenemedi.");
        setIsLoading(false);
      });
  }, []);


  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setInfo((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Lütfen sadece resim dosyası yükleyin (PNG, JPG, JPEG).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Resim boyutu 2MB'dan küçük olmalıdır.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setInfo((prev) => ({ ...prev, logo: event.target!.result as string }));
        setError("");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleRemoveLogo = () => {
    setInfo((prev) => ({ ...prev, logo: "" }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError("");
      setSuccess("");
      const uid = auth.currentUser?.uid || "demo-user";
      await saveCompanyInfo(uid, info);
      setSuccess("Firma bilgileri başarıyla güncellendi!");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: any) {
      setError(err.message || "Kaydetme sırasında bir hata oluştu.");
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center space-y-2 bg-white rounded-xl border border-slate-200">
        <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-slate-400">Yükleniyor...</span>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6" id="company-info-root">
      <div>
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-indigo-500" />
          Firma Bilgileri & Kurumsal Logo
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Bu bilgiler, oluşturacağınız irsaliyelerde (sevk belgelerinde) satıcı unvanı olarak otomatik olarak yer alacaktır.
        </p>
      </div>

      {success && (
        <div className="bg-emerald-50 text-emerald-600 text-xs p-3.5 rounded-xl border border-emerald-200 flex items-center gap-2 animate-pulse">
          <CheckCircle2 className="w-4.5 h-4.5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 text-rose-600 text-xs p-3.5 rounded-xl border border-rose-200 flex items-center gap-2">
          <AlertCircle className="w-4.5 h-4.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Logo Upload Panel */}
          <div className="md:col-span-1 space-y-3">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Firma Logosu</label>
            
            {info.logo ? (
              <div className="relative group border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col items-center justify-center h-48">
                <img
                  src={info.logo}
                  alt="Firma Logosu"
                  className="max-h-32 max-w-full object-contain rounded"
                  referrerPolicy="no-referrer"
                />
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="absolute top-2 right-2 p-1.5 bg-white text-rose-500 hover:text-white hover:bg-rose-600 rounded-lg shadow-md border border-slate-100 transition-colors"
                  title="Logoyu Kaldır"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl h-48 flex flex-col items-center justify-center p-4 text-center cursor-pointer transition-all ${
                  isDragging
                    ? "border-indigo-500 bg-indigo-50/40 text-indigo-600"
                    : "border-slate-300 hover:border-indigo-400 text-slate-400 bg-slate-50/50"
                }`}
                onClick={() => document.getElementById("logo-upload-input")?.click()}
              >
                <Upload className={`w-8 h-8 mb-2 ${isDragging ? "text-indigo-500 animate-bounce" : "text-slate-300"}`} />
                <span className="text-xs font-bold text-slate-600 block">Sürükle & Bırak</span>
                <span className="text-[10px] text-slate-400 mt-1 block">veya tıklayarak dosya seçin</span>
                <span className="text-[9px] text-slate-300 mt-0.5 block">Max 2MB (PNG, JPG, JPEG)</span>
                <input
                  id="logo-upload-input"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            )}
          </div>

          {/* Form Fields */}
          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Firma Unvanı (Resmi Adı)</label>
              <input
                type="text"
                name="name"
                value={info.name}
                onChange={handleChange}
                placeholder="Örn: Asya Tekstil Sanayi Ltd. Şti."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-medium"
                required
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Telefon Numarası</label>
              <input
                type="text"
                name="phone"
                value={info.phone}
                onChange={handleChange}
                placeholder="+90 (___) ___ __ __"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-medium"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">E-Posta Adresi</label>
              <input
                type="email"
                name="email"
                value={info.email}
                onChange={handleChange}
                placeholder="Örn: muhasebe@asya.com"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-medium"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Vergi Dairesi</label>
              <input
                type="text"
                name="taxOffice"
                value={info.taxOffice}
                onChange={handleChange}
                placeholder="Örn: Merter"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-medium"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Vergi Numarası</label>
              <input
                type="text"
                name="taxNumber"
                value={info.taxNumber}
                onChange={handleChange}
                placeholder="Örn: 1234567890"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-medium font-mono"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1">Firma Adresi</label>
              <textarea
                name="address"
                value={info.address}
                onChange={handleChange}
                rows={3}
                placeholder="İrsaliyede görüntülenecek resmi adres..."
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-medium resize-none"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4 flex justify-end">
          <button
            type="submit"
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 active:scale-95 transition-all"
          >
            <Save className="w-4 h-4" />
            Firma Bilgilerini Kaydet
          </button>
        </div>
      </form>
    </div>
  );
}
