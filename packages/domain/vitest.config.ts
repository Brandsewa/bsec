import { defineConfig } from "vitest/config";

// TEST_PG_ADMIN_URL (fast local mode, see docker-compose.test-db.yml): every test file gets its own
// database cloned from a migrated template, so files can run in parallel.
const sharedServer = Boolean(process.env.TEST_PG_ADMIN_URL);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    ...(sharedServer
      ? {
          globalSetup: ["../db/test-support/global-setup.ts"],
          setupFiles: ["../db/test-support/setup-file.ts"],
          maxWorkers: 4,
        }
      : {}),
    // When TEST_DATABASE_URL_SUPERUSER is set (CI: one shared Postgres service container for
    // every *.int.test.ts file), file parallelism must be off - concurrent files each calling
    // bootstrapRoles() against the same database race on ALTER ROLE and fail with "tuple
    // concurrently updated". Locally each int test file spins its own Testcontainers Postgres
    // (see beforeAll's fallback in each *.int.test.ts), so parallelism there is safe and fast.
    // In TEST_PG_ADMIN_URL mode each file has its own database, so parallelism is safe again.
    fileParallelism: sharedServer,
  },
});
