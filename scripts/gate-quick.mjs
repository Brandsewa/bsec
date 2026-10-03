#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const startTime = Date.now();

function runStep(title, command, args) {
  console.log(`\n=== [gate:quick] ${title} ===`);
  const stepStart = Date.now();
  const cmd = process.platform === "win32" ? `${command}.cmd` : command;
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`\n❌ [gate:quick] FAILED at step "${title}" (exit code ${res.status})`);
    process.exit(res.status ?? 1);
  }
  const stepElapsed = ((Date.now() - stepStart) / 1000).toFixed(2);
  console.log(`✓ [gate:quick] ${title} passed in ${stepElapsed}s`);
}

console.log("🚀 Starting quick gate verification...");

runStep("Typecheck", "pnpm", ["typecheck"]);
runStep("Lint", "pnpm", ["lint"]);
runStep("Docs Check", "pnpm", ["docs:check"]);
runStep("Affected Tests", "node", ["scripts/test-affected.mjs"]);

const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`\n🎉 [gate:quick] All checks passed in ${totalElapsed}s! Ready to push.\n`);
