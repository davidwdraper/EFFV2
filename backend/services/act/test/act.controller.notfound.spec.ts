// backend/services/act/test/act.controller.notfound.spec.ts

// ── Load env BEFORE importing app/db ──────────────────────────────────────────
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.test"),
});

// Make tests hermetic and fast-fail
if (!process.env.ACT_SEARCH_UNFILTERED_CUTOFF)
  process.env.ACT_SEARCH_UNFILTERED_CUTOFF = "25";
if (process.env.REDIS_DISABLED == null) process.env.REDIS_DISABLED = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

// ── Test deps ─────────────────────────────────────────────────────────────────
import http from "node:http";
import request from "supertest";
import { randomBytes } from "crypto";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { Express } from "express";
import { zProblem } from "@shared/contracts/common";

let app: Express;
let server: http.Server;
let connectDb: () => Promise<void>;
let disconnectDb: () => Promise<void>;

const validButMissingId = () => randomBytes(12).toString("hex");

beforeAll(async () => {
  // Import AFTER env is loaded
  const appMod = await import("../src/app");
  const dbMod = await import("../src/db");

  app = ((appMod as any).app ?? (appMod as any).default) as Express;
  connectDb = (dbMod as any).connectDb;
  disconnectDb = (dbMod as any).disconnectDb;

  await connectDb();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
});

afterAll(async () => {
  await disconnectDb();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Act controller – NotFound branches (valid ObjectId, missing doc)", () => {
  it("PATCH /acts/:id → 404 NOT_FOUND when document does not exist", async () => {
    const id = validButMissingId();
    const r = await request(server)
      .patch(`/acts/${id}`)
      .send({ websiteUrl: "https://example.com" })
      .expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.code).toBe("NOT_FOUND");
    expect(prob.title).toBe("Not Found");
  });

  it("DELETE /acts/:id → 404 NOT_FOUND when document does not exist", async () => {
    const id = validButMissingId();
    const r = await request(server).delete(`/acts/${id}`).expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.code).toBe("NOT_FOUND");
    expect(prob.title).toBe("Not Found");
  });
});
