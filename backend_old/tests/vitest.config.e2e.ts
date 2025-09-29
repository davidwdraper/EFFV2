// backend/tests/vitest.config.e2e.ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../services/shared"),
    },
  },
  test: {
    environment: "node",
    include: ["backend/tests/e2e/**/*.spec.ts"],
    setupFiles: ["backend/tests/e2e/setup.ts"], // boots servers, seeds Towns, mocks Redis
    isolate: false,
    poolOptions: { threads: { singleThread: true } }, // stabilize Mongoose/model index build
    hookTimeout: 60_000,
    testTimeout: 60_000,
    globals: true,
  },
});
