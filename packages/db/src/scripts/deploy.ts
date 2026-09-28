/**
 * Single entrypoint for the migrate image (infra/coolify/RUNBOOK.md §4-6). Runs on every
 * deploy so the whole flow is drivable from Coolify's UI, with no shell access needed:
 *  - if DATABASE_URL_SUPERUSER is set, (re-)bootstrap the three roles (idempotent — safe to
 *    run every deploy; harmless if the caller leaves the var in, but it should be removed
 *    from the resource's env after the first successful run since only this one-shot job
 *    may ever hold superuser credentials).
 *  - always run the app_owner migration (DATABASE_URL_OWNER, required).
 */
import { bootstrapRoles } from "./bootstrap-roles.ts";
import { runMigrations } from "./migrate.ts";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const superuserUrl = process.env.DATABASE_URL_SUPERUSER;
if (superuserUrl) {
  await bootstrapRoles(superuserUrl, {
    owner: need("APP_OWNER_PASSWORD"),
    rw: need("APP_RW_PASSWORD"),
    platform: need("APP_PLATFORM_PASSWORD"),
  });
  console.log("roles ok");
} else {
  console.log("DATABASE_URL_SUPERUSER not set, skipping role bootstrap");
}

await runMigrations(need("DATABASE_URL_OWNER"));
console.log("migrations ok");
