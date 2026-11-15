#!/usr/bin/env node
// Platform audit (docs/PLATFORM-AUDIT-PLAN.md, sections A1, A2, A5): a mechanical report of how each API
// procedure is guarded. It reads source text only (no imports, no database), so it is a heuristic:
// every line it prints is a place to read, not a proven defect.
//
//   node scripts/audit-api-guards.mjs            store API (apps/web/src/server/api.ts)
//   node scripts/audit-api-guards.mjs --platform platform API (apps/platform/src/app.ts)
//   node scripts/audit-api-guards.mjs --json     machine-readable output
//
// For each procedure: the route guards (`.use(...)`), the domain functions the handler calls, and whether each
// of those functions asserts a permission or role itself (AGENTS.md rule 4: the check belongs in the domain service).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const platform = args.has("--platform");
const apiFile = path.join(root, platform ? "apps/platform/src/app.ts" : "apps/web/src/server/api.ts");
const domainDir = path.join(root, "packages/domain/src");

const ASSERTS = platform
  ? /assertRoleAtLeast\(|assertPlatformStaff\(|assertOwner\(|assertMayManage\(/
  : /assertPermission\(|hasPermission\(|ctx\.roles\.includes\(/;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/** name -> { file, body } for every exported function in packages/domain/src. */
function indexDomainFunctions() {
  const index = new Map();
  for (const file of walk(domainDir)) {
    const src = readFileSync(file, "utf8");
    const re = /export (?:async )?function (\w+)\s*(?:<[^>]*>)?\(/g;
    const starts = [];
    let m;
    while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
    starts.forEach((s, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
      // First definition wins; overload signatures (no body) are skipped.
      const body = src.slice(s.at, end);
      if (!index.has(s.name) || !index.get(s.name).body.includes("{")) {
        index.set(s.name, { file: path.relative(root, file).replaceAll("\\", "/"), body });
      }
    });
  }
  return index;
}

/** Does this function assert, directly or through a domain function it calls (two levels deep)? */
function asserts(index, name, depth = 0, seen = new Set()) {
  const fn = index.get(name);
  if (!fn || seen.has(name)) return false;
  seen.add(name);
  if (ASSERTS.test(fn.body)) return true;
  if (depth >= 2) return false;
  const calls = [...fn.body.matchAll(/\b([a-zA-Z_]\w+)\(/g)].map((c) => c[1]);
  return calls.some((c) => c !== name && index.has(c) && asserts(index, c, depth + 1, seen));
}

function parseProcedures(src) {
  const procs = [];
  const re = /\bos\.((?:[a-zA-Z_]\w*\.)*[a-zA-Z_]\w*)\s*((?:\.use\([^)]*\)*\s*)*)\.handler\(/g;
  let m;
  const hits = [];
  while ((m = re.exec(src))) hits.push({ path: m[1], uses: m[2], at: m.index, bodyAt: re.lastIndex });
  hits.forEach((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].at : src.length;
    const body = src.slice(h.bodyAt, end);
    const guards = [...h.uses.matchAll(/\.use\(([^)]*\)?)\)/g)].map((u) => u[1].trim());
    const line = src.slice(0, h.at).split("\n").length;
    procs.push({ path: h.path, line, guards, body });
  });
  return procs;
}

const index = indexDomainFunctions();
const src = readFileSync(apiFile, "utf8");
const procs = parseProcedures(src);

const report = procs.map((p) => {
  const called = [...new Set([...p.body.matchAll(/\b([a-zA-Z_]\w+)\(/g)].map((c) => c[1]))].filter((n) => index.has(n));
  const asserting = called.filter((n) => asserts(index, n));
  const hasAuthGuard = p.guards.some((g) => /requireAdmin|requireStaff|requirePlatform|requireRole|requireSession|requireCustomer/.test(g));
  const routePermission = p.guards.filter((g) => /requirePermission|requireRole|requireAnyPermission/.test(g));
  return {
    path: p.path,
    line: p.line,
    guards: p.guards,
    hasAuthGuard,
    routePermission,
    domainCalls: called,
    domainAsserts: asserting,
    flag:
      !hasAuthGuard && /^(admin|platform)\./.test(p.path)
        ? "NO_AUTH_GUARD"
        : hasAuthGuard && called.length > 0 && asserting.length === 0
          ? routePermission.length > 0
            ? "ROUTE_ONLY_PERMISSION"
            : "NO_PERMISSION_CHECK"
          : null,
  };
});

if (args.has("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const rel = path.relative(root, apiFile).replaceAll("\\", "/");
  const by = (f) => report.filter((r) => r.flag === f);
  console.log(`${rel}: ${report.length} procedures`);
  for (const flag of ["NO_AUTH_GUARD", "NO_PERMISSION_CHECK", "ROUTE_ONLY_PERMISSION"]) {
    const rows = by(flag);
    console.log(`\n${flag}: ${rows.length}`);
    for (const r of rows) {
      console.log(`  ${rel}:${r.line}  ${r.path}  guards=[${r.guards.join(", ")}]  calls=[${r.domainCalls.join(", ")}]`);
    }
  }
}
