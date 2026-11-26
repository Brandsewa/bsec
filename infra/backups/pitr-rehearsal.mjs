#!/usr/bin/env node
/**
 * Point-in-time recovery rehearsal for the bsec-postgres image (docs/BACKUP-DR-PLAN.md G1, step 4).
 * Everything runs in throwaway Docker containers on a private network; it never touches production, R2 or any real token.
 * A local TLS S3 server (SeaweedFS) stands in for the R2 bucket.
 *
 *   docker build -f infra/docker/postgres.Dockerfile -t bsec-postgres:18 .
 *   node infra/backups/pitr-rehearsal.mjs                 uses image bsec-postgres:18
 *   node infra/backups/pitr-rehearsal.mjs --image X       another image tag
 *   node infra/backups/pitr-rehearsal.mjs --keep          leave containers, volumes and network for inspection
 *
 * Proves: archiving stays OFF without credentials; with them it is ON and the archiver reports no failures; a full and a
 * differential backup succeed; a restore to a chosen moment brings back rows written before it and not rows after it; and
 * measures the restore time (RTO) and how long a committed row waits before it is safely archived (RPO).
 * Exit code 0 only when every check passes.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const IMAGE = opt("--image", "bsec-postgres:18");
const SEAWEED = "chrislusf/seaweedfs:latest";
const id = randomBytes(3).toString("hex");
const net = `pitr-${id}`;
const names = { s3: `pitr-s3-${id}`, pg: `pitr-pg-${id}`, restored: `pitr-restored-${id}`, plain: `pitr-plain-${id}` };
const vols = { certs: `pitr-certs-${id}`, pg: `pitr-pgdata-${id}`, restored: `pitr-restored-${id}`, s3: `pitr-s3data-${id}` };

const docker = (a, o = {}) => spawnSync("docker", a, { encoding: "utf8", ...o });
const must = (r, what) => {
  if (r.status !== 0) throw new Error(`${what} failed: ${(r.stderr || r.stdout || "").trim().split("\n").filter((l) => /ERROR|WARN|error/.test(l) || l.length < 300).slice(-6).join("\n")}`);
  return (r.stdout || "").trim();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
};

const KEY = randomBytes(8).toString("hex");
const SECRET = randomBytes(16).toString("hex");
const PGPASS = randomBytes(8).toString("hex");
const env = {
  PGBACKREST_REPO1_S3_ENDPOINT: `${names.s3}:9000`,
  PGBACKREST_REPO1_S3_BUCKET: "bsec-pgbackrest",
  PGBACKREST_REPO1_S3_KEY: KEY,
  PGBACKREST_REPO1_S3_KEY_SECRET: SECRET,
  PGBACKREST_REPO1_CIPHER_PASS: randomBytes(16).toString("hex"),
  // No verify-tls override on purpose: the stand-in's certificate is signed by a throwaway CA that is installed into the
  // container's system trust store, so this exercises the same path as R2 (system CA bundle). A first version of this
  // script turned verification off and missed that the image had no CA bundle at all (production cutover, 2026-11-25).
};
// Installs the throwaway CA into the system trust store (needs the ca-certificates package), then runs the rest.
const TRUST = "cp /certs/ca.crt /usr/local/share/ca-certificates/pitr-ca.crt && update-ca-certificates >/dev/null 2>&1 && ";
const envArgs = (e) => Object.entries(e).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
const psql = (container, sql) => must(docker(["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", sql]), `psql ${sql.slice(0, 40)}`);
const pgb = (container, ...a) => must(docker(["exec", "-u", "postgres", container, "pgbackrest", "--stanza=bsec", ...a]), `pgbackrest ${a[0]}`);

async function waitReady(container) {
  for (let i = 0; i < 90; i++) {
    if (docker(["exec", container, "pg_isready", "-U", "postgres"]).status === 0) {
      await sleep(1500);
      if (docker(["exec", container, "pg_isready", "-U", "postgres"]).status === 0) return;
    }
    await sleep(1000);
  }
  throw new Error(`${container} never became ready: ${docker(["logs", "--tail", "25", container]).stderr}`);
}

async function main() {
  try {
    must(docker(["version", "--format", "{{.Server.Version}}"]), "Docker is not reachable");
    must(docker(["image", "inspect", IMAGE]), `Image ${IMAGE} not found. Build it first (see the header of this file)`);
    must(docker(["network", "create", net]), "network");
    for (const v of Object.values(vols)) must(docker(["volume", "create", v]), "volume");

    // 1. Without credentials the image must behave like plain Postgres: archiving off, nothing piling up.
    must(docker(["run", "-d", "--name", names.plain, "-e", `POSTGRES_PASSWORD=${PGPASS}`, IMAGE]), "start plain");
    await waitReady(names.plain);
    check("No credentials: archive_mode is off", psql(names.plain, "SHOW archive_mode") === "off");
    docker(["rm", "-f", names.plain]);

    // 2. Local TLS S3 server.
    must(
      docker([
        "run", "--rm", "-v", `${vols.certs}:/certs`, "--entrypoint", "sh", IMAGE, "-c",
        `set -e; cd /certs; openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=pitr-ca -keyout ca.key -out ca.crt 2>/dev/null` +
          ` && openssl req -newkey rsa:2048 -nodes -subj /CN=${names.s3} -keyout private.key -out s.csr 2>/dev/null` +
          ` && printf 'subjectAltName=DNS:${names.s3}\\nbasicConstraints=CA:FALSE\\n' > ext.cnf` +
          ` && openssl x509 -req -in s.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 1 -extfile ext.cnf -out public.crt 2>/dev/null` +
          ` && printf '{"identities":[{"name":"t","credentials":[{"accessKey":"${KEY}","secretKey":"${SECRET}"}],"actions":["Admin","Read","Write","List","Tagging"]}]}' > /certs/s3.json && chmod 644 /certs/*`,
      ]),
      "cert and s3 config",
    );
    must(
      docker([
        "run", "-d", "--name", names.s3, "--network", net, "-v", `${vols.certs}:/certs:ro`, "-v", `${vols.s3}:/data`, SEAWEED,
        "server", "-dir=/data", "-s3", "-s3.port=9000", "-s3.config=/certs/s3.json", "-s3.cert.file=/certs/public.crt", "-s3.key.file=/certs/private.key",
        "-s3.autoCreateBucket", "-master.volumeSizeLimitMB=64",
      ]),
      "start s3",
    );
    await sleep(8000);
    must(docker(["exec", "-i", names.s3, "weed", "shell"], { input: "s3.bucket.create -name bsec-pgbackrest\nexit\n" }), "create bucket");

    // 3. bsec-postgres with credentials: archiving on.
    must(docker(["run", "-d", "--name", names.pg, "--network", net, "-v", `${vols.certs}:/certs:ro`, "-v", `${vols.pg}:/var/lib/postgresql`, "-e", `POSTGRES_PASSWORD=${PGPASS}`, ...envArgs(env), "--entrypoint", "sh", IMAGE, "-c", TRUST + "exec bsec-postgres-entrypoint.sh postgres"]), "start pg");
    await waitReady(names.pg);
    check("Image ships a CA bundle", docker(["exec", names.pg, "test", "-s", "/etc/ssl/certs/ca-certificates.crt"]).status === 0);
    check("TLS certificate verification is on (no override)", !("PGBACKREST_REPO1_STORAGE_VERIFY_TLS" in env));
    check("With credentials: archive_mode is on, archive_command uses pgbackrest", psql(names.pg, "SHOW archive_mode") === "on" && psql(names.pg, "SHOW archive_command").includes("pgbackrest --stanza=bsec archive-push"));

    pgb(names.pg, "stanza-create");
    pgb(names.pg, "check");
    check("stanza-create and check succeeded", true);

    psql(names.pg, "CREATE TABLE t (id serial PRIMARY KEY, note text, at timestamptz DEFAULT now())");
    psql(names.pg, "INSERT INTO t (note) SELECT 'before-full' FROM generate_series(1, 1000)");
    pgb(names.pg, "backup", "--type=full");
    psql(names.pg, "INSERT INTO t (note) SELECT 'after-full' FROM generate_series(1, 500)");
    pgb(names.pg, "backup", "--type=diff");
    const info = JSON.parse(pgb(names.pg, "info", "--output=json"))[0];
    check("Full and differential backups are in the repository", info.backup.length === 2 && info.backup.map((b) => b.type).sort().join() === "diff,full", info.backup.map((b) => b.type).join(" + "));

    psql(names.pg, "INSERT INTO t (note) SELECT 'before-target' FROM generate_series(1, 300)");
    await sleep(2000);
    const target = psql(names.pg, "SELECT to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MSOF')");
    await sleep(2000);
    psql(names.pg, "INSERT INTO t (note) SELECT 'after-target' FROM generate_series(1, 200)");

    // RPO: how long a committed row waits before the archiver has shipped the WAL that holds it (no manual segment switch).
    const t0 = Date.now();
    const lastBefore = psql(names.pg, "SELECT coalesce(extract(epoch FROM last_archived_time), 0) FROM pg_stat_archiver");
    psql(names.pg, "INSERT INTO t (note) VALUES ('rpo-probe')");
    const probeAt = Number(psql(names.pg, "SELECT extract(epoch FROM clock_timestamp())"));
    let archivedAfterProbe = false;
    for (let i = 0; i < 150; i++) {
      const last = Number(psql(names.pg, "SELECT coalesce(extract(epoch FROM last_archived_time), 0) FROM pg_stat_archiver"));
      if (last > probeAt && last > Number(lastBefore)) {
        archivedAfterProbe = true;
        break;
      }
      await sleep(1000);
    }
    const rpoSeconds = Math.round((Date.now() - t0) / 1000);
    check("A committed row is archived without a manual segment switch", archivedAfterProbe, `${rpoSeconds} s (this is the data-loss window with archive_timeout=60)`);
    const failed = Number(psql(names.pg, "SELECT failed_count FROM pg_stat_archiver"));
    check("Archiver reports no failures", failed === 0, `failed_count=${failed}`);

    // 4. Restore to the target moment into an empty volume, in a fresh container.
    must(
      docker(["run", "--rm", "-v", `${vols.restored}:/var/lib/postgresql`, "--entrypoint", "sh", IMAGE, "-c", "mkdir -p /var/lib/postgresql/18/docker && chown -R postgres:postgres /var/lib/postgresql && chmod 700 /var/lib/postgresql/18/docker"]),
      "prepare restore volume",
    );
    const r0 = Date.now();
    must(
      docker(["run", "--rm", "--network", net, "-v", `${vols.certs}:/certs:ro`, "-v", `${vols.restored}:/var/lib/postgresql`, ...envArgs(env), "--entrypoint", "sh", IMAGE, "-c", TRUST + `exec gosu postgres pgbackrest --stanza=bsec restore --type=time --target='${target}' --target-action=promote`]),
      "restore",
    );
    must(docker(["run", "-d", "--name", names.restored, "--network", net, "-v", `${vols.certs}:/certs:ro`, "-v", `${vols.restored}:/var/lib/postgresql`, "-e", `POSTGRES_PASSWORD=${PGPASS}`, ...envArgs(env), "--entrypoint", "sh", IMAGE, "-c", TRUST + "exec bsec-postgres-entrypoint.sh postgres"]), "start restored");
    await waitReady(names.restored);
    for (let i = 0; i < 60 && psql(names.restored, "SELECT pg_is_in_recovery()") === "t"; i++) await sleep(1000);
    const rtoSeconds = Math.round((Date.now() - r0) / 1000);
    check("Restored server finished recovery and accepts writes", psql(names.restored, "SELECT pg_is_in_recovery()") === "f", `${rtoSeconds} s from restore start to usable (RTO for a database this size)`);

    const counts = Object.fromEntries(psql(names.restored, "SELECT note, count(*) FROM t GROUP BY note ORDER BY note").split("\n").map((l) => l.split("|")));
    console.log("\nRows in the restored copy:", counts);
    check("Rows written before the full backup are back", counts["before-full"] === "1000");
    check("Rows written between the backups are back", counts["after-full"] === "500");
    check("Rows written after the last backup, before the target moment, are back (WAL replay)", counts["before-target"] === "300");
    check("Rows written after the target moment are NOT there", counts["after-target"] === undefined && counts["rpo-probe"] === undefined);

    console.log(`\nMeasured here: restore ${rtoSeconds} s, data-loss window about ${rpoSeconds} s (archive_timeout=60). Provisioning a server and a production-sized restore add to the RTO: time those in the rebuild test.`);
    const pass = results.every((r) => r.ok);
    console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}  rto_seconds=${rtoSeconds}  rpo_seconds=${rpoSeconds}`);
    return pass;
  } finally {
    if (!flag("--keep")) {
      for (const n of Object.values(names)) docker(["rm", "-f", n]);
      docker(["network", "rm", net]);
      for (const v of Object.values(vols)) docker(["volume", "rm", "-f", v]);
    } else console.log(`\nKept: containers ${Object.values(names).join(", ")}, network ${net}.`);
  }
}

main()
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((err) => {
    console.error(`\nREHEARSAL ABORTED: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  });
