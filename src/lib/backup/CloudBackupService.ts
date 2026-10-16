import { TenantBackupArchive, TenantBackupMetadata } from "../export/types";
import { calculateBackupChecksum, verifyBackupChecksum } from "../export/backupCrypto";
import { sanitizeRecord, enforceTenantIsolation } from "../export/sanitizer";
import { 
  BackupJobMetadata, 
  BackupJobStatus, 
  ICloudStorageAdapter, 
  RetentionPolicy, 
  CloudBackupConfig 
} from "./types";
import { InMemoryCloudStorageAdapter, createDefaultStorageAdapter } from "./CloudStorageAdapter";
import { IBackupLockManager, InMemoryLockManager } from "./BackupLockManager";

/**
 * Strict allowlist of business domains permitted in application-level tenant backups.
 * System collections (users, tenants, subscriptions, webhook_events, settings) are strictly FORBIDDEN.
 */
export const ALLOWED_BACKUP_COLLECTIONS = [
  "products",
  "customers",
  "suppliers",
  "sales",
  "warehouses",
  "orders",
  "payments",
  "stockMovements",
  "stock_movements"
] as const;

export const FORBIDDEN_COLLECTIONS = new Set([
  "users",
  "tenants",
  "subscriptions",
  "webhook_events",
  "audit_logs",
  "settings",
  "company",
  "secrets"
]);

export interface TenantDataProvider {
  getTenantData(tenantId: string): Promise<{
    companyName?: string;
    collections: Record<string, any[]>;
  }>;
}

export const DEFAULT_BACKUP_CONFIG: CloudBackupConfig = {
  bucketName: "stokpro-private-backups",
  retentionDays: 30,
  minBackupsToKeep: 3,
  cronSchedule: "0 2 * * *", // 02:00 every night (Europe/Istanbul)
  timeZone: "Europe/Istanbul",
  maxRetries: 3,
  timeoutMs: 120000 // 2 minutes
};

/**
 * Server-Side Automatic Cloud Backup Service
 */
export class CloudBackupService {
  private storageAdapter: ICloudStorageAdapter;
  private lockManager: IBackupLockManager;
  private config: CloudBackupConfig;
  private activeJobs: Set<string> = new Set(); // Local guard
  private metadataStore: Map<string, BackupJobMetadata> = new Map(); // In-memory metadata / syncable to Firestore

  constructor(
    storageAdapter?: ICloudStorageAdapter,
    config: Partial<CloudBackupConfig> = {},
    lockManager?: IBackupLockManager
  ) {
    this.storageAdapter = storageAdapter || createDefaultStorageAdapter();
    this.config = { ...DEFAULT_BACKUP_CONFIG, ...config };
    this.lockManager = lockManager || new InMemoryLockManager();
  }

  setStorageAdapter(adapter: ICloudStorageAdapter): void {
    this.storageAdapter = adapter;
  }

  setLockManager(manager: IBackupLockManager): void {
    this.lockManager = manager;
  }

  getLockManager(): IBackupLockManager {
    return this.lockManager;
  }

  /**
   * Executes an automatic backup for a specific tenant with full error isolation and audit tracking.
   */
  async executeTenantBackup(
    tenantId: string,
    dataProvider: TenantDataProvider,
    options: {
      initiatedBy?: "scheduler" | "manual_admin" | "system_retry";
      frequency?: "daily" | "weekly" | "manual";
      testSimulateFailure?: boolean; // For controlled testing
    } = {}
  ): Promise<BackupJobMetadata> {
    if (!tenantId || !tenantId.trim()) {
      throw new Error("Geçersiz tenantId: Boş olamaz.");
    }

    // 1. Concurrency Lock: Prevent multiple overlapping backup jobs across distributed instances
    const lockResult = await this.lockManager.acquireLock(tenantId, this.config.timeoutMs);
    if (!lockResult.acquired) {
      throw new Error(`Zaten devam eden bir yedekleme işi bulunuyor (Tenant: ${tenantId}). Çakışmayı önlemek için yeni iş başlatılmadı. ${lockResult.reason || ""}`.trim());
    }

    if (this.activeJobs.has(tenantId)) {
      await this.lockManager.releaseLock(tenantId, lockResult.lockId);
      throw new Error(`Zaten devam eden bir yedekleme işi bulunuyor (Tenant: ${tenantId}). Çakışmayı önlemek için yeni iş başlatılmadı.`);
    }

    const timestamp = Date.now();
    const backupId = `bk_${tenantId}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const jobId = `bkm_${tenantId}_${timestamp}`;
    const startedAt = new Date().toISOString();
    const expiresAt = new Date(timestamp + this.config.retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const jobMeta: BackupJobMetadata = {
      id: jobId,
      tenantId,
      backupId,
      status: "pending",
      startedAt,
      schemaVersion: "2.1.0",
      appVersion: "StokPro-SaaS-2.1",
      frequency: options.frequency || "daily",
      retentionDays: this.config.retentionDays,
      expiresAt,
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      initiatedBy: options.initiatedBy || "scheduler"
    };

    this.metadataStore.set(jobId, jobMeta);
    this.activeJobs.add(tenantId);

    try {
      jobMeta.status = "running";

      // Simulate controlled failure if requested in test mode
      if (options.testSimulateFailure) {
        throw new Error("Simüle edilen kontrollü bulut yedekleme depolama hatası (Test)");
      }

      // Security & Persistence Guard: In production, reject InMemory storage to prevent silent fallback
      if (
        process.env.NODE_ENV === "production" &&
        this.storageAdapter instanceof InMemoryCloudStorageAdapter &&
        process.env.ALLOW_IN_MEMORY_BACKUP_TEST !== "true"
      ) {
        throw new Error(
          "Kritik Yapılandırma Hatası: Üretim ortamında gerçek bulut depolama (BACKUP_BUCKET) zorunludur. Bellek içi depolamaya (in-memory) sessiz geri dönüş engellenmiştir."
        );
      }

      // 2. Fetch tenant business data from provider
      const tenantData = await dataProvider.getTenantData(tenantId);

      // 3. Security Guard: Check that no forbidden collections are included
      for (const collName of Object.keys(tenantData.collections)) {
        if (FORBIDDEN_COLLECTIONS.has(collName.toLowerCase())) {
          throw new Error(`Güvenlik İhlali: Yasaklı koleksiyon ('${collName}') yedek kapsamına alınamaz.`);
        }
      }

      // 4. Filter only allowed collections and enforce tenant isolation
      // Resolves both Firestore collection name 'stock_movements' and camelCase 'stockMovements'
      const rawCollections = tenantData.collections;
      const rawMovements = rawCollections.stock_movements || rawCollections.stockMovements || [];

      const filteredData: TenantBackupArchive["data"] = {
        products: enforceTenantIsolation(rawCollections.products || [], tenantId, tenantId),
        customers: enforceTenantIsolation(rawCollections.customers || [], tenantId, tenantId),
        suppliers: enforceTenantIsolation(rawCollections.suppliers || [], tenantId, tenantId),
        sales: enforceTenantIsolation(rawCollections.sales || [], tenantId, tenantId),
        warehouses: enforceTenantIsolation(rawCollections.warehouses || [], tenantId, tenantId),
        orders: enforceTenantIsolation(rawCollections.orders || [], tenantId, tenantId),
        payments: enforceTenantIsolation(rawCollections.payments || [], tenantId, tenantId),
        stockMovements: enforceTenantIsolation(rawMovements, tenantId, tenantId)
      };

      const itemCounts = {
        products: filteredData.products.length,
        customers: filteredData.customers.length,
        suppliers: filteredData.suppliers.length,
        sales: filteredData.sales.length,
        warehouses: filteredData.warehouses.length,
        orders: filteredData.orders.length,
        payments: filteredData.payments.length,
        stockMovements: filteredData.stockMovements.length
      };

      const totalRecords = Object.values(itemCounts).reduce((a, b) => a + b, 0);

      const metadata: TenantBackupMetadata = {
        schemaVersion: "2.1.0",
        tenantId,
        userId: "system_cloud_backup",
        companyName: tenantData.companyName || "İşletme",
        exportedAt: startedAt,
        appVersion: "StokPro-SaaS-2.1",
        checksum: "",
        itemCounts
      };

      // 5. Calculate real SHA-256 cryptographic checksum matching Restore Engine
      const archive: TenantBackupArchive = { metadata, data: filteredData };
      metadata.checksum = await calculateBackupChecksum(archive);

      // Verify checksum immediately before upload
      const selfVerify = await verifyBackupChecksum(archive);
      if (!selfVerify.valid) {
        throw new Error(`Yedek bütünlük doğrulaması başarısız: ${selfVerify.reason}`);
      }

      // 6. Serialize and Upload to Cloud Storage
      const serialized = JSON.stringify(archive, null, 2);
      const fileName = `${backupId}.json`;
      const uploadResult = await this.storageAdapter.uploadBackup(tenantId, fileName, serialized, {
        checksum: metadata.checksum,
        tenantId,
        schemaVersion: "2.1.0"
      });

      // 7. Verify uploaded object read-back
      const downloaded = await this.storageAdapter.downloadBackup(uploadResult.objectPath);
      if (!downloaded || downloaded.length !== serialized.length) {
        throw new Error("Yüklenen bulut yedek dosyası okunamadı veya boyut uyuşmazlığı tespit edildi.");
      }

      // 8. Mark Success
      jobMeta.status = "success";
      jobMeta.completedAt = new Date().toISOString();
      jobMeta.objectPath = uploadResult.objectPath;
      jobMeta.sizeBytes = uploadResult.sizeBytes;
      jobMeta.itemCounts = itemCounts;
      jobMeta.totalRecords = totalRecords;
      jobMeta.checksum = metadata.checksum;
      jobMeta.checksumVerified = true;

      // 9. Apply retention cleanup
      await this.applyRetentionPolicy(tenantId);

      return { ...jobMeta };
    } catch (err: any) {
      // Never mark success on failure!
      jobMeta.status = "failed";
      jobMeta.completedAt = new Date().toISOString();
      jobMeta.error = err.message || "Bilinmeyen yedekleme hatası";
      jobMeta.errorCode = err.code || "BACKUP_EXECUTION_FAILED";
      return { ...jobMeta };
    } finally {
      await this.lockManager.releaseLock(tenantId, lockResult.lockId);
      this.activeJobs.delete(tenantId);
    }
  }

  /**
   * Batch execution for all active tenants with total fault isolation:
   * A failure in one tenant does NOT interrupt or fail backups for other tenants.
   */
  async executeScheduledBackupForAllTenants(
    tenantIds: string[],
    dataProviderFactory: (tId: string) => TenantDataProvider
  ): Promise<{
    totalTenants: number;
    successCount: number;
    failureCount: number;
    results: Record<string, BackupJobMetadata>;
  }> {
    const results: Record<string, BackupJobMetadata> = {};
    let successCount = 0;
    let failureCount = 0;

    for (const tenantId of tenantIds) {
      try {
        const provider = dataProviderFactory(tenantId);
        const meta = await this.executeTenantBackup(tenantId, provider, {
          initiatedBy: "scheduler",
          frequency: "daily"
        });
        results[tenantId] = meta;
        if (meta.status === "success") {
          successCount++;
        } else {
          failureCount++;
        }
      } catch (err: any) {
        failureCount++;
        results[tenantId] = {
          id: `bkm_${tenantId}_err_${Date.now()}`,
          tenantId,
          backupId: "unassigned",
          status: "failed",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          schemaVersion: "2.1.0",
          appVersion: "StokPro-SaaS-2.1",
          frequency: "daily",
          retentionDays: this.config.retentionDays,
          expiresAt: new Date().toISOString(),
          error: err.message,
          retryCount: 0,
          maxRetries: this.config.maxRetries,
          initiatedBy: "scheduler"
        };
      }
    }

    return {
      totalTenants: tenantIds.length,
      successCount,
      failureCount,
      results
    };
  }

  /**
   * Applies the retention policy: Deletes backups older than retentionDays (e.g. 30 days)
   * while always guaranteeing at least minBackupsToKeep (default 3) remain for disaster recovery.
   */
  async applyRetentionPolicy(
    tenantId: string,
    customPolicy?: Partial<RetentionPolicy>
  ): Promise<{ deletedCount: number; keptCount: number }> {
    const policy: RetentionPolicy = {
      retentionDays: customPolicy?.retentionDays ?? this.config.retentionDays,
      minBackupsToKeep: customPolicy?.minBackupsToKeep ?? this.config.minBackupsToKeep
    };

    const backups = await this.storageAdapter.listBackups(tenantId);
    if (backups.length <= policy.minBackupsToKeep) {
      return { deletedCount: 0, keptCount: backups.length };
    }

    const cutoffTime = Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000;
    let deletedCount = 0;
    let keptCount = 0;

    // Backups are sorted newest first. Always keep the first policy.minBackupsToKeep items
    for (let i = 0; i < backups.length; i++) {
      const b = backups[i];
      if (i < policy.minBackupsToKeep) {
        keptCount++;
        continue;
      }

      const backupTime = new Date(b.createdAt).getTime();
      if (backupTime < cutoffTime) {
        await this.storageAdapter.deleteBackup(b.objectPath);
        deletedCount++;
      } else {
        keptCount++;
      }
    }

    return { deletedCount, keptCount };
  }

  /**
   * Retrieves the latest backup metadata and history for a given tenant.
   * Guarantees tenant isolation: can only query metadata matching requested tenantId.
   */
  async getTenantBackupHistory(tenantId: string): Promise<BackupJobMetadata[]> {
    const list: BackupJobMetadata[] = [];
    for (const meta of this.metadataStore.values()) {
      if (meta.tenantId === tenantId) {
        list.push({ ...meta });
      }
    }
    return list.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  /**
   * Downloads and validates an archive from cloud storage for restore preparation.
   */
  async fetchBackupArchiveForRestore(tenantId: string, objectPath: string): Promise<TenantBackupArchive> {
    // Path traversal / cross-tenant check
    if (!objectPath.includes(`tenants/${tenantId}/`)) {
      throw new Error(`Güvenlik İhlali: Bu yedek nesnesine erişim yetkiniz bulunmamaktadır (Tenant: ${tenantId}).`);
    }

    const rawJson = await this.storageAdapter.downloadBackup(objectPath);
    const archive = JSON.parse(rawJson) as TenantBackupArchive;

    if (archive.metadata.tenantId !== tenantId) {
      throw new Error(`Bütünlük İhlali: Arşiv içindeki tenantId (${archive.metadata.tenantId}) ile talep eden (${tenantId}) uyuşmuyor.`);
    }

    const verify = await verifyBackupChecksum(archive);
    if (!verify.valid) {
      throw new Error(`Arşiv bütünlük doğrulaması başarısız: ${verify.reason}`);
    }

    return archive;
  }

  getStorageAdapter(): ICloudStorageAdapter {
    return this.storageAdapter;
  }
}

export const cloudBackupService = new CloudBackupService();
