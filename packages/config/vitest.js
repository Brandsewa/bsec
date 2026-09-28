import { defineConfig } from "vitest/config";

/** Shared Vitest defaults. Integration tests live in *.int.test.ts and need TEST_DATABASE_URL. */
export const baseVitest = defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "test/**/*.test.ts"],
    passWithNoTests: true,
  },
});
export default baseVitest;
