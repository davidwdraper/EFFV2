// backend/services/log/vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["backend/services/log/test/**/*.spec.ts"],
    setupFiles: ["backend/services/log/test/setup.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
    restoreMocks: true,
    watch: false,
    reporters: ["default"],
    coverage: {
      provider: "v8",
      all: true,
      include: [
        "backend/services/log/src/**/*.ts",
        "backend/services/shared/**/*.ts",
      ],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "backend/services/log/test/**",
      ],
      reportsDirectory: "coverage",
      reporter: ["text", "html"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 85,
      },
    },
  },
  resolve: {
    alias: {
      // e.g. import "@shared/types/express"
      "@shared": path.resolve(process.cwd(), "backend/services/shared"),
    },
  },
});
