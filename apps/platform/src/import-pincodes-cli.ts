/**
 * Operator tool: loads the India Post pincode directory (CSV with pincode and state columns) for the State Pricing
 * app's manual mode. Safe to re-run.
 *   DATABASE_URL_PLATFORM=... tsx src/import-pincodes-cli.ts path/to/pincodes.csv
 */
import { readFile } from "node:fs/promises";
import { createRuntime, importPincodeDirectory, parsePincodeCsv } from "@bs/domain";

const url = process.env.DATABASE_URL_PLATFORM;
if (!url) throw new Error("Missing env DATABASE_URL_PLATFORM");
const file = process.argv[2];
if (!file) throw new Error("Usage: import-pincodes-cli.ts <file.csv>");

const parsed = parsePincodeCsv(await readFile(file, "utf8"));
const rt = createRuntime({ service: "platform", databaseUrl: url, poolMax: 1 });
try {
  const res = await importPincodeDirectory(rt, parsed.rows);
  console.log(`Imported ${res.imported} pincodes. Skipped ${parsed.skipped.length} rows.`);
  for (const s of parsed.skipped.slice(0, 20)) console.log(`  line ${s.line}: ${s.reason}`);
} finally {
  await rt._db.close();
}
