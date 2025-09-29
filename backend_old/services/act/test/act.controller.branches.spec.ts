// backend/services/act/test/act.controller.branches.spec.ts

// ── Load env BEFORE importing app/db (so config sees vars) ─────────────────────
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.dev"),
});

// Keep tests hermetic and fast
if (!process.env.ACT_SEARCH_UNFILTERED_CUTOFF)
  process.env.ACT_SEARCH_UNFILTERED_CUTOFF = "25";
if (process.env.REDIS_DISABLED == null) process.env.REDIS_DISABLED = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

// ── Tests ─────────────────────────────────────────────────────────────────────
import http from "node:http";
import request from "supertest";
import { randomBytes } from "crypto";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { Express } from "express";
import { z } from "zod";
import { zActDto, zActListDto } from "@shared/contracts/act";
import { zProblem } from "@shared/src/contracts/common";

let app: Express | undefined;
let server: http.Server | undefined;
let connectDb: undefined | (() => Promise<void>);
let disconnectDb: undefined | (() => Promise<void>);

const NV_PREFIX = "NVBRANCH_";
const createdIds = new Set<string>();

const hexOid = () => randomBytes(12).toString("hex");

const minimalAct = () => ({
  actType: [1],
  userCreateId: hexOid(),
  userOwnerId: hexOid(),
  name: `${NV_PREFIX}${Math.random().toString(36).slice(2, 8)}`,
  homeTown: "Austin, TX",
  homeTownId: hexOid(),
  homeTownLoc: { type: "Point", coordinates: [-97.7431, 30.2672] },
});

const expectProblem = (payload: unknown, code?: string, status?: number) => {
  const parsed = zProblem.parse(payload);
  if (code) expect(parsed.code).toBe(code);
  if (status) expect(parsed.status).toBe(status);
};

beforeAll(async () => {
  process.env.ENV_FILE = process.env.ENV_FILE || ".env.test";
  const appMod = await import("../src/app");
  const dbMod = await import("../src/db");

  app = ((appMod as any).app ?? (appMod as any).default) as Express | undefined;
  connectDb = (dbMod as any).connectDb;
  disconnectDb = (dbMod as any).disconnectDb;

  await connectDb?.();

  server = http.createServer(app!);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
});

afterAll(async () => {
  // Sweep anything left behind with our prefix
  try {
    if (server) {
      const res = await request(server).get("/acts?limit=200&offset=0");
      if (res.status === 200) {
        const list = zActListDto.parse(res.body);
        for (const item of list.items) {
          if (item.name?.startsWith?.(NV_PREFIX)) {
            await request(server).delete(`/acts/${item._id}`).expect(204);
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  await disconnectDb?.();
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

afterEach(async () => {
  if (!server) return;
  for (const id of Array.from(createdIds)) {
    try {
      await request(server).delete(`/acts/${id}`).expect(204);
    } catch {
      /* ignore */
    }
    createdIds.delete(id);
  }
});

describe("Act controller – extra branches for coverage", () => {
  it("list: invalid query (limit < 0) triggers zodBadRequest (BAD_REQUEST 400)", async () => {
    const r = await request(server!).get("/acts?limit=-5&offset=0").expect(400);
    const prob = zProblem
      .extend({ errors: z.array(z.any()).optional() })
      .parse(r.body);
    expect(prob.status).toBe(400);
    expect(prob.code).toBe("BAD_REQUEST");
  });

  it("getById: well-formed ObjectId but not found → 404 NOT_FOUND", async () => {
    const missingId = hexOid();
    const r = await request(server!).get(`/acts/${missingId}`).expect(404);
    expectProblem(r.body, "NOT_FOUND", 404);
  });

  it("update: well-formed id but missing doc → 404 NOT_FOUND", async () => {
    const missingId = hexOid();
    const r = await request(server!)
      .patch(`/acts/${missingId}`)
      .send({ websiteUrl: "https://example.com" })
      .expect(404);
    expectProblem(r.body, "NOT_FOUND", 404);
  });

  it("create: validation error surfaces as VALIDATION_ERROR (400) with issues", async () => {
    const bad = { ...minimalAct(), name: undefined } as any;
    const r = await request(server!).post("/acts").send(bad).expect(400);
    const prob = zProblem
      .extend({ errors: z.array(z.any()).optional() })
      .parse(r.body);
    expect(prob.status).toBe(400);
    expect(prob.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(prob.errors) || prob.errors === undefined).toBe(true);
  });

  it("update: empty patch invalid → VALIDATION_ERROR (400)", async () => {
    const c = await request(server!)
      .post("/acts")
      .send(minimalAct())
      .expect(201);
    const created = zActDto.parse(c.body);
    createdIds.add(created._id);

    const r = await request(server!)
      .patch(`/acts/${created._id}`)
      .send({})
      .expect(400);
    const prob = zProblem.parse(r.body);
    expect(prob.code).toBe("VALIDATION_ERROR");
  });

  it("update: bad ObjectId in param → BAD_REQUEST (400)", async () => {
    const r = await request(server!)
      .patch("/acts/not-a-valid-id")
      .send({ websiteUrl: "https://example.com" })
      .expect(400);
    expectProblem(r.body, "BAD_REQUEST", 400);
  });
});
