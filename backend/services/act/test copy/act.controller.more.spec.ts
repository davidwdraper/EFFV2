// backend/services/act/test/act.controller.more.spec.ts
//
// Extra coverage for actController.ts:
// - list: zodBadRequest path (invalid limit/offset) → BAD_REQUEST 400
// - getById: NOT_FOUND for well-formed but missing id
// - update: NOT_FOUND for well-formed but missing id
// - delete: NOT_FOUND for well-formed but missing id
// - acts prefix 404 stays Problem+JSON

// ── Load env BEFORE importing app/db ───────────────────────────────────────────
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.test"),
});

// Ensure hermetic test defaults that match service SOP
if (!process.env.ACT_SEARCH_UNFILTERED_CUTOFF)
  process.env.ACT_SEARCH_UNFILTERED_CUTOFF = "25";
if (process.env.REDIS_DISABLED == null) process.env.REDIS_DISABLED = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

// ── Test deps ─────────────────────────────────────────────────────────────────
import http from "node:http";
import request from "supertest";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import type { Express } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { zProblem } from "@shared/contracts/common";

// helper: valid-looking ObjectId (24 hex chars) that won’t exist in DB
const hexOid = () => randomBytes(12).toString("hex");

// Wait until mongoose is actually connected (readyState === 1)
async function waitForMongo(timeoutMs = 10_000) {
  const { default: mongoose } = await import("mongoose");
  mongoose.set("bufferCommands", false);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (mongoose.connection.readyState === 1) return;
    await new Promise((r) => setTimeout(r, 75));
  }
  throw new Error("Mongo not connected in time");
}

let app: Express | undefined;
let server: http.Server | undefined;
let connectDb: undefined | (() => Promise<void>);
let disconnectDb: undefined | (() => Promise<void>);

beforeAll(async () => {
  // Import AFTER env is loaded
  const appMod = await import("../src/app");
  const dbMod = await import("../src/db");

  app = ((appMod as any).app ?? (appMod as any).default) as Express | undefined;
  connectDb = (dbMod as any).connectDb;
  disconnectDb = (dbMod as any).disconnectDb;

  if (!app || typeof (app as any) !== "function") {
    throw new Error("Express app failed to import/export correctly");
  }

  await connectDb?.();
  await waitForMongo(12_000);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
});

afterAll(async () => {
  await disconnectDb?.();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
});

// ── Specs ─────────────────────────────────────────────────────────────────────
describe("Act controller – extra branches for coverage", () => {
  it("list: invalid query (limit < 0) triggers zodBadRequest (BAD_REQUEST 400)", async () => {
    // zPagination should reject negative limit
    const r = await request(server!).get("/acts?limit=-5&offset=0").expect(400);

    // Minimal Problem+JSON validator for this case
    const zMinimalProblem = z
      .object({
        type: z.string(),
        title: z.string(),
        status: z.number(),
        detail: z.string().optional(),
        code: z.literal("BAD_REQUEST"),
      })
      .passthrough();

    const prob = zMinimalProblem.parse(r.body);
    expect(prob.status).toBe(400);
    expect(prob.code).toBe("BAD_REQUEST");
  });

  it("getById: well-formed but missing id → NOT_FOUND 404 (Problem+JSON)", async () => {
    const id = hexOid();
    const r = await request(server!).get(`/acts/${id}`).expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.status).toBe(404);
    expect(prob.code).toBe("NOT_FOUND");
  });

  it("update: well-formed but missing id → NOT_FOUND 404 (Problem+JSON)", async () => {
    const id = hexOid();
    // Body conforms to zActUpdate so it passes validation and reaches the notFound branch
    const r = await request(server!)
      .patch(`/acts/${id}`)
      .send({ websiteUrl: "https://nope.invalid" })
      .expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.status).toBe(404);
    expect(prob.code).toBe("NOT_FOUND");
  });

  it("remove: well-formed but missing id → NOT_FOUND 404 (Problem+JSON)", async () => {
    const id = hexOid();
    const r = await request(server!).delete(`/acts/${id}`).expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.status).toBe(404);
    expect(prob.code).toBe("NOT_FOUND");
  });

  it("acts prefix 404 remains Problem+JSON (unknown subroute)", async () => {
    // Hits app-level 404 handler for /acts/*, not controller; still good for coverage
    const r = await request(server!)
      .get("/acts/does-not-exist/child")
      .expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.status).toBe(404);
    expect(prob.title?.toLowerCase()).toContain("not found");
  });
});
