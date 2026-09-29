/**
 * Runs as app_owner only (PLAN §13 M0). Order:
 *  1. Drizzle migrations (expand/contract rule: docs/migrations.md)
 *  2. pg-boss schema install/upgrade + queue creation (the worker runs with migrate:false as app_rw)
 *  3. Grants on the pgboss schema for the runtime roles
 * Env: DATABASE_URL_OWNER
 *
 * No top-level/isMain self-execution here on purpose - see migrate-cli.ts for the standalone
 * entrypoint, and the comment at the top of bootstrap-roles.ts for why an isMain guard is
 * unsafe once this module is bundled into deploy.js alongside other entry files.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { PgBoss } from "pg-boss";
import pg from "pg";
import { QUEUES } from "../queues.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

// Works from src/scripts (tsx) and from dist/ (bundled image); MIGRATIONS_DIR overrides both.
const defaultMigrations =
  process.env.MIGRATIONS_DIR ?? path.resolve(here, here.endsWith("scripts") ? "../../migrations" : "../migrations");

export async function runMigrations(ownerUrl: string, migrationsFolder = defaultMigrations) {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1, application_name: "bsec-migrate" });
  try {
    const { rows } = await pool.query<{ role: string }>("select current_user as role");
    if (rows[0]?.role !== "app_owner") throw new Error(`Migrations must run as app_owner, got ${rows[0]?.role}`);

    await migrate(drizzle(pool), { migrationsFolder });

    const boss = new PgBoss({ connectionString: ownerUrl, max: 1, supervise: false, schedule: false });
    boss.on("error", (e) => console.error(e));
    await boss.start();
    for (const q of QUEUES) {
      if (!(await boss.getQueue(q.name))) await boss.createQueue(q.name, q.options);
    }
    await boss.stop({ graceful: false });

    await pool.query(`
      GRANT USAGE ON SCHEMA pgboss TO app_rw, app_platform;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO app_rw, app_platform;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO app_rw, app_platform;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO app_rw, app_platform;
    `);
  } finally {
    await pool.end();
  }
}
