/** One CSV cell. Quotes are doubled, and a leading = + - @ is neutralised so spreadsheets never run it as a formula. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

/** Saves text as a file in the browser (UTF-8 with BOM so Excel reads ₹ and names correctly). */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
