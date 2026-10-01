import { defineConfig } from "vitest/config";

// TEST_PG_ADMIN_URL (fast local mode, see docs/FAST-LOCAL-TESTS.md): every test file gets its own database cloned
// from a migrated template.
const sharedServer = Boolean(process.env.TEST_PG_ADMIN_URL);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    ...(sharedServer
      ? {
          globalSetup: ["../../packages/db/test-support/global-setup.ts"],
          setupFiles: ["../../packages/db/test-support/setup-file.ts"],
          maxWorkers: 2,
        }
      : {}),
    fileParallelism: sharedServer,
  },
});
