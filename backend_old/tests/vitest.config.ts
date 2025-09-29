// backend/tests/vitest.config.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../services/shared"), // -> backend/services/shared
    },
  },
  test: {
    environment: "node",
    include: ["backend/tests/e2e/**/*.spec.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    globals: true,
  },
});
