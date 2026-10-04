#!/usr/bin/env node
import { runCommand } from "./lib/run-command.mjs";

const startTime = Date.now();

function runStep(title, command, args) {
  console.log(`\n=== [gate:quick] ${title} ===`);
  const stepStart = Date.now();
  const code = runCommand(command, args);
  if (code !== 0) {
    console.error(`\n[gate:quick] FAILED at step "${title}" (exit code ${code})`);
    process.exit(code);
  }
  const stepElapsed = ((Date.now() - stepStart) / 1000).toFixed(2);
  console.log(`[gate:quick] ${title} passed in ${stepElapsed}s`);
}

console.log("[gate:quick] Starting quick gate verification...");

runStep("Typecheck", "pnpm", ["typecheck"]);
runStep("Lint", "pnpm", ["lint"]);
runStep("Docs Check", "pnpm", ["docs:check"]);
runStep("Affected Tests", "node", ["scripts/test-affected.mjs"]);

const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`\n[gate:quick] All checks passed in ${totalElapsed}s. Ready to push.\n`);
