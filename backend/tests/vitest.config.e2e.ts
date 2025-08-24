// /backend/tests/vitest.config.e2e.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // 👇 also repo-root relative
    include: [
      "backend/tests/e2e/**/*.spec.ts",
      "backend/tests/e2e/setup.validate.ts",
    ],
    hookTimeout: 120_000,
    testTimeout: 120_000,
    globals: true,
  },
});
