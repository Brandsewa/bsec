#!/usr/bin/env node
// AGENTS.md rule 10: migrations are append-only. An applied migration must never change, because the migrator records
// that a file ran, not what it contained, so an edited file leaves databases that ran the old text different from a new
// one built from the new text, and nothing reports it (audit A10-01).
//
//   node scripts/check-migrations-immutable.mjs           verify (also run by `pnpm docs:check`)
//   node scripts/check-migrations-immutable.mjs --write   record the checksums of NEW migration files
//
// A file already in the lock must keep the same SHA-256 (line endings are ignored so Windows checkouts agree).
// A new file is allowed and is only reported; --write adds it. Recording is by design a deliberate step in the same
// commit that adds the migration, so the lock never contains a file that was changed after it was recorded.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "packages/db/migrations");
const lockFile = path.join(dir, "checksums.json");

const hash = (file) => createHash("sha256").update(readFileSync(path.join(dir, file), "utf8").replace(/\r\n/g, "\n")).digest("hex");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const lock = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, "utf8")) : {};

if (process.argv.includes("--write")) {
  let added = 0;
  for (const f of files) {
    if (!(f in lock)) {
      lock[f] = hash(f);
      added++;
    }
  }
  const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(lockFile, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`migrations lock: ${added} file(s) recorded, ${Object.keys(sorted).length} total`);
  process.exit(0);
}

const problems = [];
for (const [f, recorded] of Object.entries(lock)) {
  if (!files.includes(f)) problems.push(`${f} was recorded but is gone (a migration must never be deleted)`);
  else if (hash(f) !== recorded) problems.push(`${f} changed after it was recorded (a migration must never be edited; add a new one)`);
}
const unrecorded = files.filter((f) => !(f in lock));

if (problems.length) {
  console.error("migrations are append-only (AGENTS.md rule 10):\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`migrations lock ok (${Object.keys(lock).length} recorded${unrecorded.length ? `, ${unrecorded.length} new: run with --write to record them` : ""})`);
