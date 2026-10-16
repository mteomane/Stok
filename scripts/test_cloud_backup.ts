/**
 * İŞLEM 5A - OTOMATİK BULUT YEDEKLEME SİSTEMİ TEST PAKETİ
 * 
 * Doğrulanan Senaryolar:
 * 1. Bir tenant için otomatik bulut yedeği oluşturma ve storage/metadata doğrulaması
 * 2. İki farklı tenant verilerinin mutlak izolasyonu (Sıfır sızıntı garantisi)
 * 3. Yasaklı sistem koleksiyonlarının (users, subscriptions, secrets) engellenmesi
 * 4. Kriptografik SHA-256 sağlama ve Restore Engine ile %100 uyumluluk
 * 5. Yarıda kesilen/başarısız işlemde 'success' işaretlenmemesi (Fail-safe koruması)
 * 6. Aynı tenant için eşzamanlı çakışma (Concurrency Lock) ve mükerrerlik engeli
 * 7. Çok kiracılı toplu çalıştırmada hata izolasyonu (Bir tenant hatası diğerlerini durdurmaz)
 * 8. 30 günlük saklama süresi (Retention Policy) ve minimum yedek koruma kuralı
 * 9. Yetkisiz kullanıcının başka bir tenant'a ait yedek nesnesine erişim engeli
 */

import { CloudBackupService, TenantDataProvider } from "../src/lib/backup/CloudBackupService";
import { 
  InMemoryCloudStorageAdapter, 
  GoogleCloudStorageAdapter, 
  createDefaultStorageAdapter 
} from "../src/lib/backup/CloudStorageAdapter";
import { InMemoryLockManager } from "../src/lib/backup/BackupLockManager";
import { ScheduledBackupRunner } from "../src/lib/backup/ScheduledBackupRunner";
import { verifyServerTenantAuth } from "../src/lib/backup/serverAuth";
import { exportService } from "../src/lib/export/ExportService";
import { verifyBackupChecksum } from "../src/lib/export/backupCrypto";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const cjsRequire = createRequire(import.meta.url);

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedCount++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    failedCount++;
  }
}

async function runCloudBackupTests() {
  console.log("=====================================================================");
  console.log("İŞLEM 5A - OTOMATİK BULUT YEDEKLEME (CLOUD BACKUP) TEST PAKETİ");
  console.log("=====================================================================");

  const storageAdapter = new InMemoryCloudStorageAdapter();
  const backupService = new CloudBackupService(storageAdapter, {
    bucketName: "stokpro-test-private-backups",
    retentionDays: 30,
    minBackupsToKeep: 2,
    maxRetries: 3
  });

  const tenantA = "tenant_alpha_ltd";
  const tenantB = "tenant_beta_as";

  // Mock data provider for Tenant A
  const providerTenantA: TenantDataProvider = {
    async getTenantData(tId: string) {
      return {
        companyName: "Alpha Tekstil Ltd.",
        collections: {
          products: [
            { id: "p_a1", name: "İpek Kumaş A", price: 250, tenantId: tId },
            { id: "p_a2", name: "Pamuk Kumaş A", price: 150, tenantId: tId }
          ],
          customers: [
            { id: "c_a1", name: "Müşteri Alpha 1", totalDebt: 0, tenantId: tId }
          ],
          suppliers: [
            { id: "s_a1", name: "Tedarikçi Alpha 1", tenantId: tId }
          ],
          sales: [
            { id: "sal_a1", total: 500, status: "Tamamlandı", tenantId: tId }
          ],
          warehouses: [
            { id: "w_a1", name: "Merkez Depo A", tenantId: tId }
          ],
          orders: [],
          payments: [
            { id: "pay_a1", amount: 500, tenantId: tId }
          ],
          stockMovements: [
            { id: "sm_a1", quantity: 20, tenantId: tId }
          ]
        }
      };
    }
  };

  // Mock data provider for Tenant B
  const providerTenantB: TenantDataProvider = {
    async getTenantData(tId: string) {
      return {
        companyName: "Beta Konfeksiyon A.Ş.",
        collections: {
          products: [
            { id: "p_b1", name: "Keten Kumaş B", price: 400, tenantId: tId }
          ],
          customers: [
            { id: "c_b1", name: "Müşteri Beta 1", tenantId: tId }
          ],
          suppliers: [],
          sales: [],
          warehouses: [],
          orders: [],
          payments: [],
          stockMovements: []
        }
      };
    }
  };

  // -------------------------------------------------------------------
  // TEST 1: Bir Tenant İçin Otomatik Bulut Yedeği Oluşturma
  // -------------------------------------------------------------------
  console.log("\nTEST 1: Tenant A İçin Otomatik Bulut Yedeği Oluşturma & Storage Mühürleme");
  const jobMetaA = await backupService.executeTenantBackup(tenantA, providerTenantA);

  assert(jobMetaA.status === "success", "Yedekleme durumu 'success' olmalı");
  assert(Boolean(jobMetaA.objectPath && jobMetaA.objectPath.includes(tenantA)), "Storage nesne yolu tenant ID'sini içermeli");
  assert(Boolean(jobMetaA.checksum && jobMetaA.checksum.startsWith("sha256:") && jobMetaA.checksum.length === 71), "Standart 'sha256:' önekli 64 hex karakterlik kriptografik SHA-256 özeti üretilmeli");
  assert(jobMetaA.checksumVerified === true, "Buluta yükleme öncesi checksum doğrulanmış olmalı");
  assert(jobMetaA.totalRecords === 8, "Tenant A'nın toplam 8 iş kaydı (2 ürün, 1 müşteri, 1 tedarikçi, 1 satış, 1 depo, 1 ödeme, 1 hareket) eksiksiz tespit edilmeli");
  assert(storageAdapter.getStoredCount() === 1, "Cloud Storage bucket içinde tam 1 adet özel nesne bulunmalı");

  // -------------------------------------------------------------------
  // TEST 2: İki Farklı Tenant Verilerinin Mutlak İzolasyonu
  // -------------------------------------------------------------------
  console.log("\nTEST 2: İki Farklı Tenant Verilerinin İzolasyonu (Cross-Tenant Leakage Check)");
  const jobMetaB = await backupService.executeTenantBackup(tenantB, providerTenantB);

  assert(jobMetaB.status === "success", "Tenant B yedeği başarıyla tamamlanmalı");
  assert(storageAdapter.getStoredCount() === 2, "Storage'da iki ayrı tenant için iki ayrı nesne bulunmalı");

  // Verify downloaded contents are completely segregated
  const archiveA = await backupService.fetchBackupArchiveForRestore(tenantA, jobMetaA.objectPath!);
  const archiveB = await backupService.fetchBackupArchiveForRestore(tenantB, jobMetaB.objectPath!);

  assert(archiveA.metadata.tenantId === tenantA, "Archive A kesinlikle Tenant A'ya ait olmalı");
  assert(archiveB.metadata.tenantId === tenantB, "Archive B kesinlikle Tenant B'ya ait olmalı");
  assert(
    archiveA.data.products.every(p => p.tenantId === tenantA),
    "Archive A ürünlerinde asla Tenant B kaydı bulunmamalı"
  );
  assert(
    archiveB.data.products.every(p => p.tenantId === tenantB),
    "Archive B ürünlerinde asla Tenant A kaydı bulunmamalı"
  );

  // -------------------------------------------------------------------
  // TEST 3: Yasaklı Sistem Koleksiyonlarının Dışarı Aktarılmaması
  // -------------------------------------------------------------------
  console.log("\nTEST 3: Yasaklı Koleksiyon Koruması (users, subscriptions, credentials)");
  const toxicProvider: TenantDataProvider = {
    async getTenantData(tId: string) {
      return {
        companyName: "Hileli Firma",
        collections: {
          products: [],
          users: [{ id: "usr_root", passwordHash: "secret_123" }],
          subscriptions: [{ id: "sub_1", planId: "enterprise_free" }]
        }
      };
    }
  };

  const toxicJob = await backupService.executeTenantBackup("toxic_tenant", toxicProvider);
  assert(toxicJob.status === "failed", "Yasaklı koleksiyon içeren yedek talebi 'failed' olarak durdurulmalı");
  assert(Boolean(toxicJob.error && toxicJob.error.includes("Yasaklı koleksiyon")), "Hata mesajında yasaklı koleksiyon engeli bildirilmeli");

  // -------------------------------------------------------------------
  // TEST 4: Kriptografik SHA-256 Doğrulaması ve Restore Engine Uyumluluğu
  // -------------------------------------------------------------------
  console.log("\nTEST 4: SHA-256 Sağlama ve Mevcut Restore Engine ile %100 Uyumluluk");
  const validationResult = await exportService.validateBackupArchive(archiveA, tenantA);
  assert(validationResult.isValid === true, "Restore Engine sunucu yedeğini doğrudan geçerli kabul etmeli");
  assert(validationResult.checksumType === "sha256", "Checksum tipi 'sha256' olarak tanınmalı");
  assert(validationResult.isLegacy === false, "Sunucu yedeği 'legacy' değil modern format olmalı");

  // Tamper test: Modify 1 item price in archive and verify Restore Engine rejects
  const tamperedArchive = JSON.parse(JSON.stringify(archiveA));
  tamperedArchive.data.products[0].price = 99999;
  const tamperedValidation = await exportService.validateBackupArchive(tamperedArchive, tenantA);
  assert(tamperedValidation.isValid === false, "Fiyatı 1 kuruş dahi değiştirilen bulut yedeği derhal reddedilmeli");

  // -------------------------------------------------------------------
  // TEST 5: Yarıda Kesilen/Hatalı İşlemde 'success' İşaretlenmemesi
  // -------------------------------------------------------------------
  console.log("\nTEST 5: Kesinti ve Arıza Durumunda Fail-Safe Koruma (Asla Yalancı Başarı Üretilmemeli)");
  const failedJob = await backupService.executeTenantBackup(tenantA, providerTenantA, {
    testSimulateFailure: true
  });
  assert(failedJob.status === "failed", "Arıza durumunda durum 'failed' kalmalı");
  assert(failedJob.status !== "success", "Hata alan iş asla 'success' olarak etiketlenmemeli");
  assert(Boolean(failedJob.error && failedJob.error.includes("kontrollü")), "Gerçek hata sebebi metadata'ya yazılmalı");

  // -------------------------------------------------------------------
  // TEST 6: Eşzamanlı Çakışma Koruması (Concurrency Lock)
  // -------------------------------------------------------------------
  console.log("\nTEST 6: Eşzamanlı Çakışma Koruması (Concurrency Lock)");
  // Create a slow provider to test overlapping execution
  let resolveSlowProvider: () => void;
  const slowPromise = new Promise<void>(res => { resolveSlowProvider = res; });
  const slowProvider: TenantDataProvider = {
    async getTenantData(tId: string) {
      await slowPromise;
      return { companyName: "Slow Co", collections: { products: [] } };
    }
  };

  const lockTenant = "tenant_lock_test";
  const run1 = backupService.executeTenantBackup(lockTenant, slowProvider);

  // Attempt second concurrent execution for same tenant
  let lockCaught = false;
  try {
    await backupService.executeTenantBackup(lockTenant, slowProvider);
  } catch (err: any) {
    if (err.message.includes("devam eden bir yedekleme işi")) {
      lockCaught = true;
    }
  }
  assert(lockCaught, "Aynı tenant için çalışan iş varken ikinci iş kilit ile engellenmeli");

  // Resolve slow provider so first job finishes
  resolveSlowProvider!();
  await run1;

  // -------------------------------------------------------------------
  // TEST 7: Çok Kiracılı Toplu Çalıştırmada Hata İzolasyonu (Fault Isolation)
  // -------------------------------------------------------------------
  console.log("\nTEST 7: Çok Kiracılı Toplu Çalıştırmada Hata İzolasyonu");
  const tenantsBatch = ["tenant_batch_1", "tenant_batch_err", "tenant_batch_2"];
  const batchResult = await backupService.executeScheduledBackupForAllTenants(tenantsBatch, (tId) => {
    if (tId === "tenant_batch_err") {
      return {
        async getTenantData() {
          throw new Error("Veritabanı bağlantı zaman aşımı simülasyonu");
        }
      };
    }
    return {
      async getTenantData(id) {
        return { companyName: id, collections: { products: [{ id: `prod_${id}`, price: 10, tenantId: id }] } };
      }
    };
  });

  assert(batchResult.totalTenants === 3, "Toplam 3 tenant işlenmeli");
  assert(batchResult.successCount === 2, "Hatasız 2 tenant başarıyla tamamlanmalı");
  assert(batchResult.failureCount === 1, "Hata alan 1 tenant izole başarısız olmalı");
  assert(batchResult.results["tenant_batch_1"].status === "success", "Tenant 1 başarılı olmalı");
  assert(batchResult.results["tenant_batch_err"].status === "failed", "Tenant err başarısız olarak işaretlenmeli");
  assert(batchResult.results["tenant_batch_2"].status === "success", "Tenant 2, Tenant err'den etkilenmeden başarılı olmalı");

  // -------------------------------------------------------------------
  // TEST 8: 30 Günlük Saklama Süresi (Retention Policy) ve Min Yedek Koruma
  // -------------------------------------------------------------------
  console.log("\nTEST 8: Saklama Süresi (Retention Policy) ve Minimum Koruma Kuralı");
  const retentionTenant = "tenant_retention_demo";

  // Simulate 4 backups for retentionTenant: 2 old (40 and 35 days ago), 2 recent (10 and 2 days ago)
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Upload manually with custom dates via adapter
  await storageAdapter.uploadBackup(retentionTenant, "backup_old_40d.json", "dummy content 1");
  await storageAdapter.uploadBackup(retentionTenant, "backup_old_35d.json", "dummy content 2");
  await storageAdapter.uploadBackup(retentionTenant, "backup_recent_10d.json", "dummy content 3");
  await storageAdapter.uploadBackup(retentionTenant, "backup_recent_2d.json", "dummy content 4");

  // Manually backdate the first two items in storage adapter
  const allObjects = await storageAdapter.listBackups(retentionTenant);
  allObjects[3].createdAt = new Date(now - 40 * dayMs).toISOString();
  allObjects[2].createdAt = new Date(now - 35 * dayMs).toISOString();
  allObjects[1].createdAt = new Date(now - 10 * dayMs).toISOString();
  allObjects[0].createdAt = new Date(now - 2 * dayMs).toISOString();

  const retentionClean = await backupService.applyRetentionPolicy(retentionTenant, {
    retentionDays: 30,
    minBackupsToKeep: 2
  });

  assert(retentionClean.deletedCount === 2, "30 günü aşan 2 eski yedek silinmeli");
  assert(retentionClean.keptCount === 2, "Güncel 2 yedek korunmalı");

  const remaining = await storageAdapter.listBackups(retentionTenant);
  assert(remaining.length === 2, "Storage'da tam olarak 2 güncel yedek kalmalı");

  // -------------------------------------------------------------------
  // TEST 9: Yetkisiz Kullanıcının Başka Bir Tenant'a Ait Yedek Nesnesine Erişememesi
  // -------------------------------------------------------------------
  console.log("\nTEST 9: Çapraz Nesne İhlali Koruması (Cross-Tenant Object Access Denial)");
  let crossAccessCaught = false;
  try {
    // Tenant B attempts to fetch Tenant A's backup objectPath
    await backupService.fetchBackupArchiveForRestore(tenantB, jobMetaA.objectPath!);
  } catch (err: any) {
    if (err.message.includes("Güvenlik İhlali") || err.message.includes("yetkiniz bulunmamaktadır")) {
      crossAccessCaught = true;
    }
  }
  assert(crossAccessCaught, "Tenant B, Tenant A'ya ait bulut nesnesini indirememeli ve güvenlik hatası üretilmeli");

  // -------------------------------------------------------------------
  // TEST 10: Gerçek Google Cloud Storage Adaptörü (Mock Storage & Güvenlik Doğrulaması)
  // -------------------------------------------------------------------
  console.log("\nTEST 10: GoogleCloudStorageAdapter Yapılandırma ve Üretim Hata Koruması");

  // A. Üretim ortamında BACKUP_BUCKET yoksa sessiz fallback engellenmeli
  const prevEnv = process.env.NODE_ENV;
  const prevBucket = process.env.BACKUP_BUCKET;
  let prodErrorCaught = false;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.BACKUP_BUCKET;
    delete process.env.GCS_BACKUP_BUCKET;
    new GoogleCloudStorageAdapter({ bucketName: "" });
  } catch (err: any) {
    if (err.message.includes("BACKUP_BUCKET ortam değişkeni zorunludur")) {
      prodErrorCaught = true;
    }
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevBucket) process.env.BACKUP_BUCKET = prevBucket;
  }
  assert(prodErrorCaught, "Üretim modunda BACKUP_BUCKET olmadan sessizce belleğe düşme engellenmeli ve açık hata fırlatılmalı");

  // B. Mock Storage istemcisi ile GCS adaptörünün upload, download, list ve delete döngüsü
  const mockGcsFiles: Map<string, { content: string; metadata: any }> = new Map();
  const mockGcsClient: any = {
    bucket(bName: string) {
      return {
        file(filePath: string) {
          return {
            name: filePath,
            async save(content: string, options: any) {
              mockGcsFiles.set(filePath, {
                content,
                metadata: options?.metadata || {}
              });
            },
            async exists() {
              return [mockGcsFiles.has(filePath)];
            },
            async download() {
              const item = mockGcsFiles.get(filePath);
              if (!item) throw new Error("File not found");
              return [Buffer.from(item.content, "utf-8")];
            },
            async getMetadata() {
              const item = mockGcsFiles.get(filePath);
              return [{
                size: item ? item.content.length : 0,
                timeCreated: new Date().toISOString(),
                metadata: item?.metadata?.metadata || {}
              }];
            },
            async delete() {
              mockGcsFiles.delete(filePath);
            }
          };
        },
        async getFiles(opts: any) {
          const files: any[] = [];
          for (const [p, item] of mockGcsFiles.entries()) {
            if (p.startsWith(opts.prefix)) {
              files.push({
                name: p,
                getMetadata: async () => [{
                  size: item.content.length,
                  timeCreated: new Date().toISOString(),
                  metadata: item.metadata?.metadata || {}
                }]
              });
            }
          }
          return [files];
        }
      };
    }
  };

  const gcsAdapter = new GoogleCloudStorageAdapter({
    bucketName: "stokpro-production-secure-backups",
    storageInstance: mockGcsClient
  });

  assert(gcsAdapter.getBucketName() === "stokpro-production-secure-backups", "GCS adaptörü tanımlanan bucket adını doğru kullanmalı");

  const gcsUpload = await gcsAdapter.uploadBackup("tenant_gcs_test", "backup_gcs_01.json", '{"test": true}', {
    checksum: "sha256:abcd1234ef567890",
    schemaVersion: "2.1.0"
  });

  assert(gcsUpload.uri.startsWith("gs://stokpro-production-secure-backups/tenants/tenant_gcs_test/"), "GCS URI formatı gs:// standardına uygun olmalı");
  assert(mockGcsFiles.size === 1, "Mock Cloud Storage bucket'ına 1 adet nesne kaydedilmeli");

  const gcsDownloaded = await gcsAdapter.downloadBackup(gcsUpload.objectPath);
  assert(gcsDownloaded === '{"test": true}', "GCS adaptörü nesne içeriğini kayıpsız okuyabilmeli");

  const gcsList = await gcsAdapter.listBackups("tenant_gcs_test");
  assert(gcsList.length === 1, "GCS adaptörü tenant nesnelerini listelemeli");
  assert(gcsList[0].checksum === "sha256:abcd1234ef567890", "GCS metadata içindeki checksum eksiksiz korunmalı");

  await gcsAdapter.deleteBackup(gcsUpload.objectPath);
  assert(mockGcsFiles.size === 0, "GCS nesne silme işlemi başarıyla tamamlanmalı");

  // -------------------------------------------------------------------
  // TEST 11: Dağıtık Kilit Mekanizması (Distributed Lease & Concurrency Lock)
  // -------------------------------------------------------------------
  console.log("\nTEST 11: Dağıtık Kilit (Distributed Lease/Lock) ve Süresi Dolan Kilit Devralma");
  const lockMgr = new InMemoryLockManager();

  // 1. Lock acquisition
  const lock1 = await lockMgr.acquireLock("tenant_lock_lease", 500); // 500ms lease
  assert(lock1.acquired === true, "İlk kilit talebi başarıyla alınmalı");

  // 2. Immediate overlapping acquisition should be rejected
  const lock2 = await lockMgr.acquireLock("tenant_lock_lease", 500);
  assert(lock2.acquired === false, "Aktif kilit varken ikinci talep reddedilmeli");
  assert(Boolean(lock2.reason && lock2.reason.includes("aktif bir kilit")), "Kilit çakışma sebebi belirtilmeli");

  // 3. Wait for TTL lease to expire and verify safe takeover
  await new Promise(r => setTimeout(r, 550));
  const lock3 = await lockMgr.acquireLock("tenant_lock_lease", 500);
  assert(lock3.acquired === true, "Süresi dolan (expired lease) kilit güvenli biçimde devralınmalı");

  // 4. Release lock
  const released = await lockMgr.releaseLock("tenant_lock_lease", lock3.lockId);
  assert(released === true, "Kilit başarıyla serbest bırakılmalı");
  const isStillLocked = await lockMgr.isLocked("tenant_lock_lease");
  assert(isStillLocked === false, "Kilit serbest bırakıldıktan sonra durum false olmalı");

  // -------------------------------------------------------------------
  // TEST 12: Gerçek Firestore Koleksiyon Adı ('stock_movements') Entegrasyonu
  // -------------------------------------------------------------------
  console.log("\nTEST 12: Gerçek Firestore Koleksiyon Adı ('stock_movements') ve İzolasyon");
  const movementsProvider: TenantDataProvider = {
    async getTenantData(tId: string) {
      return {
        companyName: "Lojistik A.Ş.",
        collections: {
          products: [{ id: "pr_mov_1", name: "Koli Bandı", price: 50, tenantId: tId }],
          // Providing actual Firestore collection name: stock_movements
          stock_movements: [
            { id: "sm_01", type: "in", quantity: 100, tenantId: tId },
            { id: "sm_02", type: "out", quantity: 30, tenantId: tId },
            // Foreign record that must be pruned by tenant isolation
            { id: "sm_foreign", type: "in", quantity: 999, tenantId: "other_tenant" }
          ]
        }
      };
    }
  };

  const movementsJob = await backupService.executeTenantBackup("tenant_mov_test", movementsProvider);
  assert(movementsJob.status === "success", "stock_movements koleksiyonuyla yedekleme başarılı olmalı");
  assert(movementsJob.itemCounts?.stockMovements === 2, "Yabancı tenant kaydı elenmeli ve sadece 2 geçerli hareket yedeklenmeli");

  const movArchive = await backupService.fetchBackupArchiveForRestore("tenant_mov_test", movementsJob.objectPath!);
  assert(movArchive.data.stockMovements.length === 2, "Arşivdeki stockMovements anahtarı tam 2 kayıt içermeli");
  assert(movArchive.data.stockMovements.every(m => m.tenantId === "tenant_mov_test"), "Tüm stok hareketlerinin tenantId'si doğrulanmalı");

  // -------------------------------------------------------------------
  // TEST 13: Cron Uç Noktası Yetkilendirme & Idempotency Güvenliği
  // -------------------------------------------------------------------
  console.log("\nTEST 13: Zamanlanmış Cron Yetkilendirme ve Idempotency Kontrolü");
  const cronRunner = new ScheduledBackupRunner(backupService);

  // 1. Missing auth
  const unauthorizedCheck = cronRunner.verifyCronAuthorization({});
  assert(unauthorizedCheck.authorized === false, "Kimlik bilgisi eksik cron talebi reddedilmeli");

  // 2. Invalid token
  const wrongTokenCheck = cronRunner.verifyCronAuthorization({ authorization: "Bearer invalid_secret_123" });
  assert(wrongTokenCheck.authorized === false, "Geçersiz secret içeren cron talebi reddedilmeli");

  // 3. Valid secret (dev-internal-cron-secret)
  const validCheck = cronRunner.verifyCronAuthorization({ authorization: "Bearer dev-internal-cron-secret" });
  assert(validCheck.authorized === true, "Doğru cron secret ile erişim onaylanmalı");

  // 4. Idempotency run check
  cronRunner.resetDailyGuardForTesting();
  const runReport1 = await cronRunner.runScheduledCycle({
    tenants: ["tenant_cron_1"],
    dataProviderFactory: () => ({
      getTenantData: async (id) => ({ companyName: id, collections: { products: [] } })
    })
  });
  assert(runReport1.status === "completed", "İlk cron döngüsü 'completed' olmalı");

  // Second run on same day without force -> skipped
  const runReport2 = await cronRunner.runScheduledCycle({
    tenants: ["tenant_cron_1"]
  });
  assert(runReport2.status === "skipped_already_run_today", "Aynı gün içinde ikinci çağrı mükerrer çalışmayı önlemek için atlanmalı (Idempotent)");

  // Run with force=true -> allowed
  const runReport3 = await cronRunner.runScheduledCycle({
    tenants: ["tenant_cron_1"],
    force: true,
    dataProviderFactory: () => ({
      getTenantData: async (id) => ({ companyName: id, collections: { products: [] } })
    })
  });
  assert(runReport3.status === "completed", "'force: true' ile çağrıldığında yeniden çalışma onaylanmalı");

  // -------------------------------------------------------------------
  // TEST 14: Server-Side Tenant Yetkilendirme Guard'ı (verifyServerTenantAuth)
  // -------------------------------------------------------------------
  console.log("\nTEST 14: Server-Side Tenant Yetkilendirme ve Çapraz İşletme Engeli");

  // Missing header
  const noHeaderAuth = await verifyServerTenantAuth(undefined, "tenant_alpha_ltd");
  assert(noHeaderAuth.authorized === false && noHeaderAuth.statusCode === 401, "Auth başlığı yoksa 401 Unauthorized dönmeli");

  // Tenant Alpha admin accessing Tenant Alpha -> Success
  const alphaOkAuth = await verifyServerTenantAuth("Bearer test_token_tenant_alpha_admin", "tenant_alpha_ltd");
  assert(alphaOkAuth.authorized === true, "Tenant Alpha admin kendi işletmesine erişebilmeli");

  // Tenant Alpha admin accessing Tenant Beta -> 403 Forbidden (Cross-tenant violation)
  const crossTenantAuth = await verifyServerTenantAuth("Bearer test_token_tenant_alpha_admin", "tenant_beta_as");
  assert(crossTenantAuth.authorized === false && crossTenantAuth.statusCode === 403, "Başka bir firmanın tenantId'sine erişim 403 ile engellenmeli");

  // Tenant Alpha staff role attempting backup -> 403 Forbidden (Role restriction)
  const staffAuth = await verifyServerTenantAuth("Bearer test_token_tenant_alpha_staff", "tenant_alpha_ltd", {
    requiredRole: ["owner", "admin"]
  });
  assert(staffAuth.authorized === false && staffAuth.statusCode === 403, "Yönetici olmayan (staff/cashier) kullanıcıların yedekleme erişimi 403 ile engellenmeli");

  // -------------------------------------------------------------------
  // TEST 15: Dağıtılabilir Firebase Functions 2nd Gen Doğrulaması
  // -------------------------------------------------------------------
  console.log("\nTEST 15: Dağıtılabilir Firebase Functions 2nd Gen Giriş Noktası Doğrulaması");
  const functionsDistPath = path.join(process.cwd(), "functions", "lib", "index.js");
  const functionsDistExists = fs.existsSync(functionsDistPath);
  assert(functionsDistExists, "functions/lib/index.js derlenmiş JavaScript dosyası mevcut olmalı");

  if (functionsDistExists) {
    const functionsCode = fs.readFileSync(functionsDistPath, "utf-8");
    assert(functionsCode.includes("scheduledTenantDailyBackup"), "functions/lib/index.js 'scheduledTenantDailyBackup' fonksiyonunu dışa aktarmalı");
    assert(functionsCode.includes("0 2 * * *"), "Fonksiyon zamanlaması '0 2 * * *' (02:00) olmalı");
    assert(functionsCode.includes("Europe/Istanbul"), "Zaman dilimi 'Europe/Istanbul' olmalı");

    // Verify no hazardous external relative imports like require("../../src/...") exist in distribution
    const hasExternalSrcRequire = functionsCode.includes('require("../../src') || functionsCode.includes('require("../src');
    assert(hasExternalSrcRequire === false, "functions/lib/index.js dağıtım paketi dışındaki '../src' yollarına bağımlı olmamalı (Tamamen self-contained)");

    // Isolated runtime require smoke test
    let smokeExported = false;
    try {
      delete cjsRequire.cache[cjsRequire.resolve(functionsDistPath)];
      const importedModule = cjsRequire(functionsDistPath);
      smokeExported = typeof importedModule.scheduledTenantDailyBackup === "function" || Boolean(importedModule.scheduledTenantDailyBackup);
    } catch (e: any) {
      console.error("Functions smoke test error:", e);
    }
    assert(smokeExported, "functions/lib/index.js modülü Node.js çalışma zamanında hatasız import/require edilebilmeli (Smoke Test)");

    // Verify Node.js 22 runtime configuration
    const functionsPkgPath = path.join(process.cwd(), "functions", "package.json");
    const functionsPkg = JSON.parse(fs.readFileSync(functionsPkgPath, "utf-8"));
    assert(functionsPkg.engines?.node === "22", "functions/package.json içinde engines.node değeri '22' olmalı (Node.js 22 LTS Runtime)");

    const functionsTsconfigPath = path.join(process.cwd(), "functions", "tsconfig.json");
    const functionsTsconfig = JSON.parse(fs.readFileSync(functionsTsconfigPath, "utf-8"));
    assert(functionsTsconfig.compilerOptions?.target === "es2022", "functions/tsconfig.json içinde target değeri 'es2022' olmalı (Node.js 22 uyumlu)");
  }

  console.log("\n=====================================================================");
  console.log(`SONUÇ: ${passedCount} Başarılı, ${failedCount} Başarısız`);
  console.log("=====================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runCloudBackupTests().catch(err => {
  console.error("Test yürütülürken beklenmeyen hata:", err);
  process.exit(1);
});
