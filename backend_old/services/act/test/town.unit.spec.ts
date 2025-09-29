// backend/services/act/test/town.unit.spec.ts

// ── Load env BEFORE importing app/db (so config sees vars) ─────────────────────
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.test"),
});

process.env.NODE_ENV = process.env.NODE_ENV || "test";
if (process.env.REDIS_DISABLED == null) process.env.REDIS_DISABLED = "1";

// ── Core test deps ────────────────────────────────────────────────────────────
import http from "node:http";
import request from "supertest";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { Express } from "express";
import { z } from "zod";

// Contracts for Problem+JSON
//import { zProblem } from "@shared/contracts/common";
import { zProblem } from "../../shared/src/contracts/common";

// Direct model access for seeding/cleanup (also raises Town.ts coverage)
import Town from "../src/models/Town";

// ── Small helpers ─────────────────────────────────────────────────────────────
const NV_PREFIX = "NVTEST_TOWN_";

const zTypeaheadResp = z.object({
  count: z.number(),
  data: z.array(
    z.object({
      label: z.string(),
      name: z.string(),
      state: z.string(),
      lat: z.number().nullable().optional(),
      lng: z.number().nullable().optional(),
      townId: z.string().optional(),
    })
  ),
});
const zTownListItem = z.object({
  id: z.string().optional(),
  name: z.string(),
  state: z.string(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

const expectProblem = (payload: unknown, code?: string, status?: number) => {
  const parsed = zProblem.parse(payload);
  if (code) expect(parsed.code).toBe(code);
  if (status) expect(parsed.status).toBe(status);
};

// Wait until mongoose reports readyState === 1 (connected) or fail fast
async function waitForMongo(timeoutMs = 10_000) {
  const { default: mongoose } = await import("mongoose");
  mongoose.set("bufferCommands", false);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (mongoose.connection.readyState === 1) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `Mongo not connected after ${timeoutMs}ms. Check ACT_MONGO_URI and that mongod is running.`
  );
}

// ── Server / DB wiring (same pattern as act.unit.spec.ts) ─────────────────────
let app: Express | undefined;
let server: http.Server | undefined;
let connectDb: undefined | (() => Promise<void>);
let disconnectDb: undefined | (() => Promise<void>);

beforeAll(async () => {
  process.env.ENV_FILE = process.env.ENV_FILE || ".env.test";

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

  // Seed a few towns (prefix so we can clean)
  await Town.create([
    { name: `${NV_PREFIX}Tampa`, state: "FL", lat: 27.95, lng: -82.46 },
    {
      name: `${NV_PREFIX}Tamalpais Valley`,
      state: "CA",
      lat: 37.88,
      lng: -122.53,
    },
    { name: `${NV_PREFIX}Tamworth`, state: "NH", lat: 43.85, lng: -71.29 },
    { name: `${NV_PREFIX}Austin`, state: "TX", lat: 30.27, lng: -97.74 },
    { name: `${NV_PREFIX}Albany`, state: "NY", lat: 42.65, lng: -73.75 },
  ]);
});

afterAll(async () => {
  try {
    await Town.deleteMany({ name: { $regex: `^${NV_PREFIX}` } });
  } catch {
    /* ignore */
  }

  await disconnectDb?.();
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
});

afterEach(async () => {
  // no-op (we drop all seeded docs in afterAll)
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("Town service (controller coverage)", () => {
  it("ping", async () => {
    const r = await request(server!).get("/towns/ping").expect(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.resource).toBe("towns");
    expect(typeof r.body?.ts).toBe("string");
  });

  it("typeahead: q < 3 chars returns empty list (early return branch)", async () => {
    const r = await request(server!)
      .get("/towns/typeahead?q=Ta&limit=10")
      .expect(200);
    const payload = zTypeaheadResp.parse(r.body);
    expect(payload.count).toBe(0);
    expect(payload.data.length).toBe(0);
  });

  it("typeahead: large limit is rejected by router validation; valid limit returns matches", async () => {
    // Too large: router/zod should reject before controller, returning BAD_REQUEST
    const rBad = await request(server!)
      .get("/towns/typeahead?q=Tam&limit=1000")
      .expect(400);
    expectProblem(rBad.body, "BAD_REQUEST", 400);

    // Valid limit (<= 50): should return typeahead data
    const rOk = await request(server!)
      .get("/towns/typeahead?q=Tam&limit=50")
      .expect(200);
    const ok = zTypeaheadResp.parse(rOk.body);
    expect(ok.count).toBeGreaterThan(0);
    for (const row of ok.data) {
      expect(row.label).toMatch(/, [A-Z]{2}$/);
    }
  });

  it("list: returns seeded towns; supports state filter and query prefix", async () => {
    const r1 = await request(server!).get("/towns?limit=10").expect(200);
    const list1 = z.array(zTownListItem).parse(r1.body);
    expect(list1.length).toBeGreaterThan(0);

    const r2 = await request(server!)
      .get(`/towns?query=${encodeURIComponent(NV_PREFIX)}T&limit=10`)
      .expect(200);
    const list2 = z.array(zTownListItem).parse(r2.body);
    expect(list2.find((t) => t.name?.includes("Tampa"))).toBeTruthy();

    const r3 = await request(server!)
      .get(`/towns?query=${encodeURIComponent(NV_PREFIX)}A&state=tx&limit=10`)
      .expect(200);
    const list3 = z.array(zTownListItem).parse(r3.body);
    expect(list3.length).toBeGreaterThan(0);
    for (const t of list3) expect(t.state).toBe("TX");
  });

  it("getById: happy path + NOT_FOUND + BAD_REQUEST", async () => {
    const anyTown = await Town.findOne({
      name: { $regex: `^${NV_PREFIX}` },
    }).lean();
    expect(anyTown?._id).toBeTruthy();

    const g = await request(server!)
      .get(`/towns/${anyTown!._id.toString()}`)
      .expect(200);
    const got = zTownListItem.parse(g.body);
    expect(got.name).toBe(anyTown!.name);
    expect(got.state).toBe(anyTown!.state);

    const bad = await request(server!).get("/towns/not-a-valid-id").expect(400);
    expectProblem(bad.body, "BAD_REQUEST", 400);

    const { default: mongoose } = await import("mongoose");
    const missingId = new mongoose.Types.ObjectId().toHexString();
    const nf = await request(server!).get(`/towns/${missingId}`).expect(404);
    expectProblem(nf.body, "NOT_FOUND", 404);
  });

  it("unknown subroute under /towns returns Problem+JSON 404", async () => {
    // Use a multi-segment path so it does NOT match the :id route
    const r = await request(server!).get("/towns/does/not/exist").expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.status).toBe(404);
  });
});
