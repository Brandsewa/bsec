import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // When TEST_DATABASE_URL_SUPERUSER is set (CI: one shared Postgres service container for
    // every *.int.test.ts file), file parallelism must be off - concurrent files each calling
    // bootstrapRoles() against the same database race on ALTER ROLE and fail with "tuple
    // concurrently updated". Locally each int test file spins its own Testcontainers Postgres
    // (see beforeAll's fallback in each *.int.test.ts), so parallelism there is safe and fast.
    fileParallelism: false,
  },
});
