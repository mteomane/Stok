/**
 * Firebase Functions (2nd Gen) Scheduled Backup Reference
 * 
 * Deployment Trigger:
 * Runtime: Node.js 20+
 * Schedule: Every day at 02:00 AM Europe/Istanbul (cron: "0 2 * * *")
 * Security: Runs in isolated VPC/Cloud environment with dedicated service account.
 */

export const SCHEDULED_BACKUP_FUNCTION_CODE = `
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { CloudBackupService } from "./lib/backup/CloudBackupService";
import { Storage } from "@google-cloud/storage";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const storage = new Storage();
const BUCKET_NAME = process.env.BACKUP_BUCKET_NAME || "stokpro-private-backups";

export const scheduledTenantDailyBackup = onSchedule({
  schedule: "0 2 * * *",
  timeZone: "Europe/Istanbul",
  memory: "512MiB",
  timeoutSeconds: 300,
  retryCount: 1,
}, async (event) => {
  console.log("Starting scheduled daily tenant backup job at:", new Date().toISOString());

  // 1. Fetch active tenants
  const tenantsSnap = await db.collection("tenants").get();
  const activeTenants = tenantsSnap.docs.map(d => d.id);

  console.log(\`Found \${activeTenants.length} tenants for backup.\`);

  // 2. Setup GCS Adapter
  const gcsAdapter = {
    async uploadBackup(tenantId, fileName, content, metadata) {
      const bucket = storage.bucket(BUCKET_NAME);
      const year = new Date().getUTCFullYear();
      const month = String(new Date().getUTCMonth() + 1).padStart(2, "0");
      const objectPath = \`tenants/\${tenantId}/backups/\${year}/\${month}/\${fileName}\`;
      const file = bucket.file(objectPath);
      
      await file.save(content, {
        metadata: {
          contentType: "application/json",
          metadata: metadata || {}
        },
        private: true
      });

      return {
        objectPath,
        sizeBytes: Buffer.byteLength(content, "utf-8"),
        uri: \`gs://\${BUCKET_NAME}/\${objectPath}\`
      };
    },
    async downloadBackup(objectPath) {
      const file = storage.bucket(BUCKET_NAME).file(objectPath);
      const [buf] = await file.download();
      return buf.toString("utf-8");
    },
    async listBackups(tenantId) {
      const [files] = await storage.bucket(BUCKET_NAME).getFiles({
        prefix: \`tenants/\${tenantId}/backups/\`
      });
      return files.map(f => ({
        objectPath: f.name,
        tenantId,
        sizeBytes: Number(f.metadata.size || 0),
        createdAt: f.metadata.timeCreated || new Date().toISOString()
      }));
    },
    async deleteBackup(objectPath) {
      await storage.bucket(BUCKET_NAME).file(objectPath).delete();
      return true;
    }
  };

  const backupService = new CloudBackupService(gcsAdapter);

  // 3. Execute backup with total tenant isolation
  const summary = await backupService.executeScheduledBackupForAllTenants(
    activeTenants,
    (tenantId) => ({
      async getTenantData(tId) {
        // Query Firestore with strict tenantId filter
        const collections = {};
        const allowed = ["products", "customers", "suppliers", "sales", "warehouses", "orders", "payments", "stockMovements"];
        
        for (const coll of allowed) {
          const snap = await db.collection(coll).where("tenantId", "==", tId).get();
          collections[coll] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        const tenantDoc = await db.collection("tenants").doc(tId).get();
        return {
          companyName: tenantDoc.exists ? tenantDoc.data()?.name : "İşletme",
          collections
        };
      }
    })
  );

  console.log("Backup summary:", JSON.stringify(summary));
  return summary;
});
`;
