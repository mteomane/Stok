import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import firebaseConfigJson from "../../firebase-applet-config.json";

// ============================================================================
// STOK-PRO FIREBASE PROJE İZOLASYONU VE GÜVENLİK MUHAFIZI
// ============================================================================
// Stok-Pro ve Güvenli Yardım iki ayrı üründür ve hiçbir Firebase projesini,
// veritabanını, kullanıcısını veya yetki alanını paylaşamaz.
// ============================================================================

export const TARGET_STOKPRO_PROJECT_ID = "stok-pro-911b4";
export const FORBIDDEN_LEGACY_PROJECT_IDS = ["guvenliyardim-22dff"];
export const FORBIDDEN_LEGACY_DATABASE_IDS = [
  "ai-studio-stokvesattakip-f56c5e22-8eb7-4162-ab1f-5ad8221f92dd"
];

export interface FirebaseConfigValidation {
  isValidForStokPro: boolean;
  isBlockedLegacy: boolean;
  currentProjectId: string;
  targetProjectId: string;
  databaseTarget: string;
  errorMessage?: string;
  missingFields: string[];
}

function getEnvValue(key: string): string {
  if (typeof process !== "undefined" && process?.env && process.env[key]) {
    const val = (process.env[key] as string).trim();
    if (val && !val.includes("1234567890")) {
      return val;
    }
  }
  try {
    const metaObj = typeof import.meta !== "undefined" ? (import.meta as any) : undefined;
    const metaVal = metaObj?.env?.[key];
    if (metaVal && typeof metaVal === "string" && !metaVal.includes("1234567890")) {
      return metaVal.trim();
    }
  } catch {
    return "";
  }
  return "";
}

export function validateFirebaseConfiguration(): FirebaseConfigValidation {
  const rawProjectId = (getEnvValue("VITE_FIREBASE_PROJECT_ID") || (firebaseConfigJson as any).projectId || "").trim();
  const rawDatabaseId = ((firebaseConfigJson as any).firestoreDatabaseId || "").trim();

  // 1. KRİTİK GÜVENLİK ENGELİ: Eski Güvenli Yardım projesi veya eski veritabanı engellenir
  if (
    FORBIDDEN_LEGACY_PROJECT_IDS.includes(rawProjectId) ||
    FORBIDDEN_LEGACY_DATABASE_IDS.includes(rawDatabaseId)
  ) {
    return {
      isValidForStokPro: false,
      isBlockedLegacy: true,
      currentProjectId: rawProjectId,
      targetProjectId: TARGET_STOKPRO_PROJECT_ID,
      databaseTarget: "(default)",
      errorMessage: `GÜVENLİK ENGELİ: Stok-Pro uygulaması eski '${rawProjectId}' projesine veya '${rawDatabaseId}' veritabanına BAĞLANAMAZ. Bu iki ürünün veritabanı ve kullanıcıları tamamen ayrıdır.`,
      missingFields: ["apiKey", "appId", "authDomain", "projectId"]
    };
  }

  // 2. Emulator Test Ortamı Kontrolü (İzole test suite)
  if (rawProjectId === "demo-stok-satis-test") {
    return {
      isValidForStokPro: true,
      isBlockedLegacy: false,
      currentProjectId: rawProjectId,
      targetProjectId: "demo-stok-satis-test",
      databaseTarget: "(default)",
      missingFields: []
    };
  }

  // 3. Stok-Pro projesi hedeflenmişse tam Web App parametrelerini doğrula
  if (rawProjectId === TARGET_STOKPRO_PROJECT_ID) {
    const apiKey = getEnvValue("VITE_FIREBASE_API_KEY") || (firebaseConfigJson as any).apiKey || "";
    const appId = getEnvValue("VITE_FIREBASE_APP_ID") || (firebaseConfigJson as any).appId || "";
    const missing: string[] = [];

    // Eski projeden kopyalanmış anahtar tespiti
    if (!apiKey || apiKey.startsWith("AIzaSyBFZWOwMlalM")) {
      missing.push("apiKey (Stok-Pro Web App anahtarı)");
    }
    if (!appId || appId.includes("786058252298")) {
      missing.push("appId (Stok-Pro Web App ID)");
    }

    if (missing.length > 0) {
      return {
        isValidForStokPro: false,
        isBlockedLegacy: false,
        currentProjectId: rawProjectId,
        targetProjectId: TARGET_STOKPRO_PROJECT_ID,
        databaseTarget: "(default)",
        errorMessage: `YAPILANDIRMA EKSİK: '${TARGET_STOKPRO_PROJECT_ID}' projesi tanımlandı ancak gerçek Web App SDK bilgileri eksik veya eski projeden kalma: ${missing.join(", ")}`,
        missingFields: missing
      };
    }

    return {
      isValidForStokPro: true,
      isBlockedLegacy: false,
      currentProjectId: rawProjectId,
      targetProjectId: TARGET_STOKPRO_PROJECT_ID,
      databaseTarget: "(default)",
      missingFields: []
    };
  }

  // 4. Varsayılan eksik yapılandırma
  return {
    isValidForStokPro: false,
    isBlockedLegacy: false,
    currentProjectId: rawProjectId,
    targetProjectId: TARGET_STOKPRO_PROJECT_ID,
    databaseTarget: "(default)",
    errorMessage: `YAPILANDIRMA TANIMSIZ: Stok-Pro için hedef proje kimliği '${TARGET_STOKPRO_PROJECT_ID}' olmalıdır. (Algılanan: '${rawProjectId || "boş"}')`,
    missingFields: ["projectId", "apiKey", "appId", "authDomain"]
  };
}

export const firebaseConfigStatus = validateFirebaseConfiguration();

// Web App başlatma mantığı
let app: FirebaseApp;

if (firebaseConfigStatus.isValidForStokPro) {
  const activeConfig = {
    apiKey: getEnvValue("VITE_FIREBASE_API_KEY") || (firebaseConfigJson as any).apiKey,
    authDomain: getEnvValue("VITE_FIREBASE_AUTH_DOMAIN") || `${TARGET_STOKPRO_PROJECT_ID}.firebaseapp.com`,
    projectId: getEnvValue("VITE_FIREBASE_PROJECT_ID") || TARGET_STOKPRO_PROJECT_ID,
    storageBucket: getEnvValue("VITE_FIREBASE_STORAGE_BUCKET") || `${TARGET_STOKPRO_PROJECT_ID}.firebasestorage.app`,
    messagingSenderId: getEnvValue("VITE_FIREBASE_MESSAGING_SENDER_ID") || (firebaseConfigJson as any).messagingSenderId,
    appId: getEnvValue("VITE_FIREBASE_APP_ID") || (firebaseConfigJson as any).appId,
    measurementId: getEnvValue("VITE_FIREBASE_MEASUREMENT_ID") || (firebaseConfigJson as any).measurementId || undefined
  };

  const existingApps = getApps();
  const found = existingApps.find((a) => a.name === "stok-pro-app");
  app = found || initializeApp(activeConfig, "stok-pro-app");
} else {
  // Eski projeye veya yanlış veritabanına bağlanmayı fiziksel olarak imkansız kılan
  // izole, ağ trafiği üretmeyen yerel yer tutucu app örneği oluşturulur.
  if (firebaseConfigStatus.isBlockedLegacy) {
    console.error(
      `[STOK-PRO FIREBASE GÜVENLİK ENGELİ] ${firebaseConfigStatus.errorMessage}\n` +
      `Eski 'guvenliyardim-22dff' projesine bağlantı ENGELLENDİ.`
    );
  } else {
    console.warn(
      `[STOK-PRO YAPILANDIRMA BİLGİSİ] ${firebaseConfigStatus.errorMessage}`
    );
  }

  const safePlaceholderConfig = {
    apiKey: "AIzaSy_STOKPRO_PENDING_WEB_CONFIG_KEY",
    authDomain: `${TARGET_STOKPRO_PROJECT_ID}.firebaseapp.com`,
    projectId: TARGET_STOKPRO_PROJECT_ID,
    storageBucket: `${TARGET_STOKPRO_PROJECT_ID}.firebasestorage.app`,
    appId: "1:000000000000:web:pendingstokpro"
  };

  const existingApps = getApps();
  const found = existingApps.find((a) => a.name === "stok-pro-pending");
  app = found || initializeApp(safePlaceholderConfig, "stok-pro-pending");
}

// Servisler tek bir izole FirebaseApp örneğinden başlatılır
export const auth: Auth = getAuth(app);

// Firestore her zaman varsayılan (default) veritabanına bağlanır.
// İkinci parametre (databaseId) bilerek verilmemiştir; böylece Firebase SDK
// varsayılan (default) veritabanını kullanır ve eski isimlendirilmiş veritabanı bypass edilir.
export const db: Firestore = getFirestore(app);
