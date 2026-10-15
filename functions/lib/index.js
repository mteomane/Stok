"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledTenantDailyBackup = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const storage_1 = require("@google-cloud/storage");
const crypto = __importStar(require("crypto"));
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
const db = (0, firestore_1.getFirestore)();
const storage = new storage_1.Storage();
/**
 * Calculates deterministic canonical SHA-256 checksum matching StokPro Restore Engine
 */
function calculateBackupChecksum(archive) {
    // Normalize metadata for checksum calculation (checksum field itself must be empty)
    const metaForHash = { ...archive.metadata, checksum: "" };
    const normalizedArchive = { metadata: metaForHash, data: archive.data };
    const rawString = JSON.stringify(normalizedArchive);
    const hashHex = crypto.createHash("sha256").update(rawString, "utf8").digest("hex");
    return `sha256:${hashHex}`;
}
/**
 * Scheduled Daily Tenant Backup Function (Firebase Functions 2nd Gen)
 *
 * Schedule: 02:00 every night (Europe/Istanbul)
 * Memory: 512MiB
 * Timeout: 300s (5 minutes)
 * Retries: 1 automatic retry
 * Secrets: BACKUP_CRON_SECRET (mounted from Google Cloud Secret Manager if present)
 */
exports.scheduledTenantDailyBackup = (0, scheduler_1.onSchedule)({
    schedule: "0 2 * * *",
    timeZone: "Europe/Istanbul",
    memory: "512MiB",
    timeoutSeconds: 300,
    retryCount: 1,
    secrets: ["BACKUP_CRON_SECRET"]
}, async () => {
    console.log(`[Firebase Functions v2] Starting daily tenant backup job at: ${new Date().toISOString()}`);
    const bucketName = process.env.BACKUP_BUCKET || "stokpro-private-backups";
    const tenantsSnap = await db.collection("tenants").get();
    const activeTenants = tenantsSnap.docs.map((doc) => doc.id);
    console.log(`[Firebase Functions v2] Found ${activeTenants.length} tenants for backup.`);
    let successCount = 0;
    let failureCount = 0;
    for (const tenantId of activeTenants) {
        const lockRef = db.collection("backup_locks").doc(tenantId);
        const lockId = `lock_${tenantId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        let lockAcquired = false;
        try {
            console.log(`[Firebase Functions v2] Processing backup for tenant: ${tenantId}`);
            // 1. Acquire Distributed Lease Lock via Firestore Transaction (15 min TTL)
            const now = Date.now();
            const ttlMs = 15 * 60 * 1000;
            const expiresAt = now + ttlMs;
            lockAcquired = await db.runTransaction(async (transaction) => {
                const snap = await transaction.get(lockRef);
                if (snap.exists) {
                    const data = snap.data();
                    if (Number(data?.expiresAt || 0) > now) {
                        return false; // Active lock exists
                    }
                }
                transaction.set(lockRef, {
                    lockId,
                    tenantId,
                    acquiredAt: new Date(now).toISOString(),
                    expiresAt,
                    ownerInstance: "firebase-function-scheduled"
                });
                return true;
            });
            if (!lockAcquired) {
                console.warn(`[Firebase Functions v2] Tenant ${tenantId} has an active running backup. Skipping.`);
                continue;
            }
            // 2. Fetch business collections with strict tenant isolation
            const collections = {};
            const targets = [
                "products",
                "customers",
                "suppliers",
                "sales",
                "warehouses",
                "orders",
                "payments",
                "stock_movements"
            ];
            let totalRecords = 0;
            const itemCounts = {};
            for (const coll of targets) {
                const snap = await db.collection(coll).where("tenantId", "==", tenantId).get();
                const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                collections[coll] = items;
                itemCounts[coll] = items.length;
                totalRecords += items.length;
            }
            const date = new Date();
            const year = date.getUTCFullYear();
            const month = String(date.getUTCMonth() + 1).padStart(2, "0");
            const backupId = `bk_${tenantId}_${date.toISOString().replace(/[:.]/g, "-")}`;
            const fileName = `${backupId}.json`;
            const objectPath = `tenants/${tenantId}/backups/${year}/${month}/${fileName}`;
            // Build canonical archive structure
            const archive = {
                metadata: {
                    schemaVersion: "2.1.0",
                    tenantId,
                    userId: "system_cloud_functions_v2",
                    companyName: `Tenant ${tenantId}`,
                    exportedAt: date.toISOString(),
                    appVersion: "StokPro-SaaS-2.1",
                    checksum: "",
                    itemCounts
                },
                data: collections
            };
            // Compute cryptographic SHA-256 checksum
            archive.metadata.checksum = calculateBackupChecksum(archive);
            const payload = JSON.stringify(archive, null, 2);
            const sizeBytes = Buffer.byteLength(payload, "utf-8");
            // 3. Upload to Private Google Cloud Storage with atomic overwrite protection
            const file = storage.bucket(bucketName).file(objectPath);
            await file.save(payload, {
                contentType: "application/json",
                metadata: {
                    contentType: "application/json",
                    metadata: {
                        tenantId,
                        checksum: archive.metadata.checksum,
                        schemaVersion: "2.1.0",
                        createdAt: date.toISOString()
                    }
                },
                preconditionOpts: { ifGenerationMatch: 0 }
            });
            // 4. Record Audit Log in backup_metadata
            const metaId = `bkm_${tenantId}_${Date.now()}`;
            await db.collection("backup_metadata").doc(metaId).set({
                id: metaId,
                tenantId,
                backupId,
                status: "success",
                startedAt: date.toISOString(),
                completedAt: new Date().toISOString(),
                schemaVersion: "2.1.0",
                appVersion: "StokPro-SaaS-2.1",
                objectPath,
                sizeBytes,
                itemCounts,
                totalRecords,
                checksum: archive.metadata.checksum,
                checksumVerified: true,
                frequency: "daily",
                retentionDays: 30,
                initiatedBy: "scheduler"
            });
            // 5. Apply Retention Policy: 30 days retention with guaranteed minimum 3 backups
            const [files] = await storage.bucket(bucketName).getFiles({
                prefix: `tenants/${tenantId}/backups/`
            });
            if (files.length > 3) {
                const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
                // Sort newest first
                files.sort((a, b) => {
                    const timeA = new Date(a.metadata?.timeCreated || 0).getTime();
                    const timeB = new Date(b.metadata?.timeCreated || 0).getTime();
                    return timeB - timeA;
                });
                // Always preserve first 3 backups regardless of age
                for (let i = 3; i < files.length; i++) {
                    const f = files[i];
                    const fileTime = new Date(f.metadata?.timeCreated || 0).getTime();
                    if (fileTime < cutoff) {
                        await f.delete({ ignoreNotFound: true });
                    }
                }
            }
            successCount++;
        }
        catch (err) {
            console.error(`[Firebase Functions v2] Error backing up tenant ${tenantId}:`, err);
            failureCount++;
            // Record failure audit log
            try {
                const errId = `bkm_${tenantId}_err_${Date.now()}`;
                await db.collection("backup_metadata").doc(errId).set({
                    id: errId,
                    tenantId,
                    status: "failed",
                    error: err.message || "Bilinmeyen yedekleme hatası",
                    completedAt: new Date().toISOString(),
                    initiatedBy: "scheduler"
                });
            }
            catch {
                // ignore audit logging failure
            }
        }
        finally {
            // Release distributed lease lock
            if (lockAcquired) {
                try {
                    await lockRef.delete();
                }
                catch (e) {
                    console.warn(`[Firebase Functions v2] Could not delete lock for ${tenantId}:`, e);
                }
            }
        }
    }
    console.log(`[Firebase Functions v2] Finished: ${successCount} succeeded, ${failureCount} failed.`);
});
//# sourceMappingURL=index.js.map