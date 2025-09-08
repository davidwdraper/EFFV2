// backend/services/--audit--/vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // From AUDIT service folder → shared
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    environment: "node",

    // ✅ Relative globs so tests run from repo root OR this service folder
    include: ["test/**/*.spec.ts"],
    setupFiles: ["test/setup.ts", "test/seed/runBeforeEach.ts"],

    isolate: false,
    poolOptions: { threads: { singleThread: true } },
    hookTimeout: 60_000,
    testTimeout: 60_000,
    globals: true,

    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "coverage", // local to this service
      all: true,
      include: ["src/**"], // cover this service’s source
      exclude: [
        "**/test/**",
        "src/index.ts",
        "src/models/**",
        "src/models/Town.ts",
      ],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
