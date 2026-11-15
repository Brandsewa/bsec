// Run: node --test scripts/check-notion-sync.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listRepoRecords, extractNotionPaths, compare } from "./check-notion-sync.mjs";

function fakeRepo() {
  const root = mkdtempSync(join(tmpdir(), "notion-sync-"));
  mkdirSync(join(root, "docs/changes"), { recursive: true });
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  for (const f of ["README.md", "TEMPLATE.md", "2026-11-01-claude-a.md", "2026-11-10-claude-b.md"]) writeFileSync(join(root, "docs/changes", f), "x");
  for (const f of ["README.md", "template.md", "001-modular-monolith.md", "014-two.md", "notes.md"]) writeFileSync(join(root, "docs/adr", f), "x");
  return root;
}

test("lists records and skips README, TEMPLATE, template and non-numbered ADR files", () => {
  assert.deepEqual(listRepoRecords(fakeRepo()), [
    "docs/adr/001-modular-monolith.md",
    "docs/adr/014-two.md",
    "docs/changes/2026-11-01-claude-a.md",
    "docs/changes/2026-11-10-claude-b.md",
  ]);
});

test("extracts paths from a CSV, JSON and plain text, ignoring README and TEMPLATE", () => {
  const text = [
    'Title,Source of truth\n"A",https://github.com/Brandsewa/bsec/blob/main/docs/changes/2026-11-01-claude-a.md',
    '{"s":"https://github.com/Brandsewa/bsec/blob/main/docs/adr/001-modular-monolith.md"}',
    "docs/changes/README.md docs/changes/TEMPLATE.md",
  ].join("\n");
  assert.deepEqual([...extractNotionPaths(text)].sort(), ["docs/adr/001-modular-monolith.md", "docs/changes/2026-11-01-claude-a.md"]);
});

test("reports missing rows and orphans", () => {
  const repo = listRepoRecords(fakeRepo());
  const notion = new Set(["docs/changes/2026-11-01-claude-a.md", "docs/adr/001-modular-monolith.md", "docs/changes/2026-09-09-claude-gone.md"]);
  const r = compare(repo, notion);
  assert.deepEqual(r.missing, ["docs/adr/014-two.md", "docs/changes/2026-11-10-claude-b.md"]);
  assert.deepEqual(r.orphans, ["docs/changes/2026-09-09-claude-gone.md"]);
});

test("--since only limits change records, never ADRs", () => {
  const repo = listRepoRecords(fakeRepo());
  const r = compare(repo, new Set(), { since: "2026-11-05" });
  assert.deepEqual(r.missing, ["docs/adr/001-modular-monolith.md", "docs/adr/014-two.md", "docs/changes/2026-11-10-claude-b.md"]);
});

test("in sync gives no missing and no orphans", () => {
  const repo = listRepoRecords(fakeRepo());
  assert.deepEqual(compare(repo, new Set(repo)), { missing: [], orphans: [] });
});
