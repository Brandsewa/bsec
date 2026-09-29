import { defineConfig } from "vitest/config";

// The first import of a route module pulls in the whole UI kit; under a busy CI runner that can exceed the
// 5s default, so give these render tests room instead of sprinkling per-test timeouts.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
