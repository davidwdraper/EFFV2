// backend/services/log/test/service/log.api.spec.ts
import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../helpers/server";
import { validEvent } from "../fixtures/log.samples";

// ✅ Set env BEFORE buildServer() so app.ts sees them during import
process.env.LOG_SERVICE_TOKEN_CURRENT ||= "test-current-key";
process.env.LOG_SERVICE_TOKEN_NEXT ||= "test-next-key";
process.env.LOG_MONGO_URI ||= "mongodb://127.0.0.1:27017/eff_log_test";
process.env.SERVICE_NAME ||= "log-service-test";

// Not strictly required for these API tests, but harmless if present:
process.env.LOG_LEVEL ||= "debug";
process.env.LOG_FS_DIR ||= "tmp-logs/nv-log-cache-test";

let srv: Awaited<ReturnType<typeof buildServer>>;

const CUR = () => process.env.LOG_SERVICE_TOKEN_CURRENT || "test-current-key";
const NXT = () => process.env.LOG_SERVICE_TOKEN_NEXT || "test-next-key";

beforeAll(async () => {
  srv = await buildServer();
});

describe("Log Service API", () => {
  it("rejects non-JSON media type", async () => {
    const r = await srv.request
      .post("/logs")
      .set("x-internal-key", CUR())
      .set("Content-Type", "text/plain")
      .send("nope");
    expect([415, 400]).toContain(r.status);
  });

  it("rejects without internal key", async () => {
    const r = await srv.request
      .post("/logs")
      .set("Content-Type", "application/json")
      .send(validEvent());
    expect([401, 403]).toContain(r.status);
  });

  it("accepts CURRENT key", async () => {
    const r = await srv.request
      .post("/logs")
      .set("x-internal-key", CUR())
      .set("Content-Type", "application/json")
      .send(validEvent());
    expect([200, 202]).toContain(r.status);
  });

  it("accepts NEXT key (rotation)", async () => {
    const r = await srv.request
      .post("/logs")
      .set("x-internal-key", NXT())
      .set("Content-Type", "application/json")
      .send(validEvent());
    expect([200, 202]).toContain(r.status);
  });

  it("/health/deep reports db connected", async () => {
    const r = await srv.request.get("/health/deep");
    expect(r.status).toBe(200);
    expect(r.body?.db?.connected === true || r.body?.ok === true).toBe(true);
  });
});
