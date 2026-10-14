import { repositories } from "../repositories";
import { 
  IDataExportService, 
  IBackupService, 
  ExportResult, 
  ExportFormat, 
  ExportFilterOptions,
  TenantBackupArchive, 
  TenantBackupMetadata,
  BackupValidationResult,
  RestoreExecutionResult,
  RestoreBackupOptions
} from "./types";
import { generateCsvWithBom, formatNumberForCsv, formatQtyForCsv, formatDateForCsv, CsvColumn } from "./csvUtils";
import { sanitizeRecord, enforceTenantIsolation } from "./sanitizer";
import { 
  calculateBackupChecksum, 
  verifyBackupChecksum, 
  generateDeterministicDocId 
} from "./backupCrypto";
import { 
  getWarehouses, 
  getOrders, 
  getPayments, 
  getStockMovements, 
  logAuditEvent 
} from "../firestoreService";
import { db } from "../firebase";
import { collection, doc, writeBatch, getDocs, query, where } from "firebase/firestore";
import { isDemoUser } from "../authGuard";
import { memoryCache } from "../cache";
import { 
  Product, 
  Customer, 
  Supplier, 
  Sale, 
  Warehouse, 
  Order, 
  Payment, 
  StockMovement, 
  FabricRoll 
} from "../../types";

export class DataExportService implements IDataExportService, IBackupService {
  /**
   * Resolves and strictly verifies the tenant context for the caller.
   */
  private async getVerifiedTenantContext(uid: string) {
    if (!uid) {
      throw new Error("Yetkilendirme hatası: Kullanıcı oturumu açık değil.");
    }
    const context = await repositories.users.getOrCreateContext(uid);
    if (!context || !context.tenantId) {
      throw new Error("Güvenlik hatası: Şirket kiracı kimliği (tenantId) doğrulanamadı.");
    }
    return context;
  }

  /**
   * Helper: Generates a timestamped file name.
   */
  private buildFileName(domain: string, ext: string = "csv"): string {
    const dateStr = new Date().toISOString().split("T")[0];
    return `stokpro_${domain}_${dateStr}.${ext}`;
  }

  /**
   * Helper: Record audit log without throwing
   */
  private async auditExport(uid: string, domain: string, count: number, format: string) {
    try {
      await logAuditEvent(uid, {
        action: "EXPORT_CREATED",
        entityType: "export",
        entityId: `exp_${domain}_${Date.now()}`,
        details: {
          domain,
          format,
          recordCount: count,
          exportedAt: new Date().toISOString()
        }
      });
    } catch (e) {
      console.warn("Audit logging failed silently for export:", e);
    }
  }

  /**
   * 1. Products Export with Filtering
   */
  async exportProducts(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const raw = await repositories.products.getAll(uid, true);
    let items = enforceTenantIsolation(raw, context.tenantId, uid);

    // Apply Filters
    if (filters) {
      if (filters.category) {
        items = items.filter(p => p.category?.toLowerCase() === filters.category!.toLowerCase());
      }
      if (filters.warehouseId) {
        items = items.filter(p => p.warehouseId === filters.warehouseId);
      }
      if (filters.productId) {
        items = items.filter(p => p.id === filters.productId);
      }
      if (filters.saleStatus === "critical") {
        items = items.filter(p => p.stock <= p.minStock && p.stock > 0);
      } else if (filters.saleStatus === "out_of_stock") {
        items = items.filter(p => p.stock <= 0);
      }
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("urunler", format);

    await this.auditExport(uid, "products", items.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(items, null, 2),
        recordCount: items.length,
        domain: "products",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<Product>[] = [
      { header: "Barkod / SKU", accessor: p => p.sku || "" },
      { header: "Ürün Adı", accessor: p => p.name },
      { header: "Kategori", accessor: p => p.category || "Genel" },
      { header: "Satış Fiyatı (₺)", accessor: p => formatNumberForCsv(p.price) },
      { header: "Güncel Stok", accessor: p => formatQtyForCsv(p.stock) },
      { header: "Min. Stok Eşiği", accessor: p => formatQtyForCsv(p.minStock || 0) },
      { header: "Birim", accessor: p => p.unit || "Adet" },
      { 
        header: "Stok Durumu", 
        accessor: p => p.stock <= 0 ? "Tükendi" : p.stock <= p.minStock ? "Kritik Stok" : "Normal" 
      },
      { header: "Toplam Değer (₺)", accessor: p => formatNumberForCsv(p.stock * p.price) },
      { header: "Depo ID", accessor: p => p.warehouseId || "Ana Depo" },
      { header: "Paket İçi Adet", accessor: p => p.isPackaged ? (p.packageUnitsCount || 1) : "-" },
      { header: "Alt Birim Adı", accessor: p => p.isPackaged ? (p.packageUnitName || "Adet") : "-" },
      { header: "Raf / Reyon", accessor: p => p.metadata?.shelfLocation || p.attributes?.shelf || "-" },
      { header: "Durum", accessor: p => p.isActive === false ? "Arşivlenmiş" : "Aktif" }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(items, columns),
      recordCount: items.length,
      domain: "products",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 2. Detailed Stock Report
   */
  async exportStockReport(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const raw = await repositories.products.getAll(uid, false);
    let items = enforceTenantIsolation(raw, context.tenantId, uid);

    if (filters) {
      if (filters.category) {
        items = items.filter(p => p.category?.toLowerCase() === filters.category!.toLowerCase());
      }
      if (filters.warehouseId) {
        items = items.filter(p => p.warehouseId === filters.warehouseId);
      }
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("stok_envanter_raporu", format);

    await this.auditExport(uid, "stock", items.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(items, null, 2),
        recordCount: items.length,
        domain: "stock",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<Product>[] = [
      { header: "Barkod / SKU", accessor: p => p.sku || "" },
      { header: "Ürün Adı", accessor: p => p.name },
      { header: "Kategori", accessor: p => p.category || "Genel" },
      { header: "Mevcut Stok", accessor: p => formatQtyForCsv(p.stock) },
      { header: "Birim", accessor: p => p.unit || "Adet" },
      { header: "Kritik Eşik", accessor: p => formatQtyForCsv(p.minStock || 0) },
      { 
        header: "Eksik İhtiyaç Miktarı", 
        accessor: p => formatQtyForCsv(Math.max(0, (p.minStock || 0) - p.stock)) 
      },
      { header: "Birim Fiyat (₺)", accessor: p => formatNumberForCsv(p.price) },
      { header: "Toplam Stok Değeri (₺)", accessor: p => formatNumberForCsv(p.stock * p.price) },
      { 
        header: "Stok Sağlık Durumu", 
        accessor: p => p.stock <= 0 ? "TÜKENDİ" : p.stock <= p.minStock ? "KRİTİK" : "YETERLİ" 
      }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(items, columns),
      recordCount: items.length,
      domain: "stock",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 3. Warehouses (Depolar) Export
   */
  async exportWarehouses(uid: string, format: ExportFormat = "csv"): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const raw = await getWarehouses(uid);
    const items = enforceTenantIsolation(raw, context.tenantId, uid);

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("depolar", format);

    await this.auditExport(uid, "warehouses", items.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(items, null, 2),
        recordCount: items.length,
        domain: "warehouses",
        tenantId: context.tenantId,
        exportedAt
      };
    }

    const columns: CsvColumn<Warehouse>[] = [
      { header: "Depo Kodu", accessor: w => w.code || w.id },
      { header: "Depo Adı", accessor: w => w.name },
      { header: "Konum / Adres", accessor: w => w.location || "" },
      { header: "Varsayılan Depo", accessor: w => w.isDefault ? "Evet" : "Hayır" },
      { header: "Kayıt Tarihi", accessor: w => formatDateForCsv(w.createdAt) }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(items, columns),
      recordCount: items.length,
      domain: "warehouses",
      tenantId: context.tenantId,
      exportedAt
    };
  }

  /**
   * 4. Fabric Rolls / Cut Stock Export
   */
  async exportRolls(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const rawProducts = await repositories.products.getAll(uid, true);
    const tenantProducts = enforceTenantIsolation(rawProducts, context.tenantId, uid);

    // Flatten rolls across all products
    let rollItems: Array<{
      productId: string;
      productName: string;
      sku: string;
      category: string;
      roll: FabricRoll;
    }> = [];

    tenantProducts.forEach(p => {
      if (Array.isArray(p.rolls)) {
        p.rolls.forEach(r => {
          rollItems.push({
            productId: p.id,
            productName: p.name,
            sku: p.sku || "",
            category: p.category || "",
            roll: r
          });
        });
      }
    });

    if (filters) {
      if (filters.productId) {
        rollItems = rollItems.filter(item => item.productId === filters.productId);
      }
      if (filters.saleStatus) {
        rollItems = rollItems.filter(item => item.roll.status === filters.saleStatus);
      }
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("kumaspencerulolari", format);

    await this.auditExport(uid, "rolls", rollItems.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(rollItems, null, 2),
        recordCount: rollItems.length,
        domain: "rolls",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<typeof rollItems[0]>[] = [
      { header: "Rulo / Top No", accessor: item => item.roll.rollNumber },
      { header: "Ürün Adı", accessor: item => item.productName },
      { header: "SKU", accessor: item => item.sku },
      { header: "Kategori", accessor: item => item.category },
      { header: "Kalan Metraj", accessor: item => item.roll.length },
      { header: "Başlangıç Metrajı", accessor: item => item.roll.initialLength },
      { header: "Kesilen / Satılan Metre", accessor: item => item.roll.soldLength || (item.roll.initialLength - item.roll.length) },
      { 
        header: "Durum", 
        accessor: item => item.roll.status === "available" ? "Müsait" : item.roll.status === "sold" ? "Tükendi" : "Rezerve" 
      }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(rollItems, columns),
      recordCount: rollItems.length,
      domain: "rolls",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 5. Customers Export
   */
  async exportCustomers(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const raw = await repositories.customers.getAll(uid);
    let items = enforceTenantIsolation(raw, context.tenantId, uid);

    if (filters?.customerId) {
      items = items.filter(c => c.id === filters.customerId);
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("musteriler_ve_veresiye", format);

    await this.auditExport(uid, "customers", items.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(items, null, 2),
        recordCount: items.length,
        domain: "customers",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<Customer>[] = [
      { header: "Müşteri / Cari Adı", accessor: c => c.name },
      { header: "Telefon", accessor: c => c.phone || "" },
      { header: "Instagram", accessor: c => c.instagram || "" },
      { header: "Kalan Borç (₺)", accessor: c => formatNumberForCsv(c.totalDebt) },
      { header: "Toplam Tahsilat (₺)", accessor: c => formatNumberForCsv(c.totalPaid) },
      { 
        header: "Hesap Durumu", 
        accessor: c => c.totalDebt > 0 ? "Borçlu" : "Hesap Kapalı" 
      },
      { header: "Adres", accessor: c => c.address || "" },
      { header: "Vergi No", accessor: c => c.taxNumber || "" },
      { header: "Notlar", accessor: c => c.notes || "" }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(items, columns),
      recordCount: items.length,
      domain: "customers",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 6. Suppliers (Tedarikçiler) Export
   */
  async exportSuppliers(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const raw = await repositories.suppliers.getAll(uid);
    let items = enforceTenantIsolation(raw, context.tenantId, uid);

    if (filters?.supplierId) {
      items = items.filter(s => s.id === filters.supplierId);
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("tedarikciler", format);

    await this.auditExport(uid, "suppliers", items.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(items, null, 2),
        recordCount: items.length,
        domain: "suppliers",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<Supplier>[] = [
      { header: "Tedarikçi Firma Adı", accessor: s => s.name },
      { header: "Yetkili", accessor: s => s.contactPerson || "" },
      { header: "Telefon", accessor: s => s.phone || "" },
      { header: "E-Posta", accessor: s => s.email || "" },
      { header: "Adres", accessor: s => s.address || "" },
      { header: "Cari Bakiye (₺)", accessor: s => formatNumberForCsv(s.balance || 0) },
      { header: "Kategori", accessor: s => s.category || "Genel" },
      { header: "Kayıt Tarihi", accessor: s => formatDateForCsv(s.createdAt) }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(items, columns),
      recordCount: items.length,
      domain: "suppliers",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 7. Sales (Satışlar) Export
   */
  async exportSales(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const raw = await repositories.sales.getAll(uid);
    let items = enforceTenantIsolation(raw, context.tenantId, uid);

    if (filters) {
      if (filters.startDate) {
        const start = new Date(filters.startDate).getTime();
        items = items.filter(s => new Date(s.timestamp).getTime() >= start);
      }
      if (filters.endDate) {
        const end = new Date(`${filters.endDate}T23:59:59.999`).getTime();
        items = items.filter(s => new Date(s.timestamp).getTime() <= end);
      }
      if (filters.customerId) {
        items = items.filter(s => s.customerName?.toLowerCase().includes(filters.customerId!.toLowerCase()));
      }
      if (filters.paymentMethod) {
        items = items.filter(s => s.paymentMethod?.toLowerCase() === filters.paymentMethod!.toLowerCase());
      }
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("satis_gecmisi", format);

    await this.auditExport(uid, "sales", items.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(items, null, 2),
        recordCount: items.length,
        domain: "sales",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<Sale>[] = [
      { header: "Fiş No / ID", accessor: s => s.id },
      { header: "İşlem Tarihi", accessor: s => formatDateForCsv(s.timestamp) },
      { header: "Müşteri Adı", accessor: s => s.customerName || "Perakende Müşteri" },
      { header: "Ödeme Yöntemi", accessor: s => s.paymentMethod || "Nakit" },
      { 
        header: "Satılan Parça", 
        accessor: s => s.items.reduce((sum, item) => sum + item.quantity, 0) 
      },
      { header: "Toplam Tutar (₺)", accessor: s => formatNumberForCsv(s.totalAmount) },
      { 
        header: "Kalemler", 
        accessor: s => s.items.map(i => `${i.quantity}x ${i.productName || (i as any).name || 'Ürün'} (${formatNumberForCsv(i.price)}₺)`).join(" | ") 
      }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(items, columns),
      recordCount: items.length,
      domain: "sales",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 8. Orders & Waybills (Siparişler ve İrsaliyeler) Export
   */
  async exportOrders(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const raw = await getOrders(uid);
    let items = enforceTenantIsolation(raw, context.tenantId, uid);

    if (filters) {
      if (filters.startDate) {
        const start = new Date(filters.startDate).getTime();
        items = items.filter(o => new Date(o.orderDate).getTime() >= start);
      }
      if (filters.endDate) {
        const end = new Date(`${filters.endDate}T23:59:59.999`).getTime();
        items = items.filter(o => new Date(o.orderDate).getTime() <= end);
      }
      if (filters.orderStatus) {
        items = items.filter(o => o.status === filters.orderStatus);
      }
      if (filters.customerId) {
        items = items.filter(o => o.customerId === filters.customerId || o.customerName?.toLowerCase().includes(filters.customerId!.toLowerCase()));
      }
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("siparisler_ve_irsaliyeler", format);

    await this.auditExport(uid, "orders", items.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(items, null, 2),
        recordCount: items.length,
        domain: "orders",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<Order>[] = [
      { header: "Sipariş No", accessor: o => o.orderNo },
      { header: "Sipariş Tarihi", accessor: o => formatDateForCsv(o.orderDate) },
      { header: "Müşteri", accessor: o => o.customerName || o.customerDetails?.name || "Bilinmiyor" },
      { header: "Durum", accessor: o => o.status },
      { header: "Toplam Tutar (₺)", accessor: o => formatNumberForCsv(o.totalAmount) },
      { header: "Ödenen Tutar (₺)", accessor: o => formatNumberForCsv(o.amountPaid) },
      { header: "Kalan Tutar (₺)", accessor: o => formatNumberForCsv(o.totalAmount - o.amountPaid) },
      { header: "İrsaliye No", accessor: o => o.waybillNo || "-" },
      { header: "İrsaliye Tarihi", accessor: o => formatDateForCsv(o.waybillDate) || "-" },
      { header: "Sevk Tarihi", accessor: o => formatDateForCsv(o.shipDate) || "-" },
      { header: "Notlar", accessor: o => o.notes || "" }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(items, columns),
      recordCount: items.length,
      domain: "orders",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 9. Customer Ledger Transactions (Cari Hareketler) Export
   */
  async exportTransactions(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const rawCustomers = await repositories.customers.getAll(uid);
    const tenantCustomers = enforceTenantIsolation(rawCustomers, context.tenantId, uid);

    // Flatten transactions across all customers
    let txItems: Array<{
      customerId: string;
      customerName: string;
      phone: string;
      txId: string;
      type: "sale" | "payment";
      amount: number;
      description: string;
      timestamp: string;
    }> = [];

    tenantCustomers.forEach(c => {
      if (Array.isArray(c.transactions)) {
        c.transactions.forEach(t => {
          txItems.push({
            customerId: c.id,
            customerName: c.name,
            phone: c.phone || "",
            txId: t.id,
            type: t.type,
            amount: t.amount,
            description: t.description || "",
            timestamp: t.timestamp
          });
        });
      }
    });

    if (filters) {
      if (filters.startDate) {
        const start = new Date(filters.startDate).getTime();
        txItems = txItems.filter(t => new Date(t.timestamp).getTime() >= start);
      }
      if (filters.endDate) {
        const end = new Date(`${filters.endDate}T23:59:59.999`).getTime();
        txItems = txItems.filter(t => new Date(t.timestamp).getTime() <= end);
      }
      if (filters.customerId) {
        txItems = txItems.filter(t => t.customerId === filters.customerId || t.customerName.toLowerCase().includes(filters.customerId!.toLowerCase()));
      }
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("cari_hareketler", format);

    await this.auditExport(uid, "transactions", txItems.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(txItems, null, 2),
        recordCount: txItems.length,
        domain: "transactions",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<typeof txItems[0]>[] = [
      { header: "İşlem Tarihi", accessor: t => formatDateForCsv(t.timestamp) },
      { header: "Müşteri / Cari Adı", accessor: t => t.customerName },
      { header: "Telefon", accessor: t => t.phone },
      { header: "İşlem Türü", accessor: t => t.type === "payment" ? "Tahsilat (+)" : "Veresiye Satış (-)" },
      { header: "Tutar (₺)", accessor: t => formatNumberForCsv(t.amount) },
      { header: "Açıklama", accessor: t => t.description },
      { header: "İşlem ID", accessor: t => t.txId }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(txItems, columns),
      recordCount: txItems.length,
      domain: "transactions",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 10. Payments (Ödemeler & Tahsilatlar) Export
   */
  async exportPayments(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const raw = await getPayments(uid);
    let items = enforceTenantIsolation(raw, context.tenantId, uid);

    if (filters) {
      if (filters.startDate) {
        const start = new Date(filters.startDate).getTime();
        items = items.filter(p => new Date(p.timestamp).getTime() >= start);
      }
      if (filters.endDate) {
        const end = new Date(`${filters.endDate}T23:59:59.999`).getTime();
        items = items.filter(p => new Date(p.timestamp).getTime() <= end);
      }
      if (filters.paymentMethod) {
        items = items.filter(p => p.paymentMethod === filters.paymentMethod);
      }
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("odemeler_ve_tahsilatlar", format);

    await this.auditExport(uid, "payments", items.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(items, null, 2),
        recordCount: items.length,
        domain: "payments",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<Payment>[] = [
      { header: "Tarih", accessor: p => formatDateForCsv(p.timestamp) },
      { header: "Hareket Tipi", accessor: p => p.type === "incoming" ? "Tahsilat (Giriş)" : "Tediye (Çıkış)" },
      { header: "Cari / Taraf", accessor: p => p.customerName || p.supplierName || "Genel" },
      { header: "Tutar (₺)", accessor: p => formatNumberForCsv(p.amount) },
      { header: "Ödeme Yöntemi", accessor: p => p.paymentMethod },
      { header: "Makbuz / Belge No", accessor: p => p.receiptNo || "-" },
      { header: "Açıklama", accessor: p => p.description || "" }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(items, columns),
      recordCount: items.length,
      domain: "payments",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 11. Stock Movements (Stok Hareketleri) Export
   */
  async exportStockMovements(
    uid: string, 
    format: ExportFormat = "csv", 
    filters?: ExportFilterOptions
  ): Promise<ExportResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const raw = await getStockMovements(uid);
    let items = enforceTenantIsolation(raw, context.tenantId, uid);

    if (filters) {
      if (filters.startDate) {
        const start = new Date(filters.startDate).getTime();
        items = items.filter(m => new Date(m.timestamp).getTime() >= start);
      }
      if (filters.endDate) {
        const end = new Date(`${filters.endDate}T23:59:59.999`).getTime();
        items = items.filter(m => new Date(m.timestamp).getTime() <= end);
      }
      if (filters.warehouseId) {
        items = items.filter(m => m.warehouseId === filters.warehouseId);
      }
      if (filters.productId) {
        items = items.filter(m => m.productId === filters.productId);
      }
    }

    const exportedAt = new Date().toISOString();
    const fileName = this.buildFileName("stok_hareketleri", format);

    await this.auditExport(uid, "stock_movements", items.length, format);

    if (format === "json") {
      return {
        fileName,
        mimeType: "application/json;charset=utf-8;",
        content: JSON.stringify(items, null, 2),
        recordCount: items.length,
        domain: "stock_movements",
        tenantId: context.tenantId,
        exportedAt,
        appliedFilters: filters
      };
    }

    const columns: CsvColumn<StockMovement>[] = [
      { header: "Tarih", accessor: m => formatDateForCsv(m.timestamp) },
      { header: "Ürün Adı", accessor: m => m.productName },
      { header: "Hareket Tipi", accessor: m => m.type },
      { header: "Miktar", accessor: m => formatQtyForCsv(m.quantity) },
      { header: "Birim", accessor: m => m.unit || "Adet" },
      { header: "Depo ID", accessor: m => m.warehouseId || "Ana Depo" },
      { header: "Referans", accessor: m => `${m.referenceType || ''} ${m.referenceId || ''}`.trim() || "-" },
      { header: "Notlar", accessor: m => m.notes || "" }
    ];

    return {
      fileName,
      mimeType: "text/csv;charset=utf-8;",
      content: generateCsvWithBom(items, columns),
      recordCount: items.length,
      domain: "stock_movements",
      tenantId: context.tenantId,
      exportedAt,
      appliedFilters: filters
    };
  }

  /**
   * 12. Full Tenant Backup Archive
   * Future-proof abstraction capable of export/import across Firebase, Supabase/PostgreSQL, or local storage.
   */
  async createTenantBackup(uid: string): Promise<TenantBackupArchive> {
    const context = await this.getVerifiedTenantContext(uid);

    // Parallel fetch of all business domains
    const [products, customers, suppliers, sales, warehouses, orders, payments, movements] = await Promise.all([
      repositories.products.getAll(uid, true),
      repositories.customers.getAll(uid),
      repositories.suppliers.getAll(uid),
      repositories.sales.getAll(uid),
      getWarehouses(uid),
      getOrders(uid),
      getPayments(uid),
      getStockMovements(uid)
    ]);

    // Enforce strict multi-tenant isolation and sanitize secrets
    const tenantProducts = enforceTenantIsolation(products, context.tenantId, uid);
    const tenantCustomers = enforceTenantIsolation(customers, context.tenantId, uid);
    const tenantSuppliers = enforceTenantIsolation(suppliers, context.tenantId, uid);
    const tenantSales = enforceTenantIsolation(sales, context.tenantId, uid);
    const tenantWarehouses = enforceTenantIsolation(warehouses, context.tenantId, uid);
    const tenantOrders = enforceTenantIsolation(orders, context.tenantId, uid);
    const tenantPayments = enforceTenantIsolation(payments, context.tenantId, uid);
    const tenantMovements = enforceTenantIsolation(movements, context.tenantId, uid);

    const exportedAt = new Date().toISOString();
    const totalCount = 
      tenantProducts.length + 
      tenantCustomers.length + 
      tenantSuppliers.length + 
      tenantSales.length + 
      tenantWarehouses.length + 
      tenantOrders.length + 
      tenantPayments.length + 
      tenantMovements.length;

    const metadata: TenantBackupMetadata = {
      schemaVersion: "2.1.0",
      tenantId: context.tenantId,
      userId: uid,
      companyName: context.tenant?.name || "İşletme",
      exportedAt,
      appVersion: "StokPro-SaaS-2.1",
      checksum: "",
      itemCounts: {
        products: tenantProducts.length,
        customers: tenantCustomers.length,
        suppliers: tenantSuppliers.length,
        sales: tenantSales.length,
        warehouses: tenantWarehouses.length,
        orders: tenantOrders.length,
        payments: tenantPayments.length,
        stockMovements: tenantMovements.length
      }
    };

    const data = {
      products: tenantProducts,
      customers: tenantCustomers,
      suppliers: tenantSuppliers,
      sales: tenantSales,
      warehouses: tenantWarehouses,
      orders: tenantOrders,
      payments: tenantPayments,
      stockMovements: tenantMovements
    };

    // Calculate cryptographic SHA-256 digest over canonical structure (excluding checksum)
    metadata.checksum = await calculateBackupChecksum({ metadata, data });

    return {
      metadata,
      data
    };
  }

  /**
   * Export the full tenant backup archive as a downloadable JSON file.
   */
  async exportFullTenantBackup(uid: string): Promise<ExportResult> {
    const backup = await this.createTenantBackup(uid);
    const content = JSON.stringify(backup, null, 2);
    const fileName = this.buildFileName("tam_isletme_yedegi", "json");

    await this.auditExport(uid, "full_backup", Object.values(backup.metadata.itemCounts).reduce((a, b) => a + b, 0), "json");

    return {
      fileName,
      mimeType: "application/json;charset=utf-8;",
      content,
      recordCount: Object.values(backup.metadata.itemCounts).reduce((a, b) => a + b, 0),
      domain: "full_backup",
      tenantId: backup.metadata.tenantId,
      exportedAt: backup.metadata.exportedAt
    };
  }

  /**
   * Comprehensive validation logic for backup archives with real SHA-256 verification
   */
  async validateBackupArchive(archive: any, expectedTenantId: string): Promise<BackupValidationResult> {
    if (!archive || typeof archive !== "object") {
      return { isValid: false, error: "Geçersiz dosya yapısı: Yedek geçerli bir JSON nesnesi içermiyor." };
    }
    if (!archive.metadata || typeof archive.metadata !== "object") {
      return { isValid: false, error: "Geçersiz yedek: Üstveri (metadata) bloğu bulunamadı." };
    }
    if (!archive.data || typeof archive.data !== "object") {
      return { isValid: false, error: "Geçersiz yedek: Veri (data) bloğu bulunamadı." };
    }

    const meta = archive.metadata;
    if (!meta.schemaVersion || typeof meta.schemaVersion !== "string") {
      return { isValid: false, error: "Geçersiz şema sürümü: Yedek şema sürüm bilgisi eksik." };
    }

    // Supported major schema versions: "2.x.x" or "1.x.x"
    const majorVersion = meta.schemaVersion.split(".")[0];
    if (majorVersion !== "2" && majorVersion !== "1") {
      return { 
        isValid: false, 
        error: `Desteklenmeyen şema sürümü (${meta.schemaVersion}). Yalnızca StokPro 1.x ve 2.x yedekleri desteklenir.` 
      };
    }

    if (!meta.tenantId) {
      return { isValid: false, error: "Yedek dosyasında şirket (tenantId) bilgisi tanımlanmamış." };
    }

    // Tenant Isolation Guard: ensure backup belongs to current active company
    if (meta.tenantId !== expectedTenantId) {
      return { 
        isValid: false, 
        error: `Güvenlik İhlali: Bu yedek başka bir şirkete ait (${meta.tenantId}). Kendi şirketiniz (${expectedTenantId}) dışındaki yedekler yüklenemez.` 
      };
    }

    // Integrity Check: Real cryptographic SHA-256 digest validation
    const checksumVerif = await verifyBackupChecksum(archive);
    if (!checksumVerif.valid) {
      return {
        isValid: false,
        error: checksumVerif.reason || "Bütünlük Hatası: Yedek dosyasında dijital bütünlük imzası (checksum) geçersiz veya uyuşmuyor."
      };
    }

    const data = archive.data;
    const requiredDomains: (keyof TenantBackupArchive["data"])[] = [
      "products",
      "customers",
      "suppliers",
      "sales",
      "warehouses",
      "orders",
      "payments",
      "stockMovements"
    ];

    const warnings: string[] = [];

    if (checksumVerif.isLegacy && checksumVerif.reason) {
      warnings.push(checksumVerif.reason);
    }

    for (const domain of requiredDomains) {
      if (data[domain] !== undefined && !Array.isArray(data[domain])) {
        return { isValid: false, error: `Veri biçimi hatası: '${domain}' koleksiyonu bir dizi (array) olmalıdır.` };
      }
      
      // Check count mismatch with metadata if provided
      if (meta.itemCounts && meta.itemCounts[domain] !== undefined) {
        const actualCount = data[domain]?.length || 0;
        if (meta.itemCounts[domain] !== actualCount) {
          warnings.push(`'${domain}' koleksiyonunda sayaç uyuşmazlığı tespit edildi (Metadata: ${meta.itemCounts[domain]}, Gerçek: ${actualCount}).`);
        }
      }
    }

    const totalRecords = requiredDomains.reduce((sum, key) => sum + (Array.isArray(data[key]) ? data[key].length : 0), 0);

    return {
      isValid: true,
      archive: archive as TenantBackupArchive,
      warnings: warnings.length > 0 ? warnings : undefined,
      totalRecords,
      itemCounts: meta.itemCounts || {
        products: data.products?.length || 0,
        customers: data.customers?.length || 0,
        suppliers: data.suppliers?.length || 0,
        sales: data.sales?.length || 0,
        warehouses: data.warehouses?.length || 0,
        orders: data.orders?.length || 0,
        payments: data.payments?.length || 0,
        stockMovements: data.stockMovements?.length || 0
      },
      schemaVersion: meta.schemaVersion,
      sourceTenantId: meta.tenantId,
      companyName: meta.companyName,
      exportedAt: meta.exportedAt,
      checksumType: checksumVerif.isLegacy ? "legacy" : "sha256",
      isLegacy: Boolean(checksumVerif.isLegacy),
      calculatedChecksum: checksumVerif.actual
    };
  }

  /**
   * Parses raw file content, runs pre-flight validation and extracts counts for UI preview
   */
  async previewBackupFile(fileContent: string, currentTenantId: string): Promise<BackupValidationResult> {
    if (!fileContent || !fileContent.trim()) {
      return { isValid: false, error: "Yedek dosyası boş." };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(fileContent);
    } catch (e: any) {
      return { isValid: false, error: "Dosya geçerli bir JSON formatında değil." };
    }

    return await this.validateBackupArchive(parsed, currentTenantId);
  }

  /**
   * Restores a full tenant backup into the database with multi-tenant enforcement, 
   * historical userId preservation, deterministic IDs and safe non-destructive conflict handling.
   */
  async restoreTenantBackup(
    uid: string, 
    archive: TenantBackupArchive, 
    options: RestoreBackupOptions
  ): Promise<RestoreExecutionResult> {
    const context = await this.getVerifiedTenantContext(uid);
    const tenantId = context.tenantId;

    // RBAC: strictly owner or admin can perform backup restoration
    if (context.role !== "owner" && context.role !== "admin") {
      throw new Error("Yetkilendirme Hatası: Yedekten geri yükleme işlemi yalnızca 'owner' veya 'admin' yetkisine sahip kullanıcılar tarafından yapılabilir.");
    }

    // Validate archive strictly against the authenticated caller's tenant
    const validation = await this.validateBackupArchive(archive, tenantId);
    if (!validation.isValid) {
      throw new Error(validation.error || "Yedek bütünlük doğrulaması başarısız.");
    }

    // Require explicit confirmation for unverified legacy backups
    if (validation.isLegacy && !options.allowLegacyUnverified) {
      throw new Error(
        "Kriptografik Bütünlük Koruması: Bu yedek dosyası eski formatlıdır ve SHA-256 kriptografik özetiyle mühürlenmemiştir. " +
        "Yedek içeriğinin bozulmamış veya tahrif edilmemiş olduğunu sistem kesin olarak garanti edemez. " +
        "Yüklemeye devam etmek için 'Doğrulanmamış Eski Yedeği Yükle' onayı verilmelidir."
      );
    }

    const isDemo = isDemoUser(uid);
    const mode = options.mode || "safe_append";
    const errors: string[] = [];

    const restoredCounts: Record<keyof TenantBackupArchive["data"], number> = {
      products: 0,
      customers: 0,
      suppliers: 0,
      sales: 0,
      warehouses: 0,
      orders: 0,
      payments: 0,
      stockMovements: 0
    };

    const skippedCounts: Record<keyof TenantBackupArchive["data"], number> = {
      products: 0,
      customers: 0,
      suppliers: 0,
      sales: 0,
      warehouses: 0,
      orders: 0,
      payments: 0,
      stockMovements: 0
    };

    const conflictCounts: Record<keyof TenantBackupArchive["data"], number> = {
      products: 0,
      customers: 0,
      suppliers: 0,
      sales: 0,
      warehouses: 0,
      orders: 0,
      payments: 0,
      stockMovements: 0
    };

    const totalRecords = validation.totalRecords || 0;
    let processedTotal = 0;

    const report = (msg: string) => {
      if (options.onProgress) {
        options.onProgress(processedTotal, totalRecords, msg);
      }
    };

    report("Geri yükleme başlatılıyor, yetkiler doğrulandı...");

    // Helper: sanitize record, seal tenantId, preserve historical userId if present
    const sanitizeAndTagRecord = <T extends Record<string, any>>(record: T, collName: string, docId: string): T => {
      const sanitized = sanitizeRecord(record);
      return {
        ...sanitized,
        id: docId,
        tenantId, // Force active tenantId, never trust file
        // Preserve original userId to maintain historical audit trails & rules compliance; assign restoring uid only if missing:
        userId: (record.userId && typeof record.userId === "string" && record.userId.trim()) ? record.userId.trim() : uid,
        restoredAt: new Date().toISOString()
      };
    };

    // -------------------------------------------------------------
    // DEMO / LOCAL STORAGE MODE
    // -------------------------------------------------------------
    if (isDemo) {
      report("Demo ortamında veri paketleri ayrıştırılıyor...");

      const demoErrors: string[] = [];
      const demoKeys: Record<keyof TenantBackupArchive["data"], string> = {
        products: "stokpro_demo_products",
        customers: "stokpro_demo_customers",
        suppliers: "stokpro_demo_suppliers",
        sales: "stokpro_demo_sales",
        warehouses: "stokpro_demo_warehouses",
        orders: "stokpro_demo_orders",
        payments: "stokpro_demo_payments",
        stockMovements: "stokpro_demo_stock_movements"
      };

      for (const domain of Object.keys(demoKeys) as (keyof TenantBackupArchive["data"])[]) {
        const rawItems = archive.data[domain] || [];
        const localKey = demoKeys[domain];

        let existing: any[] = [];
        try {
          if (typeof localStorage !== "undefined") {
            existing = JSON.parse(localStorage.getItem(localKey) || "[]");
          }
        } catch {
          existing = [];
        }

        const existingMap = new Map<string, any>();
        existing.forEach(item => {
          if (item.id) existingMap.set(item.id, item);
        });

        const isFinancialOrMovement = (domain === "sales" || domain === "payments" || domain === "stockMovements" || domain === "orders");
        const batchLimit = options.__testBatchSize || 400;
        let batchIndex = 0;

        for (let b = 0; b < rawItems.length; b += batchLimit) {
          const chunk = rawItems.slice(b, b + batchLimit);
          const currentBatchIdx = batchIndex++;

          // Internal controlled test hook for partial failure simulation
          if (options.__testBatchFailureHook && options.__testBatchFailureHook(currentBatchIdx, domain)) {
            demoErrors.push(`${domain} grubunda (Batch ${currentBatchIdx + 1}) yazım hatası simüle edildi (${chunk.length} kayıt)`);
            continue;
          }

          for (let idx = 0; idx < chunk.length; idx++) {
            const item = chunk[idx];
            const globalIdx = b + idx;
            const docId = await generateDeterministicDocId(tenantId, domain, item, globalIdx);
            const exists = existingMap.has(docId);

            if (exists) {
              conflictCounts[domain]++;
              // Safe policy: Default "safe_append" never overwrites; financial & movements NEVER overwritten!
              if (mode === "safe_append" || isFinancialOrMovement) {
                skippedCounts[domain]++;
                continue;
              }

              // merge_non_financial for catalog items (products, customers, suppliers, warehouses)
              const existingItem = existingMap.get(docId);
              const merged = {
                ...existingItem,
                ...sanitizeAndTagRecord(item, domain, docId),
                // preserve creation userId
                userId: existingItem.userId || (item as any)?.userId || uid
              };
              existingMap.set(docId, merged);
              restoredCounts[domain]++;
            } else {
              // New record
              const newItem = sanitizeAndTagRecord(item, domain, docId);
              existingMap.set(docId, newItem);
              restoredCounts[domain]++;
            }

            processedTotal++;
          }

          const updatedList = Array.from(existingMap.values());
          if (typeof localStorage !== "undefined") {
            localStorage.setItem(localKey, JSON.stringify(updatedList));
          }
        }

        report(`${domain}: ${restoredCounts[domain]} yeni eklendi, ${skippedCounts[domain]} mevcut korundu...`);
      }

      memoryCache.clear();

      await logAuditEvent(uid, {
        action: "IMPORT_PROCESSED",
        entityType: "backup",
        entityId: `restore_${Date.now()}`,
        companyId: tenantId,
        details: {
          type: "TENANT_BACKUP_RESTORE",
          mode,
          restoredCounts,
          skippedCounts,
          conflictCounts,
          total: totalRecords,
          demo: true,
          errorCount: demoErrors.length
        }
      });

      return {
        success: demoErrors.length === 0,
        tenantId,
        mode,
        restoredCounts,
        totalRestored: Object.values(restoredCounts).reduce((a, b) => a + b, 0),
        skippedCounts,
        conflictCounts,
        totalSkipped: Object.values(skippedCounts).reduce((a, b) => a + b, 0),
        errors: demoErrors,
        restoredAt: new Date().toISOString(),
        checkpointFingerprint: archive.metadata.checksum
      };
    }

    // -------------------------------------------------------------
    // REAL FIRESTORE MODE (BATCHED SAFE RESTORE & CONFLICT AWARE)
    // -------------------------------------------------------------
    const collectionsToRestore: { key: keyof TenantBackupArchive["data"]; coll: string }[] = [
      { key: "warehouses", coll: "warehouses" },
      { key: "products", coll: "products" },
      { key: "customers", coll: "customers" },
      { key: "suppliers", coll: "suppliers" },
      { key: "sales", coll: "sales" },
      { key: "orders", coll: "orders" },
      { key: "payments", coll: "payments" },
      { key: "stockMovements", coll: "stock_movements" }
    ];

    const BATCH_LIMIT = 400; // safe margin below 500

    for (const { key, coll } of collectionsToRestore) {
      const items = archive.data[key] || [];
      if (items.length === 0) continue;

      report(`${coll} inceleniyor (${items.length} kayıt)...`);

      // 1. Pre-fetch existing document IDs for this tenant in this collection to protect existing data
      const existingIdSet = new Set<string>();
      try {
        const existingSnap = await getDocs(query(collection(db, coll), where("tenantId", "==", tenantId)));
        existingSnap.forEach(d => existingIdSet.add(d.id));
      } catch (err: any) {
        console.warn(`Could not pre-fetch existing IDs for ${coll}:`, err);
      }

      // Filter items according to safe conflict resolution policy
      const itemsToCommit: { docId: string; data: any }[] = [];
      const isFinancialOrMovement = (key === "sales" || key === "payments" || key === "stockMovements" || key === "orders");

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const docId = await generateDeterministicDocId(tenantId, coll, item, idx);
        const exists = existingIdSet.has(docId);

        if (exists) {
          conflictCounts[key]++;
          // Under safe_append mode or for financial/movement collections, NEVER overwrite active records!
          if (mode === "safe_append" || isFinancialOrMovement) {
            skippedCounts[key]++;
            processedTotal++;
            continue;
          }
          // Non-financial merge
          itemsToCommit.push({
            docId,
            data: sanitizeAndTagRecord(item, coll, docId)
          });
        } else {
          // Brand new record
          itemsToCommit.push({
            docId,
            data: sanitizeAndTagRecord(item, coll, docId)
          });
          existingIdSet.add(docId); // mark added for subsequent records
        }
      }

      // Write in batches of BATCH_LIMIT
      const batchLimit = options.__testBatchSize || BATCH_LIMIT;
      let batchIdx = 0;
      for (let i = 0; i < itemsToCommit.length; i += batchLimit) {
        const chunk = itemsToCommit.slice(i, i + batchLimit);
        const currentBatchIdx = batchIdx++;

        // Controlled test hook for simulating partial batch commit failure
        if (options.__testBatchFailureHook && options.__testBatchFailureHook(currentBatchIdx, coll)) {
          errors.push(`${coll} grubunda (Batch ${currentBatchIdx + 1}) kontrollü test hatası simüle edildi (${chunk.length} kayıt)`);
          continue;
        }

        const batch = writeBatch(db);

        for (const { docId, data } of chunk) {
          const docRef = doc(db, coll, docId);
          batch.set(docRef, data, { merge: true });
        }

        try {
          await batch.commit();
          restoredCounts[key] += chunk.length;
          processedTotal += chunk.length;
          report(`${coll}: ${restoredCounts[key]} / ${itemsToCommit.length} aktarıldı...`);
        } catch (err: any) {
          console.error(`Restore error on ${coll} chunk:`, err);
          errors.push(`${coll} grubunda yazım hatası (${chunk.length} kayıt): ${err.message}`);
        }
      }
    }

    memoryCache.clear();

    const restoredAt = new Date().toISOString();
    const totalRestored = Object.values(restoredCounts).reduce((a, b) => a + b, 0);
    const totalSkipped = Object.values(skippedCounts).reduce((a, b) => a + b, 0);

    // Audit Log for the entire restore event
    try {
      await logAuditEvent(uid, {
        action: "IMPORT_PROCESSED",
        entityType: "backup",
        entityId: `restore_${Date.now()}`,
        companyId: tenantId,
        details: {
          type: "TENANT_BACKUP_RESTORE",
          mode,
          restoredCounts,
          skippedCounts,
          conflictCounts,
          totalRestored,
          totalSkipped,
          errorCount: errors.length
        }
      });
    } catch (e) {
      console.warn("Audit logging failed silently for restore:", e);
    }

    return {
      success: errors.length === 0,
      tenantId,
      mode,
      restoredCounts,
      totalRestored,
      skippedCounts,
      conflictCounts,
      totalSkipped,
      errors,
      restoredAt,
      checkpointFingerprint: archive.metadata.checksum
    };
  }
}

export const exportService = new DataExportService();
