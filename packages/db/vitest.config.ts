import { defineConfig } from "vitest/config";

// TEST_PG_ADMIN_URL: fast local mode, see docker-compose.test-db.yml.
const sharedServer = Boolean(process.env.TEST_PG_ADMIN_URL);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    ...(sharedServer
      ? {
          globalSetup: ["./test-support/global-setup.ts"],
          setupFiles: ["./test-support/setup-file.ts"],
          maxWorkers: 4,
        }
      : {}),
  },
});
