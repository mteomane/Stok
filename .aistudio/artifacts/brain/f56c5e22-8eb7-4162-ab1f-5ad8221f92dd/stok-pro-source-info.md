# Stok-Pro — Güncel Kaynak Kodu Arşivi

Bu paket, **İşlem 7S** kapsamında tüm güvenlik açıkları giderilmiş, 0 TL Spark uyumlu, 231 otomatik testten başarıyla geçmiş ve Windows üzerinde `npm ci --legacy-peer-deps` ile doğrudan kurulabilir kaynak kodlarını içermektedir.

---

### 📦 İndirme Bağlantısı

- **Dosya Adı:** `stok-pro-source.zip`
- **Boyut:** ~405 KB
- **Doğrudan İndirme:** Tarayıcınızda veya önizleme adresinizde `/stok-pro-source.zip` yoluna giderek indirebilirsiniz:
  `[stok-pro-source.zip İndir](/stok-pro-source.zip)`

---

### 📂 Arşiv İçeriği

1. **`package.json`**:
   - `xlsx` bağımlılığı kaldırılmış ve güvenli `read-excel-file` eklenmiştir.
   - `dependencies` içindeki mükerrer `vite` kaldırılmış; `devDependencies` altında `6.4.5` sürümüne güncellenmiştir.
   - `@grpc/grpc-js`, `body-parser`, `qs`, `proxy-addr`, `nanoid`, `browserslist`, `postcss`, `source-map-js` güvenlik yamaları `overrides` ile sabitlenmiştir.
2. **`package-lock.json`**:
   - `npm ci --legacy-peer-deps` ile sıfır güvenlik açığı (`found 0 vulnerabilities`) üreten temiz kilit dosyası.
3. **`.firebaserc`**:
   - Yalnızca `stok-pro-911b4` projesine ayarlanmıştır (`guvenliyardim-22dff` içermez).
4. **`firebase.json`**:
   - Spark 0 TL uyumlu, tekil `(default)` Firestore ve statik Hosting (`dist/`) yapılandırması.
5. **`firestore.rules`**:
   - 67 senaryoyla doğrulanan tam çok kiracılı (multi-tenant) güvenlik kuralları.
6. **`firestore.indexes.json`**:
   - Bileşik filtreler için Firestore indeks tanımları.
7. **`firebase-applet-config.json`**:
   - Stok-Pro bağımsız Web App kimlikleri (Web App ID: 995564398410).
8. **`src/`**:
   - Ürün, Satış ve CRM/Müşteri gerçek zamanlı senkronizasyon kodları (`subscribeCustomers`, `subscribeProducts`, `subscribeSales`).
   - Kumaş metraj yönetimi, barkod okuyucu, SHA-256 imzalı yedekleme motoru.
9. **`scripts/`**:
   - 231 testlik Firestore Emulator ve izolasyon test paketleri.

---

### 💻 Windows Kurulum Adımları

Arşivi bilgisayarınızda bir klasöre çıkardıktan sonra PowerShell veya Komut İstemi (CMD) ile şu komutları çalıştırınız:

```bash
# 1. Bağımlılıkları temiz kilit dosyasına göre kurun:
npm ci --legacy-peer-deps

# 2. Kod bütünlüğünü doğrulayın:
npm run lint

# 3. Üretim paketini derleyin:
npm run build
```
