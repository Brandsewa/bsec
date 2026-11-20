/**
 * CSV cell helpers for the admin exports.
 *
 * `quoteCsv` only quotes. Use it for numeric columns, where a leading "-" is a real sign, not a formula.
 * `escapeCsv` is for free text: a cell starting with = + - @ (or tab/CR) is run as a formula by Excel, Sheets and
 * LibreOffice (CSV injection, SEC-005), so it gets a single-quote prefix.
 */
export function quoteCsv(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  return quoteCsv(/^[=+\-@\t\r]/.test(str) ? `'${str}` : str);
}
