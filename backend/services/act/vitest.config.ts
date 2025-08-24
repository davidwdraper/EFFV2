// backend/services/act/vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["backend/services/act/test/**/*.spec.ts"], // repo-root relative
    setupFiles: [
      "backend/services/act/test/setup.ts", // your existing test setup (logger mocks, envs, etc.)
      "backend/services/act/test/seed/runBeforeEach.ts", // <— NEW: seeds NVTEST_* towns if missing
    ],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "backend/services/act/coverage",
      all: true,
      include: ["backend/services/act/src/**"],
      exclude: [
        "**/test/**",
        "backend/services/act/src/index.ts",
        // exclude data-only models from coverage calculations
        "backend/services/act/src/models/**",
        "backend/services/act/src/models/Town.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
});
