// backend/services/act/test/act.controller.options.spec.ts

// ── Load env before app/db ────────────────────────────────────────────────────
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.test"),
});
if (!process.env.ACT_SEARCH_UNFILTERED_CUTOFF)
  process.env.ACT_SEARCH_UNFILTERED_CUTOFF = "25";
if (process.env.REDIS_DISABLED == null) process.env.REDIS_DISABLED = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

// ── Harness ───────────────────────────────────────────────────────────────────
import http from "node:http";
import request from "supertest";
import { randomBytes } from "crypto";
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import type { Express } from "express";
import { zActDto } from "@shared/contracts/act";

const oid = () => randomBytes(12).toString("hex");

let app: Express;
let server: http.Server;
let connectDb: () => Promise<void>;
let disconnectDb: () => Promise<void>;
const createdIds = new Set<string>();

beforeAll(async () => {
  const appMod = await import("../src/app");
  const dbMod = await import("../src/db");
  app = ((appMod as any).app ?? (appMod as any).default) as Express;
  connectDb = (dbMod as any).connectDb;
  disconnectDb = (dbMod as any).disconnectDb;

  await connectDb();
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
});

afterEach(async () => {
  for (const id of Array.from(createdIds)) {
    try {
      await request(server).delete(`/acts/${id}`).expect(204);
    } catch {
      /* ignore */
    }
    createdIds.delete(id);
  }
});

afterAll(async () => {
  try {
    await disconnectDb?.();
  } catch {
    /* ignore */
  }
  await new Promise<void>((r) => server.close(() => r()));
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("Act controller – drive optional branches with safe fields", () => {
  it("PATCH adds an optional field (websiteUrl) → GET reflects it", async () => {
    // Create minimal valid Act
    const base = {
      actType: [1],
      userCreateId: oid(),
      userOwnerId: oid(),
      name: `PATCH_${Math.random().toString(36).slice(2, 8)}`,
      homeTown: "Austin, TX",
      homeTownId: oid(),
      homeTownLoc: { type: "Point", coordinates: [-97.7431, 30.2672] }, // [lng, lat]
    };
    const c = await request(server).post("/acts").send(base).expect(201);
    const created = zActDto.parse(c.body);
    createdIds.add(created._id);

    // Conservative patch: only websiteUrl (known-good per schema)
    const patch = { websiteUrl: "https://example.com" };
    const u = await request(server)
      .patch(`/acts/${created._id}`)
      .send(patch)
      .expect(200);

    const upd = zActDto.parse(u.body);
    expect(upd.websiteUrl).toBe(patch.websiteUrl);

    // GET after patch (exercises toActDto again with the optional present)
    const g = await request(server).get(`/acts/${created._id}`).expect(200);
    const got = zActDto.parse(g.body);
    expect(got.websiteUrl).toBe(patch.websiteUrl);
  });

  it("list with name filter path (truthy branch) returns results", async () => {
    const nm = `FILTER_${Math.random().toString(36).slice(2, 6)}`;
    const base = {
      actType: [1],
      userCreateId: oid(),
      userOwnerId: oid(),
      name: nm,
      homeTown: "Austin, TX",
      homeTownId: oid(),
      homeTownLoc: { type: "Point", coordinates: [-97.7431, 30.2672] },
    };
    const c = await request(server).post("/acts").send(base).expect(201);
    const created = zActDto.parse(c.body);
    createdIds.add(created._id);

    const r = await request(server)
      .get(`/acts?name=${encodeURIComponent(nm)}&limit=5&offset=0`)
      .expect(200);

    expect(Array.isArray(r.body?.items)).toBe(true);
    expect(r.body.items.some((it: any) => it._id === created._id)).toBe(true);
  });
});
