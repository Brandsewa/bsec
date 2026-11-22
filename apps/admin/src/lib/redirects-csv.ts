/**
 * Reads a redirects CSV: `old address, new address[, type]`, one per line. A header row (a first line whose first cell is not an
 * address, such as "from" or "old url") is skipped, so a file exported from a spreadsheet works as it is. Quoted cells and
 * either comma or semicolon separators are accepted. Pure, so it is unit-tested without a browser.
 */
export interface ParsedRedirectsCsv {
  rows: Array<{ from: string; to: string; status?: string }>;
  error?: string;
}

function splitLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** Comma or semicolon, whichever appears more often outside quotes on the first line (spreadsheets in some locales use semicolons). */
function detectSeparator(line: string): string {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

const looksLikeAddress = (v: string) => v.startsWith("/") || /^https?:\/\//i.test(v);

export function parseRedirectsCsv(text: string): ParsedRedirectsCsv {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { rows: [], error: "The file is empty." };
  const sep = detectSeparator(lines[0] ?? "");
  const rows: ParsedRedirectsCsv["rows"] = [];
  for (const [i, line] of lines.entries()) {
    const [from, to, status] = splitLine(line, sep);
    if (!from || !to) {
      if (i === 0) continue;
      return { rows: [], error: `Line ${i + 1} needs an old address and a new address.` };
    }
    if (i === 0 && !looksLikeAddress(from)) continue;
    rows.push({ from, to, ...(status ? { status } : null) });
  }
  return { rows };
}
