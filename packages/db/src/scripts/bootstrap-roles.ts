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

export async function bootstrapRoles(superuserUrl: string, pw: { owner: string; rw: string; platform: string }) {
  const client = new pg.Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ db: string }>("select current_database() as db");
    const db = rows[0]?.db;
    if (!db) throw new Error("could not read current_database()");
    await client.query(rolesSql(db, pw));
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  void (async () => {
    await bootstrapRoles(need("DATABASE_URL_SUPERUSER"), {
      owner: need("APP_OWNER_PASSWORD"),
      rw: need("APP_RW_PASSWORD"),
      platform: need("APP_PLATFORM_PASSWORD"),
    });
    console.log("roles ok");
  })();
}
