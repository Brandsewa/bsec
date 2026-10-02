#!/usr/bin/env node
// Docs freshness check (run: pnpm docs:check, also in CI).
// Fails when the repo structure on disk and the docs disagree, so docs/ARCHITECTURE.md cannot silently rot.
// It checks existence only (no prose). Zero dependencies.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const dirs = (p) => readdirSync(join(root, p)).filter((n) => statSync(join(root, p, n)).isDirectory());
const errors = [];
const fail = (m) => errors.push(m);

const arch = read("docs/ARCHITECTURE.md");

// 1. Every app and package is in the architecture map.
for (const base of ["apps", "packages"]) {
  for (const name of dirs(base)) {
    if (!existsSync(join(root, base, name, "package.json"))) continue;
    if (!arch.includes(`\`${base}/${name}\``)) fail(`docs/ARCHITECTURE.md does not mention \`${base}/${name}\` (section 3).`);
  }
}

// 2. Every migration is in the migration table.
const migrations = readdirSync(join(root, "packages/db/migrations")).filter((f) => /^\d{4}_.+\.sql$/.test(f));
for (const f of migrations) {
  const num = f.slice(0, 4);
  if (!arch.includes(`| ${num} |`)) fail(`docs/ARCHITECTURE.md migration table is missing ${f} (section 7).`);
}

// 3. Every queue is documented.
const queues = [...read("packages/db/src/queues.ts").matchAll(/name: "([a-z_.]+)"/g)].map((m) => m[1]);
for (const q of queues) if (!arch.includes(`\`${q}\``)) fail(`docs/ARCHITECTURE.md does not list queue \`${q}\` (section 11).`);

// 4. Every ADR file is in the ADR index.
const adrIndex = read("docs/adr/README.md");
for (const f of readdirSync(join(root, "docs/adr")).filter((n) => /^\d{3}-.+\.md$/.test(n))) {
  if (!adrIndex.includes(`(${f})`)) fail(`docs/adr/README.md does not link ${f}.`);
}

// 5. Every block type is documented.
const blockTypes = [...read("packages/blocks/src/registry.ts").matchAll(/^\s+type: "([A-Za-z]+)"/gm)].map((m) => m[1]);
for (const t of new Set(blockTypes)) if (!arch.includes(t)) fail(`docs/ARCHITECTURE.md does not mention block type ${t} (section 10).`);

// 6. Every store permission is documented.
const perms = [...read("packages/auth/src/index.ts").matchAll(/^\s+"([a-z]+\.[a-z]+)",$/gm)].map((m) => m[1]);
for (const p of new Set(perms)) {
  const [ns, verb] = p.split(".");
  if (!arch.includes(p) && !(arch.includes(`\`${ns}.`) && arch.includes(verb))) fail(`docs/ARCHITECTURE.md does not mention permission ${p} (section 12).`);
}

// 7. Change records: name pattern + required header fields.
const AGENTS = ["claude", "antigravity", "codex", "cursor", "copilot", "human"];
const NAME = new RegExp(String.raw`^\d{4}-\d{2}-\d{2}-(${AGENTS.join("|")})-[a-z0-9][a-z0-9-]*\.md$`);
for (const f of readdirSync(join(root, "docs/changes"))) {
  if (f === "README.md" || f === "TEMPLATE.md") continue;
  if (!NAME.test(f)) {
    fail(`docs/changes/${f}: name must be YYYY-MM-DD-<${AGENTS.join("|")}>-<slug>.md`);
    continue;
  }
  const body = read(`docs/changes/${f}`);
  for (const field of ["Date", "Agent", "Branch", "Area", "Type"]) {
    if (!new RegExp(String.raw`^- \*\*${field}:\*\* \S`, "m").test(body)) fail(`docs/changes/${f}: missing header field "- **${field}:** ...".`);
  }
  for (const h of ["## Summary", "## Verification"]) if (!body.includes(h)) fail(`docs/changes/${f}: missing "${h}" section.`);
  const agent = f.match(NAME)?.[1];
  if (agent && !new RegExp(String.raw`^- \*\*Agent:\*\* ${agent}\b`, "mi").test(body)) fail(`docs/changes/${f}: Agent field does not match the file name (${agent}).`);
}

// 8. Entry points exist and point at the rule book.
for (const [file, needle] of [["CLAUDE.md", "AGENTS.md"], ["GEMINI.md", "AGENTS.md"], [".github/copilot-instructions.md", "AGENTS.md"]]) {
  if (!existsSync(join(root, file))) fail(`${file} is missing.`);
  else if (!read(file).includes(needle)) fail(`${file} must point at ${needle}.`);
}

if (errors.length) {
  console.error(`docs:check failed (${errors.length}):\n` + errors.map((e) => `  - ${e}`).join("\n"));
  console.error("\nUpdate docs/ARCHITECTURE.md, docs/adr/README.md or docs/changes/ in the same change (AGENTS.md section 7).");
  process.exit(1);
}
console.log("docs:check ok");
