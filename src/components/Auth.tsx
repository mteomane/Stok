import React, { useState } from "react";
import { 
  auth, 
  db,
  firebaseConfigStatus
} from "../lib/firebase";
import { isDemoAllowed } from "../lib/authGuard";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut
} from "firebase/auth";
import { 
  doc, 
  setDoc, 
  getDoc,
  getDocs,
  collection, 
  addDoc,
  query,
  where,
  limit
} from "firebase/firestore";
import { 
  motion 
} from "motion/react";
import { 
  Lock, 
  Mail, 
  Building2, 
  Sparkles, 
  Eye, 
  EyeOff, 
  Briefcase, 
  ChevronRight,
  TrendingUp,
  Sliders,
  CheckCircle,
  Users,
  ArrowLeft,
  KeyRound,
  ShieldAlert
} from "lucide-react";

interface AuthProps {
  onSuccess: (userObj?: any) => void;
}

export function Auth({ onSuccess }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);

  const handleDemoLogin = () => {
    if (!isDemoAllowed()) {
      setError("Güvenlik Uyarısı: Demo modu yalnızca geliştirme ortamında kullanılabilir. Lütfen gerçek hesabınızla giriş yapın.");
      return;
    }
    const demoUser = { uid: "demo-user", email: "demo@stokpro.com", isDemo: true };
    setSuccessMsg("Demo Modu ile giriş yapılıyor...");
    setTimeout(() => {
      onSuccess(demoUser);
    }, 800);
  };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [selectedSector, setSelectedSector] = useState("tekstil");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const sectorPresets = {
    tekstil: {
      name: "Tekstil & Giyim Sektörü",
      fields: [
        { key: "Renk", label: "Renk / Varyasyon", type: "text", required: false },
        { key: "En", label: "Kumaş Eni (cm)", type: "text", required: false },
        { key: "Malzeme", label: "Malzeme Tipi (%Pamuk, %Saten)", type: "text", required: false }
      ],
      demoProducts: [
        {
          name: "Premium Pamuk Kumaş",
          sku: "PROD_P1",
          category: "Kumaş",
          price: 250,
          stock: 45,
          minStock: 10,
          isPackaged: true,
          packageUnitsCount: 50,
          packageUnitName: "Metre",
          subUnitStock: 35,
          attributes: { "Renk": "Mavi", "En": "150cm" },
          rolls: [
            { id: "R-DEMO-1", rollNumber: "Top #1 (Mavi)", length: 25, initialLength: 25, status: "available" },
            { id: "R-DEMO-2", rollNumber: "Top #2 (Mavi)", length: 20, initialLength: 20, status: "available" }
          ]
        },
        {
          name: "Düğme Seti (Metal)",
          sku: "PROD_P2",
          category: "Aksesuar",
          price: 25,
          stock: 150,
          minStock: 25,
          attributes: { "Malzeme": "Pirinç" }
        }
      ]
    },
    gida: {
      name: "Gıda & Hızlı Tüketim Sektörü",
      fields: [
        { key: "SKT", label: "Son Tüketim Tarihi", type: "date", required: false },
        { key: "Gramaj", label: "Gramaj / Hacim (gr/lt)", type: "text", required: false },
        { key: "Marka", label: "Üretici Marka", type: "text", required: false }
      ],
      demoProducts: [
        {
          name: "Sızma Zeytinyağı",
          sku: "PROD_G1",
          category: "Sıvı Gıda",
          price: 320,
          stock: 40,
          minStock: 10,
          attributes: { "Marka": "Ege Bahçesi", "Gramaj": "1 Litre" }
        },
        {
          name: "Osmancık Pirinç",
          sku: "PROD_G2",
          category: "Kuru Gıda",
          price: 65,
          stock: 120,
          minStock: 20,
          attributes: { "Marka": "Gönen Tarım", "Gramaj": "2 kg" }
        }
      ]
    },
    yedek_parca: {
      name: "Otomotiv & Teknik Yedek Parça Sektörü",
      fields: [
        { key: "SeriNo", label: "Seri No / Parça Kodu", type: "text", required: false },
        { key: "UyumluModel", label: "Araç / Cihaz Uyumluluğu", type: "text", required: false },
        { key: "RafNo", label: "Raf / Depo Konumu", type: "text", required: false }
      ],
      demoProducts: [
        {
          name: "Fren Balatası Ön Set",
          sku: "PROD_Y1",
          category: "Fren Sistemi",
          price: 750,
          stock: 15,
          minStock: 5,
          attributes: { "SeriNo": "FB-2026-X", "UyumluModel": "Renault Megane 4", "RafNo": "A-12" }
        },
        {
          name: "Hava Filtresi Premium",
          sku: "PROD_Y2",
          category: "Filtre Grubu",
          price: 180,
          stock: 35,
          minStock: 10,
          attributes: { "SeriNo": "HF-9099-M", "UyumluModel": "Fiat Egea 1.3", "RafNo": "B-03" }
        }
      ]
    },
    genel: {
      name: "Genel Perakende & Diğer Sektörler",
      fields: [
        { key: "Marka", label: "Marka", type: "text", required: false },
        { key: "RafNo", label: "Raf Numarası", type: "text", required: false }
      ],
      demoProducts: [
        {
          name: "Kablosuz Optik Fare",
          sku: "PROD_GE1",
          category: "Elektronik",
          price: 450,
          stock: 28,
          minStock: 5,
          attributes: { "Marka": "LogiTech", "RafNo": "R-1" }
        }
      ]
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (!firebaseConfigStatus.isValidForStokPro) {
      setError(
        firebaseConfigStatus.errorMessage ||
        "Stok-Pro için 'stok-pro-911b4' Web App yapılandırması gereklidir."
      );
      return;
    }

    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      setError("Lütfen geçerli bir e-posta adresi girin.");
      return;
    }
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setSuccessMsg(
        "Eğer bu e-posta adresi sistemimizde kayıtlı ise şifre sıfırlama bağlantısı gönderildi. Lütfen gelen kutunuzu ve spam klasörünüzü kontrol edin."
      );
    } catch (err: any) {
      console.error("Password reset error:", err);
      if (err.code === "auth/user-not-found") {
        // Enforce user enumeration protection
        setSuccessMsg(
          "Eğer bu e-posta adresi sistemimizde kayıtlı ise şifre sıfırlama bağlantısı gönderildi. Lütfen gelen kutunuzu ve spam klasörünüzü kontrol edin."
        );
      } else if (err.code === "auth/invalid-email") {
        setError("Lütfen geçerli bir e-posta adresi formatı girin.");
      } else if (err.code === "auth/too-many-requests") {
        setError("Çok fazla istek gönderildi. Lütfen birkaç dakika sonra tekrar deneyin.");
      } else {
        setError("Şifre sıfırlama bağlantısı gönderilemedi. Lütfen internet bağlantınızı kontrol edin.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    setIsLoading(true);

    if (!firebaseConfigStatus.isValidForStokPro) {
      setError(
        firebaseConfigStatus.errorMessage ||
        "Stok-Pro için 'stok-pro-911b4' Web App yapılandırması gereklidir. Eski projeye bağlantı güvenlik sebebiyle engellendi."
      );
      setIsLoading(false);
      return;
    }

    if (!email || !password) {
      setError("Lütfen e-posta ve şifre alanlarını doldurun.");
      setIsLoading(false);
      return;
    }

    if (!isLogin && !companyName.trim()) {
      setError("Lütfen firma adınızı girin.");
      setIsLoading(false);
      return;
    }

    try {
      if (isLogin) {
        // Sign In
        await signInWithEmailAndPassword(auth, email.trim(), password);
        setSuccessMsg("Başarıyla giriş yapıldı! Yönlendiriliyorsunuz...");
        setTimeout(() => {
          onSuccess();
        }, 1200);
      } else {
        // Sign Up (Register)
        const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const user = userCredential.user;
        const tenantId = user.uid;
        const trimmedCompanyName = companyName.trim() || "Şirketim";

        // 1. Create Tenant Document (if not exists)
        const tenantRef = doc(db, "tenants", tenantId);
        const tenantSnap = await getDoc(tenantRef);
        if (!tenantSnap.exists()) {
          await setDoc(tenantRef, {
            id: tenantId,
            name: trimmedCompanyName,
            ownerUid: user.uid,
            plan: "pro",
            createdAt: new Date().toISOString()
          });
        }

        // 2. Create User Profile Document (if not exists)
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            tenantId: tenantId,
            role: "owner",
            email: user.email || email.trim(),
            displayName: trimmedCompanyName,
            createdAt: new Date().toISOString(),
            isActive: true
          });
        }

        // 3. Create Default Sector Settings for this specific user/tenant
        const selectedPreset = sectorPresets[selectedSector as keyof typeof sectorPresets] || sectorPresets.genel;
        
        await setDoc(doc(db, "settings", tenantId), {
          activeSector: selectedSector,
          customFields: selectedPreset.fields,
          updatedAt: new Date().toISOString()
        });

        // 4. Create Default Company Info
        await setDoc(doc(db, "company", tenantId), {
          name: trimmedCompanyName,
          address: "Lütfen firma adresinizi buraya yazın.",
          phone: "+90 555 000 00 00",
          email: email.trim(),
          taxOffice: "Vergi Dairesi",
          taxNumber: "0000000000",
          logo: ""
        });

        // 5. Seed demo products WITH tenantId & userId (Idempotent: only if tenant has no products)
        const existingProdsSnap = await getDocs(
          query(collection(db, "products"), where("tenantId", "==", tenantId), limit(1))
        );
        if (existingProdsSnap.empty) {
          for (const demoProd of selectedPreset.demoProducts) {
            await addDoc(collection(db, "products"), {
              ...demoProd,
              tenantId: tenantId,
              userId: user.uid,
              isActive: true,
              createdAt: new Date().toISOString()
            });
          }
        }

        // 6. Seed a demo customer WITH tenantId & userId (Idempotent: only if tenant has no customers)
        const existingCustSnap = await getDocs(
          query(collection(db, "customers"), where("tenantId", "==", tenantId), limit(1))
        );
        if (existingCustSnap.empty) {
          await addDoc(collection(db, "customers"), {
            tenantId: tenantId,
            userId: user.uid,
            name: "Örnek Müşteri",
            phone: "+905001112233",
            instagram: "ornek_instagram",
            totalDebt: 0,
            totalPaid: 0,
            notes: "Bu bir başlangıç müşteri kaydıdır.",
            transactions: [],
            createdAt: new Date().toISOString()
          });
        }

        // 7. Send Email Verification link in background (non-blocking)
        try {
          await sendEmailVerification(user);
        } catch (verifErr) {
          console.warn("Otomatik e-posta doğrulama gönderimi atlandı:", verifErr);
        }

        setSuccessMsg("Hesabınız ve şirket veri tabanınız başarıyla oluşturuldu! Giriş yapılıyor...");
        setTimeout(() => {
          onSuccess();
        }, 1500);
      }
    } catch (err: any) {
      console.error("Firebase auth error:", err);

      // In production / live environment: Strictly prohibit synthetic local-user fallback!
      if (!isDemoAllowed()) {
        let localizedError = "Bir hata oluştu. Lütfen bilgilerinizi kontrol edin.";
        if (
          err.code === "auth/api-key-not-valid" ||
          err.code === "auth/operation-not-allowed" ||
          err.message?.includes("api-key-not-valid") ||
          err.code === "auth/unauthorized-domain"
        ) {
          localizedError = "Kimlik doğrulama servisi yapılandırma hatası: Firebase Authentication bağlantısı sağlanamadı. Güvenliğiniz için yerel sahte oturum açılması engellenmiştir. Lütfen sistem yöneticisiyle iletişime geçin.";
        } else if (err.code === "auth/email-already-in-use") {
          localizedError = "Bu e-posta adresi zaten kullanımda. Giriş yapabilir veya şifrenizi sıfırlayabilirsiniz.";
        } else if (err.code === "auth/weak-password") {
          localizedError = "Şifre en az 6 karakter uzunluğunda olmalıdır.";
        } else if (err.code === "auth/invalid-email") {
          localizedError = "Lütfen geçerli bir e-posta adresi girin.";
        } else if (err.code === "auth/wrong-password" || err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
          localizedError = "E-posta veya şifre hatalı.";
        }
        setError(localizedError);
        return;
      }

      // Development fallback ONLY:
      if (
        err.code === "auth/api-key-not-valid" ||
        err.code === "auth/operation-not-allowed" ||
        err.message?.includes("api-key-not-valid") ||
        err.code === "auth/unauthorized-domain"
      ) {
        const userUid = `local-${email.split("@")[0] || "user"}`;
        const fallbackUser = {
          uid: userUid,
          email: email,
          companyName: companyName || "Şirketim",
          isDemo: true,
          activeSector: selectedSector
        };

        setSuccessMsg(
          isLogin
            ? "Çevrimdışı/Demo modunda başarıyla giriş yapıldı! Yönlendiriliyorsunuz..."
            : `Hesabınız ve '${companyName || "Şirketiniz"}' veri alanınız oluşturuldu! Yönlendiriliyorsunuz...`
        );

        setTimeout(() => {
          onSuccess(fallbackUser);
        }, 1000);
        return;
      }

      let localizedError = "Bir hata oluştu. Lütfen bilgilerinizi kontrol edin.";
      if (err.code === "auth/email-already-in-use") {
        localizedError = "Bu e-posta adresi kullanımda. Giriş yapabilir veya 'Geliştirme Demo Modu' butonunu kullanabilirsiniz.";
      } else if (err.code === "auth/weak-password") {
        localizedError = "Şifre en az 6 karakter uzunluğunda olmalıdır.";
      } else if (err.code === "auth/invalid-email") {
        localizedError = "Lütfen geçerli bir e-posta adresi girin.";
      } else if (err.code === "auth/wrong-password" || err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
        localizedError = "E-posta veya şifre hatalı.";
      }
      setError(localizedError);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 relative overflow-hidden font-sans">
      {/* Decorative vector background */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none"></div>

      {/* Main SaaS Brand Showcase header */}
      <div className="text-center mb-8 max-w-md z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-800/80 border border-slate-700/50 rounded-full text-indigo-400 text-xs font-bold mb-4 animate-pulse">
          <Sparkles className="w-3.5 h-3.5" />
          Profesyonel Stok & Cari Satış Otomasyonu
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-2">
          Stok<span className="text-indigo-500 font-black">SaaS</span>
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
          Kumaş rulo, perakende ve teknik parça takipli, dinamik bulut tabanlı modern ERP sistemi.
        </p>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800/90 backdrop-blur-md p-6 sm:p-8 rounded-2xl w-full max-w-md shadow-2xl border border-slate-700 z-10"
      >
        {!firebaseConfigStatus.isValidForStokPro && (
          <div className="mb-5 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs flex flex-col gap-2">
            <div className="flex items-center gap-2 font-bold text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
              <span>Stok-Pro Firebase İzolasyonu Devrede</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              {firebaseConfigStatus.errorMessage}
            </p>
            <div className="text-[10px] bg-slate-900/60 p-2 rounded border border-amber-500/20 text-slate-300 font-mono">
              Hedef: <span className="text-amber-300 font-bold">stok-pro-911b4</span> | DB: <span className="text-amber-300 font-bold">(default)</span>
            </div>
          </div>
        )}

        {isForgotPassword ? (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setIsForgotPassword(false);
                  setError("");
                  setSuccessMsg("");
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                title="Giriş Ekranına Dön"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-indigo-400" />
                  Şifre Sıfırlama
                </h3>
                <p className="text-[11px] text-slate-400">
                  Hesabınıza bağlı e-posta adresinize sıfırlama bağlantısı gönderilecektir.
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl flex items-center gap-2 mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                <p className="font-semibold">{error}</p>
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs rounded-xl flex items-center gap-2 mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                <p className="font-semibold">{successMsg}</p>
              </div>
            )}

            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Kayıtlı E-Posta Adresi</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Örn: musteri@firma.com"
                    className="w-full bg-slate-900 border border-slate-700/80 hover:border-slate-600 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/50 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer mt-4"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  "Şifre Sıfırlama Bağlantısı Gönder"
                )}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsForgotPassword(false);
                    setError("");
                    setSuccessMsg("");
                  }}
                  className="text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Giriş ekranına geri dön
                </button>
              </div>
            </form>
          </div>
        ) : (
          <>
            <div className="flex gap-4 border-b border-slate-700 pb-4 mb-6">
              <button
                type="button"
                onClick={() => { setIsLogin(true); setError(""); }}
                className={`flex-1 pb-2 font-bold text-sm transition-all relative ${
                  isLogin ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Giriş Yap
                {isLogin && <span className="absolute bottom-[-17px] left-0 right-0 h-0.5 bg-indigo-500 rounded-full"></span>}
              </button>
              <button
                type="button"
                onClick={() => { setIsLogin(false); setError(""); }}
                className={`flex-1 pb-2 font-bold text-sm transition-all relative ${
                  !isLogin ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Yeni Üyelik Aç
                {!isLogin && <span className="absolute bottom-[-17px] left-0 right-0 h-0.5 bg-indigo-500 rounded-full"></span>}
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs rounded-xl flex items-center gap-2 mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                <p className="font-semibold">{error}</p>
              </div>
            )}

            {successMsg && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs rounded-xl flex items-center gap-2 mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                <p className="font-semibold">{successMsg}</p>
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-4">
              {!isLogin && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Firma Adı</label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 transform -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Örn: Özgür Tekstil Ltd."
                      className="w-full bg-slate-900 border border-slate-700/80 hover:border-slate-600 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">E-Posta Adresi</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Örn: musteri@firma.com"
                    className="w-full bg-slate-900 border border-slate-700/80 hover:border-slate-600 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Şifre</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 transform -translate-y-1/2" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="En az 6 karakter"
                    className="w-full bg-slate-900 border border-slate-700/80 hover:border-slate-600 rounded-xl py-2.5 pl-10 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isLogin && (
                <div className="flex justify-end pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsForgotPassword(true);
                      setError("");
                      setSuccessMsg("");
                    }}
                    className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Şifremi Unuttum?
                  </button>
                </div>
              )}

              {!isLogin && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Sektör & İş Modeli</label>
                  <div className="relative">
                    <Briefcase className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 transform -translate-y-1/2" />
                    <select
                      value={selectedSector}
                      onChange={(e) => setSelectedSector(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700/80 hover:border-slate-600 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer appearance-none"
                    >
                      <option value="tekstil">Tekstil & Giyim Sektörü (Kumaş Rulo Takipli)</option>
                      <option value="gida">Gıda & Hızlı Tüketim (SKT ve Gramaj)</option>
                      <option value="yedek_parca">Otomotiv & Yedek Parça (Parça Kodu, Raf No)</option>
                      <option value="genel">Genel Perakende & Diğer Sektörler</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                      <ChevronRight className="w-4 h-4 transform rotate-90" />
                    </div>
                  </div>
                  <span className="text-[9px] text-indigo-400 mt-1 leading-normal font-semibold block">
                    Seçtiğiniz sektöre göre dinamik alanlar ve demo ürünler otomatik yüklenecektir.
                  </span>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/50 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer mt-6"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : isLogin ? (
                  "Sisteme Güvenli Giriş Yap"
                ) : (
                  "Veritabanımı Oluştur ve Başla"
                )}
              </button>

              {isDemoAllowed() && (
                <>
                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-slate-700"></div>
                    <span className="flex-shrink mx-4 text-slate-500 text-[10px] font-bold uppercase tracking-wider">Geliştirme / Test</span>
                    <div className="flex-grow border-t border-slate-700"></div>
                  </div>

                  <button
                    type="button"
                    onClick={handleDemoLogin}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-600/10"
                  >
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    Geliştirme Demo Modu ile Başla
                  </button>
                </>
              )}
            </form>
          </>
        )}
      </motion.div>

      {/* Features showcase for SaaS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 max-w-lg z-10 px-4 text-center">
        <div className="p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl">
          <CheckCircle className="w-4 h-4 text-emerald-400 mx-auto mb-1.5" />
          <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">Kesin İzolasyon</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">Her işletmenin verisi tamamen kendine özeldir.</p>
        </div>
        <div className="p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl">
          <TrendingUp className="w-4 h-4 text-indigo-400 mx-auto mb-1.5" />
          <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">Mobil & Tablet</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">Tüm ekranlarda mükemmel kullanım kolaylığı.</p>
        </div>
        <div className="p-3 bg-slate-800/40 border border-slate-700/30 rounded-xl">
          <Sliders className="w-4 h-4 text-pink-400 mx-auto mb-1.5" />
          <h4 className="text-[11px] font-bold text-white uppercase tracking-wider">Hızlı & Sınırsız</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">Bulut altyapısı sayesinde anında işlem gücü.</p>
        </div>
      </div>

      <div className="text-slate-500 text-[10px] mt-8 z-10 font-mono text-center">
        StokSaaS © 2026 - Tüm Hakları Saklıdır
      </div>
    </div>
  );
}
