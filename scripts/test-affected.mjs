#!/usr/bin/env node
import { execSync } from "node:child_process";
import { runCommand } from "./lib/run-command.mjs";

const args = process.argv.slice(2);
const isHeavy = args.includes("--heavy");
const extraVitestArgs = args.filter((a) => a !== "--heavy");

console.log("[test:affected] Detecting files changed against origin/main...");

let changedFiles = [];
try {
  const diffOutput = execSync("git diff --name-only origin/main", { encoding: "utf8" }).trim();
  if (diffOutput) {
    changedFiles = diffOutput.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
  }
} catch (err) {
  console.warn("Could not determine git diff against origin/main:", err.message);
}

// Fallback triggers for full suite
const FULL_RUN_TRIGGERS = [
  "package.json",
  "pnpm-lock.yaml",
  "turbo.json",
  "packages/db/migrations",
  "packages/db/src/schema",
  "packages/db/test-support",
  "packages/config",
];

const reasonsForFull = [];
for (const trigger of FULL_RUN_TRIGGERS) {
  if (changedFiles.some((f) => f.startsWith(trigger) || f === trigger)) {
    reasonsForFull.push(trigger);
  }
}

if (changedFiles.length === 0) {
  console.log("[test:affected] No files changed against origin/main. Nothing to test.");
  process.exit(0);
}

if (reasonsForFull.length > 0) {
  console.log(`[test:affected] Core files modified (${reasonsForFull.join(", ")}). Running full test suite.`);
  const scriptToRun = isHeavy ? "test:heavy" : "test:fast";
  process.exit(runCommand("pnpm", [scriptToRun, ...extraVitestArgs]));
}

console.log(`[test:affected] ${changedFiles.length} files changed. Running affected tests via vitest --changed origin/main...`);

// Run vitest with --changed origin/main for fast tests
const vitestArgs = ["--changed", "origin/main", ...extraVitestArgs];
if (!isHeavy) {
  vitestArgs.push("--exclude", "**/*.int.test.ts");
}

process.exit(runCommand("npx", ["vitest", "run", ...vitestArgs]));
