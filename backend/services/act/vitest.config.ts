// backend/services/act/vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"), // -> backend/services/shared
    },
  },
  test: {
    environment: "node",
    include: ["backend/services/act/test/**/*.spec.ts"],
    setupFiles: [
      "backend/services/act/test/setup.ts",
      "backend/services/act/test/seed/runBeforeEach.ts",
    ],
    isolate: false,
    poolOptions: { threads: { singleThread: true } },
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
        "backend/services/act/src/models/**",
        "backend/services/act/src/models/Town.ts",
      ],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
