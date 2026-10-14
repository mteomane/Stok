import { IBackupAdapter, TenantBackupArchive } from "./types";

/**
 * Default Firebase / Firestore Backup Storage Adapter
 */
export class FirebaseBackupAdapter implements IBackupAdapter {
  readonly adapterName = "firebase" as const;

  async exportArchive(archive: TenantBackupArchive): Promise<{ success: boolean; uri?: string; id?: string }> {
    // In current client-side deployment, the archive is returned to be saved or stored locally
    return {
      success: true,
      id: `${archive.metadata.tenantId}_${Date.now()}`,
      uri: `firestore://tenants/${archive.metadata.tenantId}/backups`
    };
  }

  async fetchArchive(tenantId: string, archiveId: string): Promise<TenantBackupArchive | null> {
    // Abstraction point for fetching historical backup from Firestore
    return null;
  }
}

/**
 * Supabase / PostgreSQL Adapter (Future Extension Abstraction)
 */
export class SupabasePostgresBackupAdapter implements IBackupAdapter {
  readonly adapterName = "supabase_postgres" as const;

  async exportArchive(archive: TenantBackupArchive): Promise<{ success: boolean; uri?: string; id?: string }> {
    // Future implementation: stream JSON payload into Postgres jsonb table `tenant_backups`
    return {
      success: true,
      id: `pg_${archive.metadata.tenantId}_${Date.now()}`,
      uri: `postgresql://stokpro_db/tenant_backups`
    };
  }

  async fetchArchive(tenantId: string, archiveId: string): Promise<TenantBackupArchive | null> {
    return null;
  }
}

/**
 * Local File / Memory Adapter
 */
export class LocalBlobBackupAdapter implements IBackupAdapter {
  readonly adapterName = "local_storage" as const;

  async exportArchive(archive: TenantBackupArchive): Promise<{ success: boolean; uri?: string; id?: string }> {
    return {
      success: true,
      id: `local_${archive.metadata.tenantId}_${Date.now()}`,
      uri: `blob:local-download`
    };
  }

  async fetchArchive(tenantId: string, archiveId: string): Promise<TenantBackupArchive | null> {
    return null;
  }
}
