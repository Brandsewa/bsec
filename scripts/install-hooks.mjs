#!/usr/bin/env node
import { execFileSync } from "node:child_process";

execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "inherit" });
console.log("[hooks:install] core.hooksPath = .githooks (pre-push runs pnpm gate:quick).");
