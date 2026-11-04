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
import { logAuditEvent, roundQty } from "../firestoreService";
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
   * Generates and downloads the dedicated Textile & Fabric Roll Excel/CSV template.
   * Strict Column Order:
   * 1. Ürün Adı, 2. Renk Kodu, 3. Renk, 4. Metre, 5. Adet, 6. Tarih, 7. Gelen Firma
   * Contains the verified 16-row sample totaling 16 rolls and 300.70 meters.
   */
  downloadTextileRollTemplateXlsx(): void {
    const headers = [
      "Ürün Adı",
      "Renk Kodu",
      "Renk",
      "Metre",
      "Adet",
      "Tarih",
      "Gelen Firma"
    ];

    // 16 rows of identical fabric product and color, exactly totaling 300.70 meters:
    const sample16Rolls = [
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "18,50", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "19,20", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "20,00", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "17,80", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "22,10", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "16,40", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "19,90", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "21,30", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "18,00", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "20,50", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "15,60", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "19,40", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "23,00", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "17,50", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "16,20", 1, "2026-11-01", "Akar Tekstil"],
      ["Viskon Keten Kumaş", "RK-101", "İndigo Mavi", "15,30", 1, "2026-11-01", "Akar Tekstil"],
    ];

    const escapeCsv = (val: any) => {
      const str = String(val ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes(";")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvContent = "\uFEFF" + [headers, ...sample16Rolls]
      .map(row => row.map(escapeCsv).join(";"))
      .join("\r\n");

    triggerFileDownload(
      csvContent, 
      "stokpro_tekstil_kumas_rulo_sablonu.csv", 
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

      // 8. TEKSTİL RULO ALANLARI:
      // Renk Kodu
      if (norm === "renk kodu" || norm === "renkkodu" || norm === "color code" || norm === "colorcode" || norm.includes("renk kod")) {
        return { excelColumn: header, targetField: "colorCode" };
      }

      // Renk Adı
      if (norm === "renk" || norm === "renk adi" || norm === "color" || norm === "colour") {
        return { excelColumn: header, targetField: "colorName" };
      }

      // Metre (Tek Rulonun Metresi)
      if (norm === "metre" || norm === "metraj" || norm === "uzunluk" || norm === "length" || norm.includes("rulo metre")) {
        return { excelColumn: header, targetField: "metre" };
      }

      // Adet (Aynı Metredeki Fiziksel Rulo Adedi)
      if (norm === "adet" || norm === "rulo adedi" || norm === "top adedi" || norm === "top adet" || norm === "rulo adet") {
        return { excelColumn: header, targetField: "adet" };
      }

      // Tarih (Giriş Tarihi)
      if (norm === "tarih" || norm === "giris tarihi" || norm === "date") {
        return { excelColumn: header, targetField: "entryDate" };
      }

      // Gelen Firma / Tedarikçi
      if (norm.includes("gelen firma") || norm.includes("tedarikci") || norm === "firma" || norm === "supplier") {
        return { excelColumn: header, targetField: "supplier" };
      }

      // 9. Stok / Güncel Miktar (Genel ürünler için)
      if (norm.includes("guncel stok") || norm.includes("stok") || norm === "miktar" || norm === "stock") {
        return { excelColumn: header, targetField: "stock" };
      }

      // 10. Minimum Stok
      if (norm.includes("min stok") || norm.includes("minimum stok") || norm.includes("min stock") || norm.includes("kritik stok")) {
        return { excelColumn: header, targetField: "minStock" };
      }

      // 11. Birim
      if (norm === "birim" || norm === "unit" || norm.includes("olcu birimi")) {
        return { excelColumn: header, targetField: "unit" };
      }

      // 12. Açıklama
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
      let colorCode = "";
      let colorName = "";
      let metreVal = 0;
      let adetVal = 1;
      let entryDate = "";
      let supplier = "";
      const dynamicAttributes: Record<string, string> = {};

      const isTextileFile = Array.from(colIndexToMapping.values()).some(
        m => m.targetField === "metre" || m.targetField === "colorCode" || m.targetField === "colorName"
      );

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
        else if (m.targetField === "colorCode") colorCode = valStr;
        else if (m.targetField === "colorName") colorName = valStr;
        else if (m.targetField === "entryDate") entryDate = valStr;
        else if (m.targetField === "supplier") supplier = valStr;
        else if (m.targetField === "metre") {
          const parsed = parseFloat(valStr.replace(",", "."));
          if (isNaN(parsed) || parsed <= 0) {
            errors.push({
              rowNumber,
              field: "Metre",
              value: valStr,
              message: "Metre geçerli ve 0'dan büyük pozitif bir sayı olmalıdır."
            });
            hasError = true;
          } else {
            metreVal = parsed;
          }
        } else if (m.targetField === "adet") {
          const parsed = parseInt(valStr, 10);
          adetVal = !isNaN(parsed) && parsed > 0 ? parsed : 1;
        } else if (m.targetField === "costPrice") {
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

      // Textile rolls generation per row
      const rowRolls: any[] = [];
      if (isTextileFile && !hasError && metreVal > 0) {
        for (let k = 0; k < adetVal; k++) {
          rowRolls.push({
            id: `roll_${rowNumber}_${k}_${Math.random().toString(36).substring(2, 8)}`,
            rollNumber: `Top #${rowNumber - 1}${adetVal > 1 ? `-${k + 1}` : ""}`,
            colorCode: colorCode || undefined,
            colorName: colorName || undefined,
            color: colorName || undefined,
            initialLength: metreVal,
            length: metreVal,
            soldLength: 0,
            entryDate: entryDate || new Date().toISOString().split("T")[0],
            supplier: supplier || undefined,
            status: "available",
            createdAt: new Date().toISOString()
          });
        }
        stock = roundQty(metreVal * adetVal);
        unit = "Metre";
        category = "Kumaş / Tekstil";
        if (colorCode) dynamicAttributes.colorCode = colorCode;
        if (colorName) dynamicAttributes.color = colorName;
        if (supplier) dynamicAttributes.supplier = supplier;
      }

      // 4. DUPLICATE DETECTION:
      if (cleanBarcode) {
        if (existingBarcodes.has(cleanBarcode) || seenBarcodesInFile.has(cleanBarcode)) {
          isDuplicate = true;
          existingMatchedItem = existingItemMapByBarcode.get(cleanBarcode);
        }
        seenBarcodesInFile.add(cleanBarcode);
      }

      if (cleanSku && !isDuplicate) {
        if (existingSkus.has(cleanSku) || seenSkusInFile.has(cleanSku)) {
          isDuplicate = true;
          existingMatchedItem = existingItemMapBySku.get(cleanSku);
        }
        seenSkusInFile.add(cleanSku);
      }

      // Match by Name for textile products
      if (isTextileFile && !isDuplicate) {
        const matchedByName = existingItems.find(
          it => (it.name || "").toLowerCase().trim() === name.toLowerCase().trim()
        );
        if (matchedByName) {
          isDuplicate = true;
          existingMatchedItem = matchedByName;
        }
      }

      if (isDuplicate) {
        duplicateCount++;
      }

      // Parsed payload
      const parsedProduct: Omit<Product, "id"> = {
        name,
        sku: sku || cleanSku.toUpperCase(),
        category: category || (isTextileFile ? "Kumaş / Tekstil" : "Genel"),
        price,
        stock,
        minStock,
        unit: unit || (isTextileFile ? "Metre" : "Adet"),
        attributes: dynamicAttributes,
        metadata: {
          ...dynamicAttributes
        },
        isActive: true
      };
      if (isTextileFile && rowRolls.length > 0) {
        parsedProduct.rolls = rowRolls;
      }
      if (barcode) {
        parsedProduct.barcode = barcode;
        parsedProduct.metadata!.barcode = barcode;
      }
      if (brand) {
        (parsedProduct as any).brand = brand;
        parsedProduct.metadata!.brand = brand;
      }
      if (costPrice > 0) {
        parsedProduct.costPrice = costPrice;
      }
      if (description) {
        parsedProduct.description = description;
      }

      rowObj._parsed = parsedProduct;
      rowObj._isDuplicate = isDuplicate;
      rowObj._hasError = hasError;
      rowObj._matchedItemId = existingMatchedItem ? existingMatchedItem.id : undefined;
      rowObj._duplicateAction = options?.duplicateAction || "skip";

      previewRows.push(rowObj);
    });

    // If Textile File: consolidate preview products so all rows of the same product reflect the unified rolls & stock
    const isTextileFileActive = Array.from(colIndexToMapping.values()).some(
      m => m.targetField === "metre" || m.targetField === "colorCode" || m.targetField === "colorName"
    );

    if (isTextileFileActive) {
      const productRollsMap = new Map<string, any[]>();
      previewRows.forEach((r) => {
        if (!r._hasError && r._parsed?.rolls) {
          const key = (r._parsed.name || "").toLowerCase().trim();
          if (!productRollsMap.has(key)) {
            productRollsMap.set(key, []);
          }
          productRollsMap.get(key)!.push(...r._parsed.rolls);
        }
      });

      // Update rolls consecutive numbering and total meters
      productRollsMap.forEach((allRolls) => {
        allRolls.forEach((roll, idx) => {
          roll.rollNumber = `Top #${idx + 1}`;
        });
      });

      previewRows.forEach((r) => {
        if (!r._hasError && r._parsed) {
          const key = (r._parsed.name || "").toLowerCase().trim();
          const consolidatedRolls = productRollsMap.get(key);
          if (consolidatedRolls) {
            r._parsed.rolls = consolidatedRolls;
            r._parsed.stock = roundQty(consolidatedRolls.reduce((sum: number, roll: any) => sum + (Number(roll.length) || 0), 0));
          }
        }
      });
    }

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

    // Consolidate textile products that have rolls into single product creations
    const consolidatedInserts: Omit<Product, "id">[] = [];
    const textileProductMap = new Map<string, Omit<Product, "id">>();

    toInsertPayloads.forEach((payload) => {
      if (payload.rolls && payload.rolls.length > 0) {
        const key = (payload.name || "").toLowerCase().trim();
        if (textileProductMap.has(key)) {
          const existing = textileProductMap.get(key)!;
          const merged = [...(existing.rolls || [])];
          for (const r of payload.rolls) {
            if (!merged.some(mr => mr.id === r.id)) {
              merged.push(r);
            }
          }
          existing.rolls = merged;
          existing.stock = roundQty(merged.reduce((sum: number, r: any) => sum + (Number(r.length) || 0), 0));
        } else {
          const copy = { ...payload, rolls: [...payload.rolls] };
          textileProductMap.set(key, copy);
          consolidatedInserts.push(copy);
        }
      } else {
        consolidatedInserts.push(payload);
      }
    });

    // 1. Execute Batch Inserts using FirebaseProductRepository.batchCreate
    if (consolidatedInserts.length > 0) {
      try {
        if (domain === "products" && typeof repositories.products.batchCreate === "function") {
          const results = await repositories.products.batchCreate(
            uid, 
            consolidatedInserts, 
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
          for (let i = 0; i < consolidatedInserts.length; i += CHUNK_SIZE) {
            const chunk = consolidatedInserts.slice(i, i + CHUNK_SIZE);
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
        throw err;
      }
    }

    // 2. Execute Updates for Duplicate rows (merge rolls if textile product)
    if (toUpdatePayloads.length > 0) {
      for (const upd of toUpdatePayloads) {
        try {
          if (domain === "products") {
            const currentProd = await repositories.products.getById(upd.id, uid);
            if (currentProd && upd.data.rolls && upd.data.rolls.length > 0) {
              const existingRolls = currentProd.rolls || [];
              const mergedRolls = [...existingRolls];
              for (const newRoll of upd.data.rolls) {
                const isDuplicate = existingRolls.some(er =>
                  er.rollNumber === newRoll.rollNumber &&
                  er.initialLength === newRoll.initialLength &&
                  er.entryDate === newRoll.entryDate &&
                  er.supplier === newRoll.supplier
                );
                if (!isDuplicate) {
                  mergedRolls.push(newRoll);
                }
              }
              upd.data.rolls = mergedRolls;
              upd.data.stock = roundQty(mergedRolls.reduce((sum: number, r: any) => sum + (Number(r.length) || 0), 0));
            }
            await repositories.products.update(upd.id, upd.data, uid);
          }
          updatedItems.push(upd);
        } catch (err: any) {
          console.error(`Batch update error on ${upd.id}:`, err);
          errors.push({ rowNumber: 0, message: `Güncelleme hatası: ${err.message}` });
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
