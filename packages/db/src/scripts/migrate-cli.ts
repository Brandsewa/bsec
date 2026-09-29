/**
 * Standalone entrypoint for manual/local migration runs (docs/migrations.md). Kept separate
 * from migrate.ts so that file has zero self-executing top-level code - see the comment at
 * the top of bootstrap-roles.ts for why that matters once it's bundled elsewhere.
 */
import { runMigrations } from "./migrate.ts";

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error("Missing env DATABASE_URL_OWNER");
await runMigrations(url);
console.log("migrations ok");
