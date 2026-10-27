import readXlsxFile from "read-excel-file/browser";
import { 
  IDataImportService, 
  ImportPreview, 
  ImportExecutionResult, 
  ImportRowError,
  ColumnMapping,
  UniversalImportOptions
} from "./types";
import { repositories } from "../repositories";
import { logAuditEvent } from "../firestoreService";
import { Product, Customer, Supplier, SectorField } from "../../types";
import { triggerFileDownload } from "./fileDownload";

export class DataImportService implements IDataImportService {
  /**
   * Universal file parser: detects XLSX or CSV and returns raw headers and rows.
   * Uses modern, safe read-excel-file parser with zero prototype pollution or ReDoS vulnerabilities.
   */
  async parseFile(file: File): Promise<{ 
    headers: string[]; 
    rows: any[][]; 
    sheetNames: string[]; 
    activeSheet: string 
  }> {
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");

    if (isExcel) {
      if (fileName.endsWith(".xls") && !fileName.endsWith(".xlsx")) {
        throw new Error(
          "Eski ikili Excel (.xls) formatı güvenlik nedeniyle desteklenmemektedir. Lütfen dosyanızı Excel'de açıp modern '.xlsx' veya '.csv' olarak kaydediniz."
        );
      }

      const sheets = await readXlsxFile(file);
      if (!sheets || sheets.length === 0) {
        throw new Error("Excel dosyasında geçerli bir çalışma sayfası (sheet) bulunamadı.");
      }

      const sheetNames = sheets.map(s => s.sheet);
      const activeSheet = sheetNames[0];
      const targetSheet = sheets[0];
      const rawRows = targetSheet?.data || [];

      if (!rawRows || rawRows.length === 0) {
        return { headers: [], rows: [], sheetNames, activeSheet };
      }

      const headers = (rawRows[0] || []).map((h: any) => String(h ?? "").trim());
      const rawDataRows = rawRows.slice(1).map(row =>
        row.map(cell => cell === null || cell === undefined ? "" : cell instanceof Date ? cell.toISOString().split("T")[0] : String(cell))
      );

      // Filter out completely blank rows
      const rows = rawDataRows.filter(r => r.some((c: string) => c.trim() !== ""));

      return { headers, rows, sheetNames, activeSheet };
    }

    // CSV / TXT fallback
    const text = await file.text();
    const parsed = this.parseCsvRows(text);
    if (parsed.length === 0) {
      return { headers: [], rows: [], sheetNames: ["CSV"], activeSheet: "CSV" };
    }

    const headers = parsed[0].map(h => h.trim());
    const rows = parsed.slice(1).filter(r => r.some(c => c.trim() !== ""));
    return { headers, rows, sheetNames: ["CSV"], activeSheet: "CSV" };
  }

  /**
   * Helper: Parses standard CSV text (handles commas, semicolons, quotes) into rows of strings.
   */
  private parseCsvRows(csvContent: string): string[][] {
    const cleanContent = csvContent.replace(/^\uFEFF/, "").trim();
    if (!cleanContent) return [];

    const lines = cleanContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length === 0) return [];

    // Detect delimiter (; or , or \t)
    const firstLine = lines[0];
    let delimiter = ",";
    if (firstLine.includes("\t")) {
      delimiter = "\t";
    } else if ((firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length) {
      delimiter = ";";
    }

    return lines.map(line => {
      const row: string[] = [];
      let inQuotes = false;
      let cell = "";

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cell += '"';
            i++; // skip escaped quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          row.push(cell.trim());
          cell = "";
        } else {
          cell += char;
        }
      }
      row.push(cell.trim());
      return row;
    });
  }

  /**
   * Generates and downloads a rich, multi-sector Excel (.xlsx) template with sample rows.
   */
  downloadProductsTemplateXlsx(customFields: SectorField[] = []): void {
    const standardHeaders = [
      "Ürün Adı *",
      "SKU (Ürün Kodu)",
      "Barkod (Opsiyonel)",
      "Marka",
      "Kategori",
      "Alış Fiyatı (₺)",
      "Satış Fiyatı (₺) *",
      "Güncel Stok *",
      "Birim",
      "Minimum Stok",
      "Açıklama"
    ];

    const customHeaders = customFields.map(f => f.label || f.key);
    const headers = [...standardHeaders, ...customHeaders];

    // Multi-sector realistic sample data
    const sampleRows = [
      [
        "Coca-Cola 330ml Kutu",
        "CC-330",
        "8690504011234",
        "Coca-Cola",
        "İçecek / Gıda",
        22.50,
        35.00,
        120,
        "Adet",
        24,
        "Klasik kutu kola (Üretici barkodlu)"
      ],
      [
        "Pamuk Poplin Kumaş (Lacivert)",
        "KMS-POPLIN-01",
        "", // BARKODSUZ!
        "Fabrika Dokuma",
        "Kumaş / Tekstil",
        110.00,
        185.00,
        350,
        "Metre",
        30,
        "Gömleklik %100 pamuk kumaş (Barkodsuz, StokPro QR uyumlu)"
      ],
      [
        "Ön Fren Balata Takımı",
        "BAL-VW-714",
        "", // BARKODSUZ!
        "Bosch",
        "Oto Yedek Parça",
        580.00,
        890.00,
        18,
        "Takım",
        4,
        "VW Golf 7 / Passat B8 1.4 TSI Uyumlu (OEM: 04E 115 561 H)"
      ],
      [
        "Yıldız Başlı Çelik Sunta Vidası 4x50",
        "VDA-450-BOX",
        "8680001928374",
        "HırdavatSan",
        "Nalbur / Hırdavat",
        45.00,
        85.00,
        400,
        "Kutu",
        50,
        "100 adetlik kutu içi vida"
      ]
    ];

    // Pad sample rows if custom fields exist
    const paddedSampleRows = sampleRows.map((row, idx) => {
      const extraCols = customFields.map((cf) => {
        if (cf.key.toLowerCase().includes("renk")) return idx === 1 ? "Lacivert" : "";
        if (cf.key.toLowerCase().includes("en")) return idx === 1 ? "150 cm" : "";
        if (cf.key.toLowerCase().includes("oem")) return idx === 2 ? "04E 115 561 H" : "";
        if (cf.key.toLowerCase().includes("arac")) return idx === 2 ? "VW Golf 7" : "";
        if (cf.key.toLowerCase().includes("skt")) return idx === 0 ? "2027-06-30" : "";
        return "";
      });
      return [...row, ...extraCols];
    });

    const escapeCsv = (val: any) => {
      const str = String(val ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes(";")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Format as Excel-compatible CSV with UTF-8 BOM (\uFEFF) and semicolon separation
    // Excel on Windows/Mac automatically opens this natively in tabular grid with Turkish characters
    const csvContent = "\uFEFF" + [headers, ...paddedSampleRows]
      .map(row => row.map(escapeCsv).join(";"))
      .join("\r\n");

    triggerFileDownload(
      csvContent, 
      "stokpro_urun_yukleme_sablonu.csv", 
      "text/csv;charset=utf-8;"
    );
  }

  /**
   * Downloads invalid/failed rows as an Excel-compatible file with an extra error reason column.
   */
  downloadFailedRowsXlsx(
    failedRows: any[], 
    headers: string[], 
    errors: ImportRowError[]
  ): void {
    const errorMap = new Map<number, string>();
    errors.forEach(e => {
      const existing = errorMap.get(e.rowNumber);
      errorMap.set(e.rowNumber, existing ? `${existing}; ${e.message}` : e.message);
    });

    const outHeaders = ["Hata Nedeni", ...headers];
    const outRows = failedRows.map((rowObj, idx) => {
      const rowNum = rowObj._rowNumber || idx + 2;
      const errorMsg = errorMap.get(rowNum) || rowObj._errorMessage || "Hatalı satır";
      const rowData = headers.map(h => rowObj[h] || "");
      return [errorMsg, ...rowData];
    });

    const escapeCsv = (val: any) => {
      const str = String(val ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes(";")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = "\uFEFF" + [outHeaders, ...outRows]
      .map(row => row.map(escapeCsv).join(";"))
      .join("\r\n");

    triggerFileDownload(
      csvContent, 
      "stokpro_hatali_satirlar.csv", 
      "text/csv;charset=utf-8;"
    );
  }

  /**
   * Automatically maps incoming Excel headers to standard product fields or dynamic sector fields.
   */
  autoDetectColumnMapping(headers: string[], customFields: SectorField[] = []): ColumnMapping[] {
    const normalize = (str: string) => 
      str.toLowerCase()
        .replace(/[*()₺]/g, "")
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/ü/g, "u")
        .replace(/ş/g, "s")
        .replace(/ö/g, "o")
        .replace(/ç/g, "c")
        .trim();

    return headers.map(header => {
      const norm = normalize(header);

      // Security block: never allow user columns to map directly to critical authorization fields
      if (norm === "tenantid" || norm === "userid" || norm === "role" || norm === "plan" || norm === "ownerid") {
        return {
          excelColumn: header,
          targetField: "_ignore"
        };
      }

      // 1. Ürün Adı
      if (norm.includes("urun adi") || norm === "urun" || norm === "ad" || norm === "adi" || norm === "name" || norm === "product name") {
        return { excelColumn: header, targetField: "name" };
      }

      // 2. SKU / Ürün Kodu
      if (norm === "sku" || norm.includes("urun kodu") || norm.includes("stok kodu") || norm === "kod" || norm === "item code") {
        return { excelColumn: header, targetField: "sku" };
      }

      // 3. Barkod
      if (norm.includes("barkod") || norm.includes("barcode") || norm.includes("ean") || norm === "gtin") {
        return { excelColumn: header, targetField: "barcode" };
      }

      // 4. Marka
      if (norm.includes("marka") || norm.includes("brand") || norm === "uretici") {
        return { excelColumn: header, targetField: "brand" };
      }

      // 5. Kategori
      if (norm.includes("kategori") || norm.includes("category") || norm === "tur" || norm === "grup") {
        return { excelColumn: header, targetField: "category" };
      }

      // 6. Alış Fiyatı
      if (norm.includes("alis fiyati") || norm.includes("maliyet") || norm.includes("cost") || norm.includes("alis")) {
        return { excelColumn: header, targetField: "costPrice" };
      }

      // 7. Satış Fiyatı
      if (norm.includes("satis fiyati") || norm.includes("fiyat") || norm === "price" || norm === "satis") {
        return { excelColumn: header, targetField: "price" };
      }

      // 8. Stok / Güncel Miktar
      if (norm.includes("guncel stok") || norm.includes("stok") || norm === "miktar" || norm === "stock" || norm === "adet") {
        return { excelColumn: header, targetField: "stock" };
      }

      // 9. Minimum Stok
      if (norm.includes("min stok") || norm.includes("minimum stok") || norm.includes("min stock") || norm.includes("kritik stok")) {
        return { excelColumn: header, targetField: "minStock" };
      }

      // 10. Birim
      if (norm === "birim" || norm === "unit" || norm.includes("olcu birimi")) {
        return { excelColumn: header, targetField: "unit" };
      }

      // 11. Açıklama
      if (norm.includes("aciklama") || norm.includes("description") || norm === "not" || norm === "detay") {
        return { excelColumn: header, targetField: "description" };
      }

      // 12. Check Custom / Dynamic Sector Fields
      const matchedCustom = customFields.find(cf => {
        const cfKeyNorm = normalize(cf.key);
        const cfLabelNorm = normalize(cf.label);
        return norm === cfKeyNorm || norm === cfLabelNorm || norm.includes(cfLabelNorm);
      });

      if (matchedCustom) {
        return {
          excelColumn: header,
          targetField: `custom:${matchedCustom.key}`,
          isCustomField: true,
          customFieldKey: matchedCustom.key,
          customFieldLabel: matchedCustom.label,
          customFieldType: matchedCustom.type
        };
      }

      // Default: create as dynamic custom field or ignore
      return {
        excelColumn: header,
        targetField: "_new_custom",
        isCustomField: true,
        customFieldKey: norm.replace(/[^a-z0-9_]/g, "_") || `col_${Date.now()}`,
        customFieldLabel: header,
        customFieldType: "text"
      };
    });
  }

  /**
   * Previews and strictly validates Excel data rows against column mappings and existing products.
   */
  previewUniversalImport(
    rawRows: any[][],
    headers: string[],
    mapping: ColumnMapping[],
    domain: "products" | "customers" | "suppliers",
    existingItems: any[],
    options?: { duplicateAction?: 'skip' | 'update' }
  ): ImportPreview {
    if (rawRows.length === 0) {
      return {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        duplicateRows: 0,
        headers,
        previewRows: [],
        errors: [{ rowNumber: 1, message: "Yüklenen dosyada işlenecek veri satırı bulunamadı." }]
      };
    }

    const errors: ImportRowError[] = [];
    const previewRows: any[] = [];
    let duplicateCount = 0;

    // Fast O(1) Lookups for duplicates in tenant
    const existingSkus = new Set(
      existingItems.map(it => (it.sku || "").toLowerCase().trim()).filter(Boolean)
    );
    const existingBarcodes = new Set(
      existingItems.map(it => (it.barcode || "").toLowerCase().trim()).filter(Boolean)
    );
    const existingItemMapBySku = new Map<string, any>(
      existingItems.filter(it => it.sku).map(it => [(it.sku || "").toLowerCase().trim(), it])
    );
    const existingItemMapByBarcode = new Map<string, any>(
      existingItems.filter(it => it.barcode).map(it => [(it.barcode || "").toLowerCase().trim(), it])
    );

    // Track within file
    const seenSkusInFile = new Set<string>();
    const seenBarcodesInFile = new Set<string>();

    // Index mapping for fast resolution
    const colIndexToMapping = new Map<number, ColumnMapping>();
    mapping.forEach(m => {
      const idx = headers.indexOf(m.excelColumn);
      if (idx !== -1) {
        colIndexToMapping.set(idx, m);
      }
    });

    rawRows.forEach((row, rIdx) => {
      const rowNumber = rIdx + 2; // Row 1 is header
      const rowObj: Record<string, any> = { _rowNumber: rowNumber };
      headers.forEach((h, hIdx) => {
        rowObj[h] = row[hIdx] !== undefined ? row[hIdx] : "";
      });

      let isDuplicate = false;
      let hasError = false;
      let existingMatchedItem: any = null;

      // Extracted field buckets
      let name = "";
      let sku = "";
      let barcode = "";
      let brand = "";
      let category = "Genel";
      let costPrice = 0;
      let price = 0;
      let stock = 0;
      let minStock = 5;
      let unit = "Adet";
      let description = "";
      const dynamicAttributes: Record<string, string> = {};

      // Map raw columns
      row.forEach((cellVal, colIdx) => {
        const m = colIndexToMapping.get(colIdx);
        if (!m || m.targetField === "_ignore") return;

        const valStr = String(cellVal ?? "").trim();

        if (m.targetField === "name") name = valStr;
        else if (m.targetField === "sku") sku = valStr;
        else if (m.targetField === "barcode") barcode = valStr;
        else if (m.targetField === "brand") brand = valStr;
        else if (m.targetField === "category") category = valStr || "Genel";
        else if (m.targetField === "unit") unit = valStr || "Adet";
        else if (m.targetField === "description") description = valStr;
        else if (m.targetField === "costPrice") {
          const parsed = parseFloat(valStr.replace(",", "."));
          costPrice = isNaN(parsed) ? 0 : parsed;
        } else if (m.targetField === "price") {
          const parsed = parseFloat(valStr.replace(",", "."));
          if (isNaN(parsed) || parsed < 0) {
            errors.push({
              rowNumber,
              field: "Satış Fiyatı",
              value: valStr,
              message: "Satış fiyatı geçerli bir pozitif sayı olmalıdır."
            });
            hasError = true;
          } else {
            price = parsed;
          }
        } else if (m.targetField === "stock") {
          const parsed = parseFloat(valStr.replace(",", "."));
          if (isNaN(parsed) || parsed < 0) {
            errors.push({
              rowNumber,
              field: "Stok",
              value: valStr,
              message: "Stok miktarı geçerli bir pozitif sayı olmalıdır."
            });
            hasError = true;
          } else {
            stock = parsed;
          }
        } else if (m.targetField === "minStock") {
          const parsed = parseFloat(valStr.replace(",", "."));
          minStock = isNaN(parsed) ? 5 : parsed;
        } else if (m.targetField.startsWith("custom:") || m.isCustomField) {
          const fieldKey = m.customFieldKey || m.targetField.replace("custom:", "");
          if (fieldKey && valStr) {
            dynamicAttributes[fieldKey] = valStr;
          }
        }
      });

      // ========================================================
      // VALIDATION RULES
      // ========================================================

      // 1. Name is mandatory
      if (!name) {
        errors.push({
          rowNumber,
          field: "Ürün Adı",
          message: "Ürün adı boş olamaz."
        });
        hasError = true;
      }

      // 2. CRITICAL RULE: BARKOD IS NEVER MANDATORY!
      // If barcode is empty, it is NOT an error.
      const cleanBarcode = barcode.trim().toLowerCase();

      // 3. SKU HANDLING:
      // If SKU is empty, auto-generate a clean, non-conflicting internal code
      let cleanSku = sku.trim().toLowerCase();
      if (!cleanSku) {
        cleanSku = `sku_${Date.now().toString(36)}_${rowNumber}`.toLowerCase();
        sku = cleanSku.toUpperCase();
      }

      // 4. DUPLICATE DETECTION:
      // Match by Barcode if provided
      if (cleanBarcode) {
        if (existingBarcodes.has(cleanBarcode) || seenBarcodesInFile.has(cleanBarcode)) {
          isDuplicate = true;
          existingMatchedItem = existingItemMapByBarcode.get(cleanBarcode);
        }
        seenBarcodesInFile.add(cleanBarcode);
      }

      // Match by SKU if provided
      if (cleanSku && !isDuplicate) {
        if (existingSkus.has(cleanSku) || seenSkusInFile.has(cleanSku)) {
          isDuplicate = true;
          existingMatchedItem = existingItemMapBySku.get(cleanSku);
        }
        seenSkusInFile.add(cleanSku);
      }

      if (isDuplicate) {
        duplicateCount++;
      }

      // Parsed payload
      const parsedProduct: Omit<Product, "id"> = {
        name,
        sku: sku || cleanSku.toUpperCase(),
        barcode: barcode || undefined,
        brand: brand || undefined,
        category: category || "Genel",
        price,
        costPrice: costPrice > 0 ? costPrice : undefined,
        stock,
        minStock,
        unit: unit || "Adet",
        description: description || undefined,
        metadata: {
          ...dynamicAttributes,
          brand,
          barcode: barcode || undefined
        },
        attributes: dynamicAttributes,
        isActive: true
      };

      rowObj._parsed = parsedProduct;
      rowObj._isDuplicate = isDuplicate;
      rowObj._hasError = hasError;
      rowObj._matchedItemId = existingMatchedItem ? existingMatchedItem.id : undefined;
      rowObj._duplicateAction = options?.duplicateAction || "skip";

      previewRows.push(rowObj);
    });

    const invalidCount = previewRows.filter(r => r._hasError).length;
    const validCount = previewRows.length - invalidCount;

    return {
      totalRows: rawRows.length,
      validRows: validCount,
      invalidRows: invalidCount,
      duplicateRows: duplicateCount,
      headers,
      previewRows,
      errors
    };
  }

  /**
   * Executes high-performance universal batch import.
   * Leverages Firestore writeBatch in chunks of 400 with real-time progress callbacks.
   */
  async executeUniversalBatchImport(
    uid: string,
    domain: "products" | "customers" | "suppliers",
    items: any[],
    options?: UniversalImportOptions
  ): Promise<ImportExecutionResult> {
    const context = await repositories.users.getOrCreateContext(uid);
    if (!context || !context.tenantId) {
      throw new Error("Güvenlik hatası: Şirket kiracı kimliği (tenantId) doğrulanamadı.");
    }

    const insertedItems: any[] = [];
    const skippedItems: any[] = [];
    const updatedItems: any[] = [];
    const errors: ImportRowError[] = [];

    const totalToProcess = items.length;
    let processedSoFar = 0;

    // Filter valid rows and sanitize
    const toInsertPayloads: Omit<Product, "id">[] = [];
    const toUpdatePayloads: { id: string; data: Partial<Product> }[] = [];

    items.forEach((rowObj) => {
      if (rowObj._hasError) {
        skippedItems.push(rowObj);
        return;
      }

      const duplicateAction = options?.duplicateAction || rowObj._duplicateAction || "skip";

      if (rowObj._isDuplicate) {
        if (duplicateAction === "skip") {
          skippedItems.push(rowObj);
          return;
        } else if (duplicateAction === "update" && rowObj._matchedItemId) {
          toUpdatePayloads.push({
            id: rowObj._matchedItemId,
            data: {
              ...rowObj._parsed,
              tenantId: context.tenantId // Enforce tenant isolation
            }
          });
          return;
        }
      }

      // Safe clean payload with enforced tenantId
      toInsertPayloads.push({
        ...rowObj._parsed,
        tenantId: context.tenantId, // Strict multi-tenant isolation
        userId: uid
      });
    });

    // 1. Execute Batch Inserts using FirebaseProductRepository.batchCreate
    if (toInsertPayloads.length > 0) {
      try {
        if (domain === "products" && typeof repositories.products.batchCreate === "function") {
          const results = await repositories.products.batchCreate(
            uid, 
            toInsertPayloads, 
            (processedChunk, totalChunk) => {
              processedSoFar += processedChunk;
              if (options?.onProgress) {
                const percent = Math.min(100, Math.round((processedSoFar / totalToProcess) * 100));
                options.onProgress(processedSoFar, totalToProcess, percent);
              }
            }
          );
          insertedItems.push(...results);
        } else {
          // Fallback chunking for customers/suppliers or without batchCreate
          const CHUNK_SIZE = 50;
          for (let i = 0; i < toInsertPayloads.length; i += CHUNK_SIZE) {
            const chunk = toInsertPayloads.slice(i, i + CHUNK_SIZE);
            await Promise.all(
              chunk.map(async (payload) => {
                if (domain === "products") await repositories.products.create(uid, payload);
                else if (domain === "customers") await repositories.customers.create(uid, payload as any);
                else if (domain === "suppliers") await repositories.suppliers.create(uid, payload as any);
                insertedItems.push(payload);
              })
            );

            processedSoFar += chunk.length;
            if (options?.onProgress) {
              const percent = Math.min(100, Math.round((processedSoFar / totalToProcess) * 100));
              options.onProgress(processedSoFar, totalToProcess, percent);
            }
          }
        }
      } catch (err: any) {
        console.error("Batch insert error:", err);
        errors.push({
          rowNumber: 0,
          message: err.message || "Toplu içe aktarma sırasında hata oluştu."
        });
      }
    }

    // 2. Execute Updates for matching duplicates (if update chosen)
    if (toUpdatePayloads.length > 0) {
      for (const item of toUpdatePayloads) {
        try {
          if (domain === "products") {
            await repositories.products.update(item.id, item.data, uid);
            updatedItems.push(item);
          }
        } catch (err: any) {
          errors.push({
            rowNumber: 0,
            message: `Ürün güncelleme hatası (#${item.id}): ${err.message}`
          });
        }
      }
    }

    // 3. Log Audit Trail
    const importedAt = new Date().toISOString();
    await logAuditEvent(uid, {
      action: "IMPORT_PROCESSED",
      entityType: "import",
      entityId: `import_${domain}_${Date.now()}`,
      companyId: context.tenantId,
      details: {
        domain,
        format: "xlsx_universal",
        tenantId: context.tenantId,
        insertedCount: insertedItems.length,
        updatedCount: updatedItems.length,
        skippedCount: skippedItems.length,
        errorsCount: errors.length
      }
    }).catch(err => console.warn("Audit log warning on universal import:", err));

    return {
      success: errors.length === 0,
      insertedCount: insertedItems.length + updatedItems.length,
      skippedCount: skippedItems.length,
      failedCount: errors.length,
      errors,
      importedAt
    };
  }

  /**
   * Backwards-compatible legacy CSV preview wrapper
   */
  previewCsvImport(
    csvContent: string, 
    domain: "products" | "customers" | "suppliers", 
    existingItems: any[]
  ): ImportPreview {
    const rows = this.parseCsvRows(csvContent);
    if (rows.length < 2) {
      return {
        totalRows: 0,
        validRows: 0,
        invalidRows: 0,
        duplicateRows: 0,
        headers: [],
        previewRows: [],
        errors: [{ rowNumber: 1, message: "CSV dosyasında en az bir başlık ve bir veri satırı bulunmalıdır." }]
      };
    }

    const headers = rows[0].map(h => h.trim());
    const dataRows = rows.slice(1);
    const mapping = this.autoDetectColumnMapping(headers);

    return this.previewUniversalImport(dataRows, headers, mapping, domain, existingItems);
  }

  /**
   * Backwards-compatible legacy executeBatchImport wrapper
   */
  async executeBatchImport(
    uid: string, 
    domain: "products" | "customers" | "suppliers", 
    items: any[]
  ): Promise<ImportExecutionResult> {
    return this.executeUniversalBatchImport(uid, domain, items);
  }
}

export const importService = new DataImportService();
