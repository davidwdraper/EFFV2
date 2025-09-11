// backend/services/act/test/app.branches.more.spec.ts

// ── Import-time env guards (must be set BEFORE importing app/routes) ──────────
process.env.ENV_FILE = process.env.ENV_FILE || ".env.test";
if (!process.env.ACT_SERVICE_NAME) process.env.ACT_SERVICE_NAME = "act";
if (!process.env.ACT_MONGO_URI)
  process.env.ACT_MONGO_URI = "mongodb://127.0.0.1:27017/eff_act_db";
if (!process.env.ACT_PORT) process.env.ACT_PORT = "0";
if (!process.env.ACT_SEARCH_UNFILTERED_CUTOFF)
  process.env.ACT_SEARCH_UNFILTERED_CUTOFF = "25";
// keep redis quiet in unit tests
if (process.env.REDIS_DISABLED == null) process.env.REDIS_DISABLED = "1";

// ── Now import app (which pulls in routes/controllers that read env) ─────────
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import http from "node:http";
import request from "supertest";
import { app } from "../src/app";
import { zProblem } from "@shared/src/contracts/common";

// Add a couple of test-only endpoints to exercise error/audit branches
app.get("/__err-nonfinite", (_req, _res, next) =>
  next({ status: Number.NaN, message: "boom" })
);
app.post("/__audit", (req, res) => {
  (req as any).audit?.push({ evt: "test" });
  res.status(204).end();
});

let server: http.Server;

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("app.ts – additional 404/error branches", () => {
  it("error handler: non-finite status falls back to 500", async () => {
    const r = await request(server).get("/__err-nonfinite").expect(500);
    const prob = zProblem.parse(r.body);
    expect(prob.title).toBe("Internal Server Error");
    expect(prob.status).toBe(500);
  });

  it("pino autoLogging ignore branch via /favicon.ico (just 404s)", async () => {
    await request(server).get("/favicon.ico").expect(404);
  });

  it("audit hook flushes when req.audit has events", async () => {
    await request(server).post("/__audit").expect(204);
  });
});
