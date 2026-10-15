/**
 * Firebase Functions (2nd Gen) Scheduled Cloud Backup
 * 
 * Deployment Specifications:
 * - Runtime: Node.js 20+
 * - Schedule: Every day at 02:00 Europe/Istanbul ("0 2 * * *")
 * - Timezone: Europe/Istanbul
 * - Memory: 512MiB
 * - Timeout: 300s (5 minutes)
 * - Retries: 1 automatic retry on transient infrastructure error
 * 
 * Security:
 * - Runs with Cloud Functions service account credentials (Application Default Credentials).
 * - Enforces multi-tenant isolation across all Firestore collections.
 * - Concurrency protected via distributed Firestore lease lock.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { CloudBackupService } from "../lib/backup/CloudBackupService";
import { GoogleCloudStorageAdapter } from "../lib/backup/CloudStorageAdapter";
import { FirestoreBackupLockManager } from "../lib/backup/BackupLockManager";

export const scheduledTenantDailyBackup = onSchedule({
  schedule: "0 2 * * *",
  timeZone: "Europe/Istanbul",
  memory: "512MiB",
  timeoutSeconds: 300,
  retryCount: 1
}, async () => {
  console.log(`[ScheduledBackup] Günlük otomatik yedekleme başlatıldı: ${new Date().toISOString()}`);

  if (!getApps().length) {
    initializeApp();
  }

  const db = getFirestore();
  const bucketName = process.env.BACKUP_BUCKET || process.env.GCS_BACKUP_BUCKET || "stokpro-private-backups";

  // Production-grade Cloud Storage Adapter & Distributed Lock
  const gcsAdapter = new GoogleCloudStorageAdapter({ bucketName });
  const lockManager = new FirestoreBackupLockManager();
  const backupService = new CloudBackupService(gcsAdapter, { bucketName }, lockManager);

  // 1. Discover all active tenants
  const tenantsSnap = await db.collection("tenants").get();
  const activeTenants = tenantsSnap.docs.map((doc: any) => doc.id);

  console.log(`[ScheduledBackup] Yedekleme yapılacak toplam aktif işletme sayısı: ${activeTenants.length}`);

  if (activeTenants.length === 0) {
    console.log("[ScheduledBackup] Yedeklenecek aktif işletme bulunamadı.");
    return;
  }

  // 2. Execute scheduled backup with strict per-tenant fault isolation
  const summary = await backupService.executeScheduledBackupForAllTenants(
    activeTenants,
    (tenantId) => ({
      async getTenantData(tId) {
        const collections: Record<string, any[]> = {};
        const targetCollections = [
          "products",
          "customers",
          "suppliers",
          "sales",
          "warehouses",
          "orders",
          "payments",
          "stock_movements"
        ];

        for (const coll of targetCollections) {
          const snap = await db.collection(coll).where("tenantId", "==", tId).get();
          collections[coll] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        }

        const tenantDoc = await db.collection("tenants").doc(tId).get();
        return {
          companyName: tenantDoc.exists ? tenantDoc.data()?.name : `İşletme (${tId})`,
          collections
        };
      }
    })
  );

  console.log(`[ScheduledBackup] Tamamlandı: ${summary.successCount}/${summary.totalTenants} başarılı, ${summary.failureCount} başarısız.`);
});
