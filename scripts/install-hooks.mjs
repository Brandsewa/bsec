#!/usr/bin/env node
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
} catch {
  // Not a git checkout (a Docker build context or a tarball): nothing to hook.
  process.exit(0);
}
console.log("[hooks:install] core.hooksPath = .githooks (pre-push runs pnpm gate:quick).");
