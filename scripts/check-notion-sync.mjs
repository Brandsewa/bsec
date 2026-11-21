#!/usr/bin/env node
// Notion sync check (run: pnpm notion:check -- --notion <export file>).
//
// AGENTS.md section 6 rule 7: the BCOM Platform OS in Notion must match GitHub. Notion has no automation
// on our plan, so this lists the change records (docs/changes) and ADRs (docs/adr) that have no row in
// the Notion Change Log or Decisions database, and Notion rows that point at a file that no longer exists.
//
// It never talks to Notion and needs no token. Give it any text export of the two databases
// (CSV export of the database, the JSON a Notion query returns, or a plain list). It only looks for
// repo paths of the form docs/changes/<file>.md and docs/adr/<file>.md anywhere in the text, so the
// column layout does not matter; the "Source of truth" and "Repo path" columns carry them.
//
// Exit codes: 0 in sync, 1 missing rows (or orphans with --strict), 2 bad usage. Zero dependencies.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKIP = new Set(["README.md", "TEMPLATE.md", "template.md"]);
const PATH_RE = /docs\/(changes|adr)\/([A-Za-z0-9][A-Za-z0-9._-]*\.md)/g;

/** Repo record files, as "docs/changes/<file>" and "docs/adr/<file>" (ADRs must start with NNN-). */
export function listRepoRecords(root) {
  const out = [];
  for (const dir of ["changes", "adr"]) {
    const abs = join(root, "docs", dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (SKIP.has(f) || !f.endsWith(".md")) continue;
      if (dir === "adr" && !/^\d{3}-/.test(f)) continue;
      out.push(`docs/${dir}/${f}`);
    }
  }
  return out.sort();
}

/** Every docs/changes and docs/adr path mentioned anywhere in the text. */
export function extractNotionPaths(text) {
  const found = new Set();
  for (const m of text.matchAll(PATH_RE)) {
    if (SKIP.has(m[2])) continue;
    found.add(`docs/${m[1]}/${m[2]}`);
  }
  return found;
}

/** since: optional YYYY-MM-DD, only change records on or after it count as missing. */
export function compare(repoFiles, notionPaths, { since } = {}) {
  const inRepo = new Set(repoFiles);
  const missing = repoFiles.filter((p) => {
    if (notionPaths.has(p)) return false;
    if (since && p.startsWith("docs/changes/") && p.slice("docs/changes/".length, "docs/changes/".length + 10) < since) return false;
    return true;
  });
  const orphans = [...notionPaths].filter((p) => !inRepo.has(p)).sort();
  return { missing, orphans };
}

function usage() {
  return [
    "Usage: node scripts/check-notion-sync.mjs --notion <file> [--since YYYY-MM-DD] [--strict] [--json]",
    "",
    "  --notion <file>  text export of the Notion Change Log and Decisions databases (CSV, JSON or a plain list).",
    "                   Export from Notion: open the database, ... menu, Export, CSV; do both databases into one file.",
    "                   Or ask an agent with the Notion tools to list the Source of truth column of each.",
    "  --since <date>   only count change records dated on or after this day as missing",
    "  --strict         also fail when Notion points at a file that is not in the repo (renamed or deleted)",
    "  --json           machine-readable result",
  ].join("\n");
}

function main(argv) {
  const args = { strict: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--notion") args.notion = argv[++i];
    else if (a === "--since") args.since = argv[++i];
    else if (a === "--strict") args.strict = true;
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") { console.log(usage()); return 0; }
    else { console.error(`Unknown argument: ${a}\n\n${usage()}`); return 2; }
  }
  if (!args.notion) { console.error(usage()); return 2; }
  if (!existsSync(args.notion)) { console.error(`Export file not found: ${args.notion}`); return 2; }
  if (args.since && !/^\d{4}-\d{2}-\d{2}$/.test(args.since)) { console.error("--since must be YYYY-MM-DD"); return 2; }

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const repo = listRepoRecords(root);
  const notion = extractNotionPaths(readFileSync(args.notion, "utf8"));
  if (notion.size === 0) {
    console.error("The export contains no docs/changes or docs/adr paths. Wrong file, or the Source of truth column was left out.");
    return 2;
  }
  const { missing, orphans } = compare(repo, notion, { since: args.since });
  const failed = missing.length > 0 || (args.strict && orphans.length > 0);

  if (args.json) {
    console.log(JSON.stringify({ repo: repo.length, notion: notion.size, missing, orphans, ok: !failed }, null, 2));
    return failed ? 1 : 0;
  }
  console.log(`Repo records: ${repo.length}. Notion rows with a repo path: ${notion.size}.`);
  if (missing.length) {
    console.log(`\nMissing in Notion (${missing.length}): add a row (Change Log or Decisions) for each:`);
    for (const p of missing) console.log(`  - ${p}`);
  }
  if (orphans.length) {
    console.log(`\nIn Notion but not in the repo (${orphans.length}): renamed, deleted or on another branch:`);
    for (const p of orphans) console.log(`  - ${p}`);
  }
  if (!missing.length && !orphans.length) console.log("\nNotion matches the repo.");
  else if (!missing.length) console.log("\nNo missing rows.");
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
