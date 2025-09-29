// backend/services/act/test/config.spec.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let envBackup: NodeJS.ProcessEnv;

beforeEach(() => {
  envBackup = { ...process.env };
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in envBackup)) delete (process.env as any)[k];
  }
  Object.assign(process.env, envBackup);
});

describe("config.ts (SOP-compliant, no defaults)", () => {
  it("reads required env vars via shared helpers", async () => {
    process.env.NODE_ENV = "test";
    process.env.ACT_SERVICE_NAME = "act";
    process.env.ACT_PORT = "1234";
    process.env.ACT_MONGO_URI = "mongodb://localhost:27017/db";
    process.env.LOG_LEVEL = "debug";
    process.env.LOG_SERVICE_URL = "http://log-svc";
    process.env.JWT_SECRET = "sekrit";

    const mod = await import("../src/config");
    const { config } = mod;

    expect(config.env).toBe("test");
    expect(config.serviceName).toBe("act");
    expect(config.port).toBe(1234);
    expect(config.mongoUri).toBe("mongodb://localhost:27017/db");
    expect(config.logLevel).toBe("debug");
    expect(config.logServiceUrl).toBe("http://log-svc");
    expect(config.jwtSecret).toBe("sekrit");
  });

  it("throws at import time when a required var is missing", async () => {
    // Only set some of them; omit ACT_PORT to force a failure
    process.env.ACT_SERVICE_NAME = "act";
    process.env.ACT_MONGO_URI = "mongodb://localhost:27017/db";
    process.env.LOG_LEVEL = "info";
    process.env.LOG_SERVICE_URL = "http://log-svc";
    delete process.env.ACT_PORT;

    await expect(import("../src/config")).rejects.toThrow();
  });
});
