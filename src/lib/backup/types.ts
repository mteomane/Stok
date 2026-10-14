import { TenantBackupArchive, TenantBackupMetadata } from "../export/types";

export type BackupJobStatus = "pending" | "running" | "success" | "failed" | "retrying";

export type BackupFrequency = "daily" | "weekly" | "manual";

export interface BackupJobMetadata {
  id: string; // e.g. "bkm_{tenantId}_{timestamp}"
  tenantId: string;
  backupId: string;
  status: BackupJobStatus;
  startedAt: string;
  completedAt?: string;
  schemaVersion: string;
  appVersion: string;
  objectPath?: string;
  sizeBytes?: number;
  itemCounts?: TenantBackupMetadata["itemCounts"];
  totalRecords?: number;
  checksum?: string;
  checksumVerified?: boolean;
  frequency: BackupFrequency;
  retentionDays: number;
  expiresAt: string;
  error?: string;
  errorCode?: string;
  retryCount: number;
  maxRetries: number;
  initiatedBy: "scheduler" | "manual_admin" | "system_retry";
}

export interface CloudStorageObjectInfo {
  objectPath: string;
  tenantId: string;
  sizeBytes: number;
  createdAt: string;
  checksum?: string;
  metadata?: Record<string, string>;
}

export interface ICloudStorageAdapter {
  uploadBackup(
    tenantId: string, 
    fileName: string, 
    content: string, 
    metadata?: Record<string, string>
  ): Promise<{ objectPath: string; sizeBytes: number; uri: string }>;

  downloadBackup(objectPath: string): Promise<string>;

  listBackups(tenantId: string): Promise<CloudStorageObjectInfo[]>;

  deleteBackup(objectPath: string): Promise<boolean>;
}

export interface RetentionPolicy {
  retentionDays: number;
  minBackupsToKeep: number;
}

export interface CloudBackupConfig {
  bucketName: string;
  retentionDays: number;
  minBackupsToKeep: number;
  cronSchedule: string; // e.g. "0 2 * * *" (Every day at 02:00)
  timeZone: string;     // "Europe/Istanbul"
  maxRetries: number;
  timeoutMs: number;
}
