/**
 * Standalone entrypoint for manual/local role bootstrap (docs/migrations.md). Kept separate
 * from bootstrap-roles.ts so that file has zero self-executing top-level code - see the
 * comment at the top of bootstrap-roles.ts for why that matters once it's bundled elsewhere.
 */
import { bootstrapRoles } from "./bootstrap-roles.ts";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

await bootstrapRoles(need("DATABASE_URL_SUPERUSER"), {
  owner: need("APP_OWNER_PASSWORD"),
  rw: need("APP_RW_PASSWORD"),
  platform: need("APP_PLATFORM_PASSWORD"),
});
console.log("roles ok");
