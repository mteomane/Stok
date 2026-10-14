/**
 * CSV Formatting Utility with UTF-8 BOM for Seamless Excel / Google Sheets compatibility
 */

export interface CsvColumn<T> {
  header: string;
  accessor: (item: T) => string | number | boolean | null | undefined;
}

/**
 * Sanitizes a CSV cell against Formula Injection (CSV Injection / CWE-1236).
 * Prepends a single quote (') if the value starts with dangerous formula triggers
 * (=, +, -, @) or control characters (\t, \r, \n) that could be interpreted
 * as formulas or dynamic data exchange (DDE) commands by spreadsheet software (Excel, Calc).
 *
 * Normal values (e.g. "ABC Textile", 12345, "Mavi Kumaş", "Kumaş-001") remain unchanged.
 */
export function sanitizeCsvCell(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }
  const str = String(value);
  if (str.length === 0) {
    return "";
  }

  // Dangerous triggers at the start of a cell: '=', '+', '-', '@'
  // Or leading control characters (TAB, CR, LF) used to bypass filters (e.g. '\t=SUM(A1:A2)')
  const dangerousFormulaRegex = /^[\s\t\r\n]*[=+\-@]/;
  const controlCharRegex = /^[\t\r\n]/;

  if (dangerousFormulaRegex.test(str) || controlCharRegex.test(str)) {
    return `'${str}`;
  }

  return str;
}

/**
 * Escapes a cell according to RFC 4180 standards and formula injection security.
 * First sanitizes against CSV injection, then wraps values in quotes if they contain
 * delimiters (comma, semicolon), newlines, or quotes.
 */
export function escapeCsvCell(value: any): string {
  if (value === null || value === undefined) {
    return "";
  }
  const sanitized = sanitizeCsvCell(value);
  if (
    sanitized.includes(",") || 
    sanitized.includes(";") || 
    sanitized.includes('"') || 
    sanitized.includes("\n") || 
    sanitized.includes("\r")
  ) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

/**
 * Converts a list of records to CSV string with UTF-8 BOM prefix.
 * UTF-8 BOM (\uFEFF) instructs Excel to read characters like Turkish characters (ş, ğ, ı, ö, ç, İ) properly.
 */
export function generateCsvWithBom<T>(
  data: T[],
  columns: CsvColumn<T>[],
  delimiter: string = ";"
): string {
  const headerRow = columns.map(col => escapeCsvCell(col.header)).join(delimiter);
  const dataRows = data.map(item => {
    return columns.map(col => escapeCsvCell(col.accessor(item))).join(delimiter);
  });

  // \uFEFF is the UTF-8 Byte Order Mark
  return "\uFEFF" + [headerRow, ...dataRows].join("\r\n");
}

/**
 * Formats monetary amounts for clean Excel usage (e.g. 1250.50)
 */
export function formatNumberForCsv(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return "0";
  return Number(num).toFixed(2);
}

/**
 * Formats physical inventory quantities for CSV/Excel without losing precision
 * (e.g. 12.375 kg remains 12.375, 50 remains 50).
 */
export function formatQtyForCsv(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return "0";
  const rounded = Math.round((Number(num) + Number.EPSILON) * 1000) / 1000;
  return String(rounded);
}

/**
 * Formats ISO dates to readable Turkish format (DD.MM.YYYY HH:mm)
 */
export function formatDateForCsv(isoString: string | undefined | null): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return String(isoString);
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return String(isoString);
  }
}
