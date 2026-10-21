/**
 * STOK-PRO FIREBASE YAPILANDIRMA VE İZOLASYON DOĞRULAMA TESTİ
 * 
 * Bu test, Stok-Pro uygulamasının gerçek Firebase projesi olan 'stok-pro-911b4'
 * ile yapılandırıldığını ve eski 'guvenliyardim-22dff' projesine ya da eski
 * isimlendirilmiş veritabanına hiçbir aktif bağlantı olmadığını statik ve
 * çalışma zamanı seviyesinde kanıtlar.
 */

import * as fs from "fs";
import * as path from "path";
import { validateFirebaseConfiguration, TARGET_STOKPRO_PROJECT_ID, FORBIDDEN_LEGACY_PROJECT_IDS, FORBIDDEN_LEGACY_DATABASE_IDS } from "../src/lib/firebase";

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  error?: string;
}

const results: TestResult[] = [];

function assertTest(name: string, passed: boolean, expected: string, actual: string) {
  results.push({ name, passed, expected, actual });
  if (passed) {
    console.log(`  [OK] ${name}`);
  } else {
    console.error(`  [FAIL] ${name} (Beklenen: ${expected}, Gerçek: ${actual})`);
  }
}

console.log("==================================================================");
console.log("STOK-PRO FIREBASE GERÇEK YAPILANDIRMA VE İZOLASYON DOĞRULAMASI");
console.log("==================================================================\n");

// 1. firebase-applet-config.json doğrulaması
console.log("1. firebase-applet-config.json Kontrolleri:");
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const configRaw = fs.readFileSync(configPath, "utf-8");
const config = JSON.parse(configRaw);

assertTest(
  "Project ID stok-pro-911b4 ile eşleşmeli",
  config.projectId === "stok-pro-911b4",
  "stok-pro-911b4",
  config.projectId
);

assertTest(
  "Web App ID 995564398410 numaralı Stok-Pro Web App ile eşleşmeli",
  config.appId === "1:995564398410:web:b1d389890e581379f1c3b3",
  "1:995564398410:web:b1d389890e581379f1c3b3",
  config.appId
);

assertTest(
  "API Key sağlanan gerçek Stok-Pro anahtarı olmalı",
  config.apiKey === "AIzaSyD4gSodM19AkXt6F29AgohGEO9mYHoCBwY",
  "AIzaSyD4gSodM19AkXt6F29AgohGEO9mYHoCBwY",
  config.apiKey
);

assertTest(
  "Auth Domain stok-pro-911b4.firebaseapp.com olmalı",
  config.authDomain === "stok-pro-911b4.firebaseapp.com",
  "stok-pro-911b4.firebaseapp.com",
  config.authDomain
);

assertTest(
  "Messaging Sender ID 995564398410 olmalı",
  config.messagingSenderId === "995564398410",
  "995564398410",
  config.messagingSenderId
);

assertTest(
  "Measurement ID G-Q9N3HSJ7HD olmalı",
  config.measurementId === "G-Q9N3HSJ7HD",
  "G-Q9N3HSJ7HD",
  config.measurementId
);

assertTest(
  "Yapılandırma dosyası eski guvenliyardim-22dff projesini İÇERMEMELİ",
  !configRaw.includes("guvenliyardim-22dff"),
  "false",
  String(configRaw.includes("guvenliyardim-22dff"))
);

assertTest(
  "Yapılandırma dosyası eski isimlendirilmiş veritabanını İÇERMEMELİ",
  !configRaw.includes("ai-studio-stokvesattakip-f56c5e22-8eb7-4162-ab1f-5ad8221f92dd"),
  "false",
  String(configRaw.includes("ai-studio-stokvesattakip-f56c5e22-8eb7-4162-ab1f-5ad8221f92dd"))
);

// 2. .firebaserc doğrulaması
console.log("\n2. .firebaserc CLI Hedef Kontrolleri:");
const firebasercPath = path.join(process.cwd(), ".firebaserc");
const firebasercRaw = fs.readFileSync(firebasercPath, "utf-8");
const firebaserc = JSON.parse(firebasercRaw);

assertTest(
  "CLI default projesi stok-pro-911b4 olmalı",
  firebaserc.projects?.default === "stok-pro-911b4",
  "stok-pro-911b4",
  firebaserc.projects?.default
);

assertTest(
  ".firebaserc eski guvenliyardim-22dff projesini İÇERMEMELİ",
  !firebasercRaw.includes("guvenliyardim-22dff"),
  "false",
  String(firebasercRaw.includes("guvenliyardim-22dff"))
);

// 3. firebase.json doğrulaması
console.log("\n3. firebase.json Veritabanı Hedef Kontrolleri:");
const firebaseJsonPath = path.join(process.cwd(), "firebase.json");
const firebaseJsonRaw = fs.readFileSync(firebaseJsonPath, "utf-8");
const firebaseJson = JSON.parse(firebaseJsonRaw);

assertTest(
  "firebase.json firestore tekil nesne olmalı (varsayılan veritabanı hedefi)",
  !Array.isArray(firebaseJson.firestore) && firebaseJson.firestore?.rules === "firestore.rules",
  "firestore.rules",
  firebaseJson.firestore?.rules
);

assertTest(
  "firebase.json eski isimlendirilmiş veritabanını İÇERMEMELİ",
  !firebaseJsonRaw.includes("ai-studio-stokvesattakip-f56c5e22-8eb7-4162-ab1f-5ad8221f92dd"),
  "false",
  String(firebaseJsonRaw.includes("ai-studio-stokvesattakip-f56c5e22-8eb7-4162-ab1f-5ad8221f92dd"))
);

assertTest(
  "firebase.json statik Hosting hedefi 'dist' olmalı",
  firebaseJson.hosting?.public === "dist",
  "dist",
  firebaseJson.hosting?.public
);

assertTest(
  "firebase.json SPA yönlendirmesi (/index.html) tanımlı olmalı",
  Array.isArray(firebaseJson.hosting?.rewrites) && firebaseJson.hosting.rewrites[0]?.destination === "/index.html",
  "/index.html",
  firebaseJson.hosting?.rewrites?.[0]?.destination
);

assertTest(
  "firebase.json 0 TL Spark koruması: functions bloğu İÇERMEMELİ",
  firebaseJson.functions === undefined,
  "undefined",
  String(firebaseJson.functions)
);


// 4. src/lib/firebase.ts Muhafız Fonksiyonu Doğrulaması
console.log("\n4. src/lib/firebase.ts Çalışma Zamanı Muhafız Kontrolleri:");
const validation = validateFirebaseConfiguration();

assertTest(
  "validateFirebaseConfiguration() Stok-Pro için geçerli dönmeli (isValidForStokPro === true)",
  validation.isValidForStokPro === true,
  "true",
  String(validation.isValidForStokPro)
);

assertTest(
  "Eski proje engeli tetiklenmemeli (isBlockedLegacy === false)",
  validation.isBlockedLegacy === false,
  "false",
  String(validation.isBlockedLegacy)
);

assertTest(
  "Hedef proje stok-pro-911b4 olmalı",
  validation.targetProjectId === TARGET_STOKPRO_PROJECT_ID,
  TARGET_STOKPRO_PROJECT_ID,
  validation.targetProjectId
);

assertTest(
  "Veritabanı hedefi (default) olmalı",
  validation.databaseTarget === "(default)",
  "(default)",
  validation.databaseTarget
);

assertTest(
  "Eksik zorunlu alan kalmamış olmalı (missingFields empty)",
  validation.missingFields.length === 0,
  "0",
  String(validation.missingFields.length)
);

console.log("\n==================================================================");
const failedCount = results.filter((r) => !r.passed).length;
if (failedCount === 0) {
  console.log(`SONUÇ: TÜM TESTLER BAŞARILI (${results.length}/${results.length})`);
  console.log("Stok-Pro, bağımsız 'stok-pro-911b4' projesine ve (default) veritabanına başarıyla bağlanmaya hazırdır.");
} else {
  console.error(`SONUÇ: ${failedCount} TEST BAŞARISIZ OLDU!`);
  process.exit(1);
}
console.log("==================================================================");
