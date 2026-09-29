/**
 * Creates/updates app_owner, app_rw, app_platform. Run as a superuser, once per environment
 * (and harmlessly on every deploy). Env: DATABASE_URL_SUPERUSER, APP_*_PASSWORD.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { rolesSql } from "../sql/roles.ts";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

// Arbitrary fixed key for a session-level advisory lock scoped to role bootstrap. Roles
// (ALTER ROLE ... PASSWORD, CREATE ROLE) live in the cluster-wide pg_authid catalog, not a single
// database, so two callers targeting even different databases on the same Postgres instance can
// still race. Concretely: in CI, @bs/db's and @bs/domain's test suites both run bootstrapRoles()
// against one shared Postgres service container in parallel (via turbo), which without this lock
// fails intermittently with "tuple concurrently updated" on the ALTER ROLE statements.
const BOOTSTRAP_ROLES_LOCK_KEY = 0x62_73_65_63; // "bsec" as a 32-bit int, arbitrary but stable

export async function bootstrapRoles(superuserUrl: string, pw: { owner: string; rw: string; platform: string }) {
  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [BOOTSTRAP_ROLES_LOCK_KEY]);
    try {
      const { rows } = await client.query<{ db: string }>("select current_database() as db");
      const db = rows[0]?.db;
      if (!db) throw new Error("could not read current_database()");
      await client.query(rolesSql(db, pw));
    } finally {
      await client.query("select pg_advisory_unlock($1)", [BOOTSTRAP_ROLES_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await bootstrapRoles(need("DATABASE_URL_SUPERUSER"), {
    owner: need("APP_OWNER_PASSWORD"),
    rw: need("APP_RW_PASSWORD"),
    platform: need("APP_PLATFORM_PASSWORD"),
  });
  console.log("roles ok");
}
