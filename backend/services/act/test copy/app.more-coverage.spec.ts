// backend/services/act/test/app.more-coverage.spec.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app";

describe("App edge branches", () => {
  it("POST /__audit returns 204 (test-only)", async () => {
    await request(app).post("/__audit").expect(204);
  });

  it("GET /__err-nonfinite flows through error handler with sanitized 500", async () => {
    const r = await request(app).get("/__err-nonfinite");
    expect(r.status).toBe(500);
    expect(r.type).toBe("application/problem+json");
    expect(r.body?.status).toBe(500);
  });

  it("404 Problem+JSON for unknown service routes", async () => {
    // Use two segments so it won't match /towns/:id (which would yield 400)
    const r = await request(app).get("/towns/does/not-exist");
    expect(r.status).toBe(404);
    expect(r.type).toBe("application/problem+json");
    expect(r.body?.title).toBe("Not Found");
  });

  it("404 plain for non-service paths", async () => {
    const r = await request(app).get("/totally-unknown-root-path");
    expect(r.status).toBe(404);
  });
});
