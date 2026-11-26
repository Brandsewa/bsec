#!/usr/bin/env node
/**
 * Restore drill (docs/BACKUP-DR-PLAN.md G2). Restores a database dump into a throwaway Postgres 18 container, measures
 * the recovery time, checks the schema and data, and removes everything it created. Cross-platform: needs Node and Docker.
 *
 *   node infra/backups/drill.mjs                    newest dump from the backup bucket (read-only token in env)
 *   node infra/backups/drill.mjs --file my.dump     a dump you already have (no network, no token)
 *   node infra/backups/drill.mjs --keep             leave the scratch container running to inspect it
 *
 * Bucket mode reads BACKUP_R2_ENDPOINT, BACKUP_R2_BUCKET, BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY (and
 * BACKUP_R2_PREFIX, default "data/"). Use a READ-ONLY token. Never run this against production's own database, and never
 * paste the output's connection details anywhere: it prints none.
 *
 * Exit code 0 only when every check passes. Record the printed result in Super Admin > Backups and docs/changes/.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const repoRoot = resolve(import.meta.dirname, "..", "..");

const docker = (a, o = {}) => spawnSync("docker", a, { encoding: "utf8", ...o });
const must = (r, what) => {
  if (r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout || "").trim().slice(0, 400)}`);
  return r.stdout;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
};

async function downloadNewestDump(dir) {
  const need = ["BACKUP_R2_ENDPOINT", "BACKUP_R2_BUCKET", "BACKUP_R2_ACCESS_KEY_ID", "BACKUP_R2_SECRET_ACCESS_KEY"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Set ${missing.join(", ")} (a read-only token), or pass --file <dump>.`);
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = createRequire(join(repoRoot, "packages", "domain", "package.json"))("@aws-sdk/client-s3");
  const s3 = new S3Client({ region: "auto", endpoint: process.env.BACKUP_R2_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.BACKUP_R2_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_R2_SECRET_ACCESS_KEY } });
  const prefix = process.env.BACKUP_R2_PREFIX ?? "data/";
  let token;
  const all = [];
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: process.env.BACKUP_R2_BUCKET, Prefix: prefix, ContinuationToken: token }));
    all.push(...(page.Contents ?? []));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  const newest = all.filter((o) => o.Size > 0).sort((a, b) => b.LastModified - a.LastModified)[0];
  if (!newest) throw new Error("No dump found in the bucket.");
  const file = join(dir, "restore.dump");
  const body = (await s3.send(new GetObjectCommand({ Bucket: process.env.BACKUP_R2_BUCKET, Key: newest.Key }))).Body;
  await pipeline(body, createWriteStream(file));
  return { file, label: basename(newest.Key), takenAt: newest.LastModified, size: statSync(file).size };
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "bsec-drill-"));
  const container = `bsec-drill-${randomBytes(4).toString("hex")}`;
  let started = false;
  try {
    must(docker(["version", "--format", "{{.Server.Version}}"]), "Docker is not reachable");

    let dump;
    if (opt("--file")) {
      const f = resolve(opt("--file"));
      if (!existsSync(f)) throw new Error(`Dump not found: ${f}`);
      dump = { file: f, label: basename(f), takenAt: statSync(f).mtime, size: statSync(f).size };
    } else {
      console.log("Downloading the newest dump from the backup bucket...");
      dump = await downloadNewestDump(dir);
    }
    const ageH = (Date.now() - dump.takenAt.getTime()) / 3_600_000;
    console.log(`Dump: ${dump.label}, ${(dump.size / 1_048_576).toFixed(2)} MB, taken ${dump.takenAt.toISOString()} (${ageH.toFixed(1)} h ago)\n`);
    check("Dump is not empty", dump.size > 0);
    check("Dump is under 26 hours old", ageH <= 26, `${ageH.toFixed(1)} h`);

    const pw = randomBytes(12).toString("hex");
    must(docker(["run", "-d", "--rm", "--name", container, "-e", `POSTGRES_PASSWORD=${pw}`, "-e", "POSTGRES_DB=bsec", "postgres:18"]), "Starting the scratch Postgres");
    started = true;
    for (let i = 0; i < 60; i++) {
      if (docker(["exec", container, "pg_isready", "-U", "postgres", "-d", "bsec"]).status === 0) break;
      await sleep(1000);
      if (i === 59) throw new Error("Scratch Postgres never became ready.");
    }
    await sleep(1500);

    // Roles live in the cluster, not in the dump, and the dump's GRANTs name them. NOLOGIN: the scratch copy takes no app traffic.
    must(
      docker(["exec", container, "psql", "-U", "postgres", "-d", "bsec", "-c", "CREATE ROLE app_owner NOLOGIN; CREATE ROLE app_rw NOLOGIN; CREATE ROLE app_platform NOLOGIN BYPASSRLS; CREATE ROLE app_saas NOLOGIN;"]),
      "Creating the application roles",
    );

    const t0 = Date.now();
    must(docker(["cp", dump.file, `${container}:/tmp/restore.dump`]), "Copying the dump");
    const restore = docker(["exec", container, "pg_restore", "-U", "postgres", "-d", "bsec", "--no-owner", "--exit-on-error", "/tmp/restore.dump"]);
    const rtoSeconds = Math.round((Date.now() - t0) / 1000);
    check("pg_restore completed without errors", restore.status === 0, restore.status === 0 ? `${rtoSeconds} s (this is the measured RTO for the data step)` : (restore.stderr || "").trim().split("\n")[0]);
    if (restore.status !== 0) throw new Error("Restore failed; the later checks would be meaningless.");

    const psql = (sql) => must(docker(["exec", container, "psql", "-U", "postgres", "-d", "bsec", "-At", "-F", "|", "-c", sql]), `Query "${sql.slice(0, 40)}"`).trim();

    // Schema state: every migration in the repo must be recorded as applied in the restored copy.
    const journal = JSON.parse(readFileSync(join(repoRoot, "packages", "db", "migrations", "meta", "_journal.json"), "utf8"));
    const applied = Number(psql("SELECT count(*) FROM drizzle.__drizzle_migrations"));
    // Behind the repo is normal (a release adds migrations after the dump was taken; the restore procedure runs migrate next).
    // Ahead of the repo means this checkout is older than the data it is restoring: the drill would be judging the wrong code.
    if (applied > journal.entries.length) {
      check("Migration state is not ahead of this checkout", false, `${applied} applied in the dump, only ${journal.entries.length} in this checkout: update the repo and rerun`);
    } else {
      check("Migration state is not ahead of this checkout", true, applied === journal.entries.length ? `${applied} applied, matches the repo` : `${applied} applied, ${journal.entries.length} in the repo: ${journal.entries.length - applied} to run with migrate after restoring (normal)`);
    }

    const tables = ["tenants", "organizations", "users", "products", "variants", "orders", "order_items", "invoices", "customers", "audit_logs", "platform_audit_logs"];
    console.log("\nRow counts in the restored copy:");
    let anyRows = false;
    for (const t of tables) {
      const exists = psql(`SELECT to_regclass('public.${t}') IS NOT NULL`) === "t";
      if (!exists) {
        console.log(`  ${t.padEnd(22)} (table not present)`);
        continue;
      }
      const n = Number(psql(`SELECT count(*) FROM ${t}`));
      if (n > 0) anyRows = true;
      console.log(`  ${t.padEnd(22)} ${n}`);
    }
    check("Restored copy contains data", anyRows);

    // Recovery point: what would be lost if the server died right now = time since this dump was taken. (The gap to the newest
    // order says nothing about it on a quiet store.) Continuous WAL archiving shrinks this to minutes.
    const rpoSeconds = Math.max(0, Math.round((Date.now() - dump.takenAt.getTime()) / 1000));
    console.log(`\nData that would be lost if the server failed now: ${(rpoSeconds / 3600).toFixed(1)} h (age of this dump).`);

    const totalSeconds = Math.round((Date.now() - t0) / 1000);
    console.log(`\nRTO for this drill (copy and restore, scratch host): ${totalSeconds} s. Provisioning a real server adds to this: time it in the rebuild test.`);
    console.log("Not covered by this script: decrypting a tenant secret with TENANT_SECRETS_KEY and the store-isolation check as app_rw. Do them by hand on the scratch copy (see RESTORE-DRILL.md steps 4.4 and 4.5).");

    if (flag("--keep")) console.log(`\nScratch container kept: ${container}. Remove it with: docker rm -f ${container}`);
    const pass = results.every((r) => r.ok);
    console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}  rto_seconds=${totalSeconds}  rpo_seconds=${rpoSeconds ?? "unknown"}`);
    return { pass, keep: flag("--keep") };
  } finally {
    if (started && !flag("--keep")) docker(["rm", "-f", container]);
    rmSync(dir, { recursive: true, force: true });
  }
}

main()
  .then(({ pass }) => process.exit(pass ? 0 : 1))
  .catch((err) => {
    console.error(`\nDRILL ABORTED: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  });
