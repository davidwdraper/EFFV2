// backend/services/log/test/e2e/log.glue.spec.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { validEvent } from "../fixtures/log.samples";

// ✅ Set required envs FIRST (read during app import)
process.env.LOG_SERVICE_TOKEN_CURRENT ||= "test-current-key";
process.env.LOG_SERVICE_TOKEN_NEXT ||= "test-next-key";
process.env.SERVICE_NAME ||= "log-service-test";
process.env.LOG_LEVEL ||= "debug";

// Use a deterministic test cache dir
process.env.LOG_FS_DIR ||= "tmp-logs/nv-log-cache-test";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  // Start the real Express app on an ephemeral port
  const { default: app } = (await import("../../src/app")) as {
    default: import("express").Express;
  };
  server = app.listen(0);
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Point logger util at the running service
  process.env.LOG_SERVICE_URL = `${baseUrl}/logs`;
  process.env.LOG_SERVICE_HEALTH_URL = `${baseUrl}/health/deep`;

  // Make sure no axios mocks leak in
  vi.unmock("axios");
  vi.resetModules(); // fresh module graph for logger import below
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("E2E glue: logger util -> Log service", () => {
  it("emits via util and the service accepts it", async () => {
    // Import AFTER env + server are ready, and after resetModules
    const { postAudit } = await import("../../../shared/utils/logger");
    await expect(postAudit(validEvent())).resolves.toBeUndefined();
  });
});
