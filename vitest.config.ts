// /vitest.config.ts (workspace root)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    reporters: ["default"],
    // This root config stays light; service/e2e configs own includes.
  },
});
