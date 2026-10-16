import { Storage } from "@google-cloud/storage";
import { ICloudStorageAdapter, CloudStorageObjectInfo } from "./types";

/**
 * In-Memory Cloud Storage Adapter
 * Used for development, CI/CD, and automated integration tests without external Cloud Storage charges.
 */
export class InMemoryCloudStorageAdapter implements ICloudStorageAdapter {
  private storage: Map<string, { content: string; info: CloudStorageObjectInfo }> = new Map();

  async uploadBackup(
    tenantId: string,
    fileName: string,
    content: string,
    metadata?: Record<string, string>
  ): Promise<{ objectPath: string; sizeBytes: number; uri: string }> {
    const date = new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const objectPath = `tenants/${tenantId}/backups/${year}/${month}/${fileName}`;
    const sizeBytes = Buffer.byteLength(content, "utf-8");

    const info: CloudStorageObjectInfo = {
      objectPath,
      tenantId,
      sizeBytes,
      createdAt: date.toISOString(),
      checksum: metadata?.checksum,
      metadata: metadata || {}
    };

    this.storage.set(objectPath, { content, info });

    return {
      objectPath,
      sizeBytes,
      uri: `gs://stokpro-private-backups/${objectPath}`
    };
  }

  async downloadBackup(objectPath: string): Promise<string> {
    const item = this.storage.get(objectPath);
    if (!item) {
      throw new Error(`Storage object not found: ${objectPath}`);
    }
    return item.content;
  }

  async listBackups(tenantId: string): Promise<CloudStorageObjectInfo[]> {
    const prefix = `tenants/${tenantId}/backups/`;
    const results: CloudStorageObjectInfo[] = [];

    for (const [path, data] of this.storage.entries()) {
      if (path.startsWith(prefix) && data.info.tenantId === tenantId) {
        results.push(data.info);
      }
    }

    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async deleteBackup(objectPath: string): Promise<boolean> {
    return this.storage.delete(objectPath);
  }

  /**
   * Test helper to inspect storage size
   */
  getStoredCount(): number {
    return this.storage.size;
  }

  /**
   * Test helper to clear storage
   */
  clear(): void {
    this.storage.clear();
  }
}

/**
 * Production-grade Google Cloud Storage Adapter.
 * 
 * Security & Reliability Guarantees:
 * - Uses official @google-cloud/storage client.
 * - Authenticates via Google Cloud Application Default Credentials (ADC) or managed service account.
 * - No service account keys, secrets, or hardcoded credentials in codebase.
 * - Strictly enforces BACKUP_BUCKET presence in production (no silent fallback to memory).
 * - Objects are kept strictly private (uniform bucket-level access recommended).
 * - Protects against accidental overwrites via precondition `ifGenerationMatch: 0`.
 */
export class GoogleCloudStorageAdapter implements ICloudStorageAdapter {
  private storage: Storage;
  private bucketName: string;

  constructor(options?: { bucketName?: string; storageInstance?: Storage }) {
    const envBucket = process.env.BACKUP_BUCKET || process.env.GCS_BACKUP_BUCKET;
    const bucket = options?.bucketName !== undefined ? options.bucketName : envBucket;

    const isProduction = process.env.NODE_ENV === "production";
    // If bucket was explicitly passed as empty string, fail fast
    if (isProduction && options?.bucketName !== undefined && (!options.bucketName || options.bucketName.trim() === "")) {
      throw new Error(
        "Kritik Yapılandırma Hatası: Üretim (production) ortamında BACKUP_BUCKET ortam değişkeni zorunludur. " +
        "Güvenlik gereği bellek içi depolamaya (in-memory) sessiz geri dönüş engellenmiştir."
      );
    }

    this.bucketName = bucket || "";
    // Uses Google Cloud Application Default Credentials (ADC) or injected mock in tests
    this.storage = options?.storageInstance || new Storage();
  }

  private assertBucketConfigured(): void {
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && (!this.bucketName || this.bucketName.trim() === "")) {
      throw new Error(
        "Kritik Yapılandırma Hatası: Üretim (production) ortamında BACKUP_BUCKET ortam değişkeni zorunludur. " +
        "Güvenlik gereği bellek içi depolamaya (in-memory) sessiz geri dönüş engellenmiştir."
      );
    }
    if (!this.bucketName) {
      this.bucketName = "stokpro-private-backups";
    }
  }

  getBucketName(): string {
    return this.bucketName || "stokpro-private-backups";
  }

  async uploadBackup(
    tenantId: string,
    fileName: string,
    content: string,
    metadata?: Record<string, string>
  ): Promise<{ objectPath: string; sizeBytes: number; uri: string }> {
    this.assertBucketConfigured();
    const date = new Date();
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const objectPath = `tenants/${tenantId}/backups/${year}/${month}/${fileName}`;
    const sizeBytes = Buffer.byteLength(content, "utf-8");

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(objectPath);

    // Save with custom metadata and precondition to prevent accidental overwrite of existing backup archive
    await file.save(content, {
      contentType: "application/json",
      metadata: {
        contentType: "application/json",
        metadata: {
          tenantId,
          createdAt: date.toISOString(),
          checksum: metadata?.checksum || "",
          schemaVersion: metadata?.schemaVersion || "2.1.0",
          ...metadata
        }
      },
      // ifGenerationMatch: 0 ensures atomic creation only if the target object does NOT already exist
      preconditionOpts: {
        ifGenerationMatch: 0
      }
    });

    return {
      objectPath,
      sizeBytes,
      uri: `gs://${this.bucketName}/${objectPath}`
    };
  }

  async downloadBackup(objectPath: string): Promise<string> {
    this.assertBucketConfigured();
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(objectPath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new Error(`Cloud Storage nesnesi bulunamadı: gs://${this.bucketName}/${objectPath}`);
    }

    const [contentBuffer] = await file.download();
    return contentBuffer.toString("utf-8");
  }

  async listBackups(tenantId: string): Promise<CloudStorageObjectInfo[]> {
    this.assertBucketConfigured();
    const prefix = `tenants/${tenantId}/backups/`;
    const bucket = this.storage.bucket(this.bucketName);

    const [files] = await bucket.getFiles({ prefix });
    const results: CloudStorageObjectInfo[] = [];

    for (const file of files) {
      const [metadata] = await file.getMetadata();
      const customMeta = (metadata.metadata || {}) as Record<string, string>;

      results.push({
        objectPath: file.name,
        tenantId,
        sizeBytes: Number(metadata.size || 0),
        createdAt: (metadata.timeCreated as string) || (customMeta.createdAt as string) || new Date().toISOString(),
        checksum: customMeta.checksum,
        metadata: customMeta
      });
    }

    return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async deleteBackup(objectPath: string): Promise<boolean> {
    this.assertBucketConfigured();
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(objectPath);

    try {
      await file.delete({ ignoreNotFound: true });
      return true;
    } catch (err: any) {
      console.error(`Cloud Storage delete error for ${objectPath}:`, err);
      throw err;
    }
  }
}

/**
 * Storage Adapter Factory
 * Chooses GoogleCloudStorageAdapter if STORAGE_DRIVER=gcs, BACKUP_BUCKET is set, or in production.
 * Otherwise defaults to InMemoryCloudStorageAdapter for unit tests and local development.
 */
export function createDefaultStorageAdapter(overrideDriver?: "gcs" | "memory"): ICloudStorageAdapter {
  const driver = overrideDriver || process.env.STORAGE_DRIVER;
  const hasBucket = Boolean(process.env.BACKUP_BUCKET || process.env.GCS_BACKUP_BUCKET);
  const isProd = process.env.NODE_ENV === "production";

  if (driver === "gcs" || hasBucket || (isProd && driver !== "memory")) {
    return new GoogleCloudStorageAdapter();
  }

  return new InMemoryCloudStorageAdapter();
}

