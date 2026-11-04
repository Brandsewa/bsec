/**
 * India Post pincode directory for the State Pricing manual mode (ADR-044). The directory is platform data loaded by
 * `pnpm --filter @bs/platform import:pincodes <file.csv>`; until it is loaded every lookup returns null and the popup
 * tells the shopper the pincode could not be matched.
 */
import { eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { normalizeIndianState, stateCodeForName, type InStateCode } from "./regions.ts";

const PINCODE = /^[1-9][0-9]{5}$/;

export function isPincode(value: string): boolean {
  return PINCODE.test(value);
}

/** Pincode to state for the shopper's popup. Reads platform data, so it needs no tenant. */
export async function lookupStateByPincode(rt: Runtime, pincode: string): Promise<InStateCode | null> {
  const trimmed = pincode.trim();
  if (!isPincode(trimmed)) return null;
  const [row] = await rt._db.db
    .select({ stateCode: schema.platformInPincodes.stateCode })
    .from(schema.platformInPincodes)
    .where(eq(schema.platformInPincodes.pincode, trimmed))
    .limit(1);
  return normalizeIndianState(row?.stateCode);
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export interface PincodeParseResult {
  rows: { pincode: string; stateCode: InStateCode }[];
  skipped: { line: number; reason: string }[];
}

/**
 * Parses a pincode directory CSV. Needs a header with a pincode column and a state column ("statename", "state" or
 * "state_name", any case). Repeated pincodes (one post office each) collapse to one row; a pincode that maps to two
 * different states is skipped and reported, so a wrong price can never come from an ambiguous row.
 */
export function parsePincodeCsv(text: string): PincodeParseResult {
  const lines = text.replace(new RegExp("^" + String.fromCharCode(0xfeff)), "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = splitCsvLine(lines[0] ?? "").map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const pinCol = header.findIndex((h) => h === "pincode" || h === "postalcode" || h === "pin");
  const stateCol = header.findIndex((h) => h === "statename" || h === "state");
  if (pinCol < 0 || stateCol < 0) throw new Error("The file needs a pincode column and a state column in its first row");
  const byPin = new Map<string, InStateCode>();
  const conflicts = new Set<string>();
  const skipped: PincodeParseResult["skipped"] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i] ?? "");
    const pin = (cells[pinCol] ?? "").replace(/\.0+$/, "");
    const state = stateCodeForName(cells[stateCol]);
    if (!isPincode(pin)) {
      skipped.push({ line: i + 1, reason: `not a pincode: ${pin}` });
      continue;
    }
    if (!state) {
      skipped.push({ line: i + 1, reason: `unknown state: ${cells[stateCol] ?? ""}` });
      continue;
    }
    const seen = byPin.get(pin);
    if (seen && seen !== state) conflicts.add(pin);
    else byPin.set(pin, state);
  }
  for (const pin of conflicts) {
    byPin.delete(pin);
    skipped.push({ line: 0, reason: `pincode ${pin} appears in more than one state` });
  }
  return { rows: [...byPin].map(([pincode, stateCode]) => ({ pincode, stateCode })), skipped };
}

/**
 * Parses a pincode directory JSON: an object keyed by 6-digit pincode, each value { state, district? } (the file the
 * owner supplied from India Post, 19,586 pincodes). Rows with an empty or unknown state are skipped and reported, so a
 * pincode we cannot place never gets a guessed price.
 */
// Rows in the supplied file that are plainly wrong (799001 is Agartala, Tripura; 334002 is Bikaner, Rajasthan). Add to this
// list only after checking a pincode against India Post; the rest of the file is used as supplied.
const PINCODE_CORRECTIONS: Readonly<Record<string, InStateCode>> = { "799001": "TR", "334002": "RJ" };

export function parsePincodeJson(text: string): PincodeParseResult {
  const data = JSON.parse(text) as unknown;
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new Error("Expected an object keyed by pincode");
  const rows: PincodeParseResult["rows"] = [];
  const skipped: PincodeParseResult["skipped"] = [];
  for (const [pin, value] of Object.entries(data as Record<string, { state?: unknown }>)) {
    if (!isPincode(pin)) {
      skipped.push({ line: 0, reason: `not a pincode: ${pin}` });
      continue;
    }
    const name = typeof value?.state === "string" ? value.state : "";
    const state = stateCodeForName(name);
    if (!state) {
      skipped.push({ line: 0, reason: name ? `unknown state for ${pin}: ${name}` : `no state for ${pin}` });
      continue;
    }
    rows.push({ pincode: pin, stateCode: PINCODE_CORRECTIONS[pin] ?? state });
  }
  return { rows, skipped };
}

/** Loads parsed rows (platform role). Safe to re-run: existing pincodes are updated. */
export async function importPincodeDirectory(rt: Runtime, rows: PincodeParseResult["rows"]): Promise<{ imported: number }> {
  const db = rt._db.db;
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insert(schema.platformInPincodes)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoUpdate({ target: schema.platformInPincodes.pincode, set: { stateCode: sql`excluded.state_code` } });
  }
  return { imported: rows.length };
}
