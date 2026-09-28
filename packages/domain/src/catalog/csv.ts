/**
 * Product CSV Import and Export Utilities per M2 scope.
 * Supports standard RFC 4180 CSV parsing with quoting and escaping.
 */

export interface ProductCsvRow {
  title: string;
  slug: string;
  price: number; // minor units (e.g. paise / cents)
  sku: string;
  stock: number;
  category?: string | undefined;
}

export interface CsvError {
  line: number;
  message: string;
}

export interface ParseCsvResult {
  rows: ProductCsvRow[];
  errors: CsvError[];
}

const REQUIRED_HEADERS = ["title", "slug", "price", "sku", "stock"] as const;

/**
 * Parses RFC 4180 CSV text into an array of string rows and columns.
 */
function parseCsvToMatrix(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++;
        } else {
          // Closing quote
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if (char === "\r") {
        if (nextChar === "\n") {
          i++;
        }
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else if (char === "\n") {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }

  // Push final field/row if any
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Escapes a field for CSV according to RFC 4180.
 */
function escapeCsvField(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/**
 * Parses CSV string into structured ProductCsvRows.
 */
export function parseProductCsv(csvContent: string): ParseCsvResult {
  const errors: CsvError[] = [];
  const rows: ProductCsvRow[] = [];

  const matrix = parseCsvToMatrix(csvContent.trim());
  if (matrix.length === 0) {
    return { rows: [], errors: [{ line: 1, message: "CSV content is empty" }] };
  }

  const headerRow = matrix[0] ?? [];
  const headerMap = new Map<string, number>();

  for (let i = 0; i < headerRow.length; i++) {
    const colName = headerRow[i]?.toLowerCase().trim();
    if (colName) {
      headerMap.set(colName, i);
    }
  }

  for (const required of REQUIRED_HEADERS) {
    if (!headerMap.has(required)) {
      errors.push({
        line: 1,
        message: `Missing required header: "${required}"`,
      });
    }
  }

  if (errors.length > 0) {
    return { rows: [], errors };
  }

  const titleIdx = headerMap.get("title") ?? -1;
  const slugIdx = headerMap.get("slug") ?? -1;
  const priceIdx = headerMap.get("price") ?? -1;
  const skuIdx = headerMap.get("sku") ?? -1;
  const stockIdx = headerMap.get("stock") ?? -1;
  const categoryIdx = headerMap.get("category") ?? -1;

  for (let lineNum = 2; lineNum <= matrix.length; lineNum++) {
    const row = matrix[lineNum - 1];
    if (!row || row.every((c) => !c.trim())) {
      continue; // Skip blank lines
    }

    const title = row[titleIdx] ?? "";
    const slug = row[slugIdx] ?? "";
    const rawPrice = row[priceIdx] ?? "";
    const sku = row[skuIdx] ?? "";
    const rawStock = row[stockIdx] ?? "";
    const category = categoryIdx !== -1 ? row[categoryIdx] : undefined;

    let hasRowError = false;

    if (!title.trim()) {
      errors.push({ line: lineNum, message: "Field 'title' cannot be empty" });
      hasRowError = true;
    }

    if (!sku.trim()) {
      errors.push({ line: lineNum, message: "Field 'sku' cannot be empty" });
      hasRowError = true;
    }

    const priceNum = parseFloat(rawPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      errors.push({ line: lineNum, message: "Field 'price' must be a non-negative number" });
      hasRowError = true;
    }

    const stockNum = parseInt(rawStock, 10);
    if (isNaN(stockNum) || stockNum < 0) {
      errors.push({ line: lineNum, message: "Field 'stock' must be a non-negative integer" });
      hasRowError = true;
    }

    if (!hasRowError) {
      // Convert price to minor units (e.g. 499.00 -> 49900)
      const minorPrice = Math.round(priceNum * 100);

      const productRow: ProductCsvRow = {
        title: title.trim(),
        slug: slug.trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
        price: minorPrice,
        sku: sku.trim(),
        stock: stockNum,
      };
      if (category?.trim()) {
        productRow.category = category.trim();
      }

      rows.push(productRow);
    }
  }

  return { rows: errors.length > 0 ? [] : rows, errors };
}

/**
 * Serializes an array of ProductCsvRows into an RFC 4180 compliant CSV string.
 */
export function serializeProductCsv(rows: ProductCsvRow[]): string {
  const lines: string[] = [];
  lines.push("title,slug,price,sku,stock,category");

  for (const row of rows) {
    const formattedPrice = (row.price / 100).toFixed(2);
    const categoryStr = row.category ?? "";

    const line = [
      escapeCsvField(row.title),
      escapeCsvField(row.slug),
      formattedPrice,
      escapeCsvField(row.sku),
      String(row.stock),
      escapeCsvField(categoryStr),
    ].join(",");

    lines.push(line);
  }

  return lines.join("\n");
}
