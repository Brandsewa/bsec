import { defineConfig } from "drizzle-kit";

// Generation only needs the schema; applying migrations goes through src/scripts/migrate.ts (as app_owner).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL_OWNER ?? "postgres://localhost/unused" },
  strict: true,
});
