import { 
  Product, 
  Customer, 
  Supplier, 
  Sale, 
  Warehouse, 
  Order, 
  Payment, 
  StockMovement, 
  FabricRoll, 
  CustomerTransaction 
} from "../../types";

export type ExportDomain = 
  | "products" 
  | "stock" 
  | "warehouses" 
  | "rolls" 
  | "customers" 
  | "suppliers" 
  | "sales" 
  | "orders" 
  | "transactions" 
  | "payments" 
  | "stock_movements" 
  | "full_backup";

export type ExportFormat = "csv" | "json";

export interface ExportFilterOptions {
  startDate?: string;
  endDate?: string;
  warehouseId?: string;
  productId?: string;
  category?: string;
  customerId?: string;
  supplierId?: string;
  saleStatus?: string;
  orderStatus?: string;
  paymentMethod?: string;
}

export interface ExportResult {
  fileName: string;
  mimeType: string;
  content: string;
  recordCount: number;
  domain: ExportDomain;
  tenantId: string;
  exportedAt: string;
  appliedFilters?: ExportFilterOptions;
}

export interface TenantBackupMetadata {
  schemaVersion: string;
  tenantId: string;
  userId: string;
  companyName?: string;
  exportedAt: string;
  appVersion: string;
  checksum?: string;
  itemCounts: {
    products: number;
    customers: number;
    suppliers: number;
    sales: number;
    warehouses: number;
    orders: number;
    payments: number;
    stockMovements: number;
  };
}

export interface TenantBackupArchive {
  metadata: TenantBackupMetadata;
  data: {
    products: Product[];
    customers: Customer[];
    suppliers: Supplier[];
    sales: Sale[];
    warehouses: Warehouse[];
    orders: Order[];
    payments: Payment[];
    stockMovements: StockMovement[];
  };
}

/**
 * Storage / Backend Agnostic Backup Adapter
 * Allows future switching from Firebase to Supabase/PostgreSQL or Cloud Object Storage.
 */
export interface IBackupAdapter {
  readonly adapterName: "firebase" | "supabase_postgres" | "local_storage";
  exportArchive(archive: TenantBackupArchive): Promise<{ success: boolean; uri?: string; id?: string }>;
  fetchArchive(tenantId: string, archiveId: string): Promise<TenantBackupArchive | null>;
}

/**
 * Abstraction for Data Export Service
 */
export interface IDataExportService {
  exportProducts(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportStockReport(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportWarehouses(uid: string, format?: ExportFormat): Promise<ExportResult>;
  exportRolls(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportCustomers(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportSuppliers(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportSales(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportOrders(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportTransactions(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportPayments(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportStockMovements(uid: string, format?: ExportFormat, filters?: ExportFilterOptions): Promise<ExportResult>;
  exportFullTenantBackup(uid: string): Promise<ExportResult>;
}

/**
 * Abstraction for Backup & Disaster Recovery System
 */
export type BackupRestoreMode = "safe_append" | "merge_non_financial" | "merge_upsert";

export interface BackupValidationResult {
  isValid: boolean;
  error?: string;
  warnings?: string[];
  archive?: TenantBackupArchive;
  totalRecords?: number;
  itemCounts?: TenantBackupMetadata["itemCounts"];
  schemaVersion?: string;
  sourceTenantId?: string;
  companyName?: string;
  exportedAt?: string;
  checksumType?: "sha256" | "legacy";
  isLegacy?: boolean;
  calculatedChecksum?: string;
}

export interface RestoreExecutionResult {
  success: boolean;
  tenantId: string;
  mode: BackupRestoreMode;
  restoredCounts: Record<keyof TenantBackupArchive["data"], number>;
  totalRestored: number;
  skippedCounts: Record<keyof TenantBackupArchive["data"], number>;
  conflictCounts: Record<keyof TenantBackupArchive["data"], number>;
  totalSkipped: number;
  errors: string[];
  restoredAt: string;
  checkpointFingerprint?: string;
}

export interface RestoreBackupOptions {
  mode: BackupRestoreMode;
  allowLegacyUnverified?: boolean;
  onProgress?: (processed: number, total: number, message: string) => void;
  /** Internal test-only hook for simulating partial batch commit failures */
  __testBatchFailureHook?: (batchIndex: number, collection: string) => boolean;
  __testBatchSize?: number;
}

export interface IBackupService {
  createTenantBackup(uid: string): Promise<TenantBackupArchive>;
  validateBackupArchive(archive: any, expectedTenantId: string): Promise<BackupValidationResult>;
  previewBackupFile(fileContent: string, currentTenantId: string): Promise<BackupValidationResult>;
  restoreTenantBackup(uid: string, archive: TenantBackupArchive, options: RestoreBackupOptions): Promise<RestoreExecutionResult>;
}

/**
 * Import Foundation Interfaces
 */
export interface ImportRowError {
  rowNumber: number;
  field?: string;
  value?: any;
  message: string;
}

export interface ImportPreview<T = any> {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  headers: string[];
  previewRows: T[];
  errors: ImportRowError[];
}

export interface ImportExecutionResult {
  success: boolean;
  insertedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: ImportRowError[];
  importedAt: string;
}

export interface ColumnMapping {
  excelColumn: string;
  targetField: string; // 'name' | 'sku' | 'barcode' | 'brand' | 'category' | 'price' | 'costPrice' | 'stock' | 'minStock' | 'unit' | 'description' | `custom:${string}` | '_new_custom' | '_ignore';
  isCustomField?: boolean;
  customFieldKey?: string;
  customFieldLabel?: string;
  customFieldType?: 'text' | 'number' | 'date';
}

export type ImportProgressCallback = (processed: number, total: number, percent: number) => void;

export interface UniversalImportOptions {
  duplicateAction?: 'skip' | 'update';
  onProgress?: ImportProgressCallback;
}

export interface IDataImportService {
  parseFile(file: File): Promise<{ headers: string[]; rows: any[][]; sheetNames: string[]; activeSheet: string }>;

  autoDetectColumnMapping(headers: string[], customFields?: any[]): ColumnMapping[];

  previewUniversalImport(
    rawRows: any[][],
    headers: string[],
    mapping: ColumnMapping[],
    domain: "products" | "customers" | "suppliers",
    existingItems: any[],
    options?: { duplicateAction?: 'skip' | 'update' }
  ): ImportPreview;

  executeUniversalBatchImport(
    uid: string,
    domain: "products" | "customers" | "suppliers",
    items: any[],
    options?: UniversalImportOptions
  ): Promise<ImportExecutionResult>;

  previewCsvImport(
    csvContent: string, 
    domain: "products" | "customers" | "suppliers", 
    existingItems: any[]
  ): ImportPreview;

  executeBatchImport(
    uid: string, 
    domain: "products" | "customers" | "suppliers", 
    items: any[]
  ): Promise<ImportExecutionResult>;
}
