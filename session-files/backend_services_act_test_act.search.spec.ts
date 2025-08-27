// backend/services/act/test/act.search.spec.ts

// ── Load env BEFORE importing app/db (so config sees vars) ─────────────────────
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.dev"),
});

// Keep tests hermetic and force the “heavy area” branch
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.REDIS_DISABLED = process.env.REDIS_DISABLED ?? "1";
process.env.ACT_SEARCH_UNFILTERED_CUTOFF = "1"; // very low so a few docs trigger NEEDS_QUERY

// ── Tests ─────────────────────────────────────────────────────────────────────
import http from "node:http";
import request from "supertest";
import { randomBytes } from "crypto";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { Express } from "express";
import { z } from "zod";
import { zActDto, zActListDto } from "@shared/contracts/act";
import { zProblem } from "@shared/contracts/common";

let app: Express | undefined;
let server: http.Server | undefined;
let connectDb: undefined | (() => Promise<void>);
let disconnectDb: undefined | (() => Promise<void>);

const NV_PREFIX = "NVSEARCH_";
const createdIds = new Set<string>();

const oid = () => randomBytes(12).toString("hex");

const minimalAct = (name: string) => ({
  actType: [1],
  userCreateId: oid(),
  userOwnerId: oid(),
  name,
  homeTown: "Austin, TX",
  homeTownId: oid(),
  homeTownLoc: { type: "Point", coordinates: [-97.7431, 30.2672] }, // [lng, lat]
});

const createActs = async (names: string[]) => {
  for (const n of names) {
    const c = await request(server!)
      .post("/acts")
      .send(minimalAct(n))
      .expect(201);
    const created = zActDto.parse(c.body);
    createdIds.add(created._id);
  }
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
  // sweep anything left behind with our prefix
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

describe("Act service – search heavy branches", () => {
  it("search: too many results within radius w/o q -> NEEDS_QUERY", async () => {
    // Ensure area is “heavy” (cutoff=1, create ≥2)
    await createActs([
      `${NV_PREFIX}Austin_one`,
      `${NV_PREFIX}Austin_two`,
      `${NV_PREFIX}Austin_three`,
    ]);

    const r = await request(server!)
      .get("/acts/search")
      .query({
        lat: 30.2672,
        lng: -97.7431,
        miles: 10,
        limit: 5,
        offset: 0,
      })
      .expect(400);

    const prob = zProblem
      .extend({ total: z.number().optional() })
      .parse(r.body);
    expect(prob.code).toBe("NEEDS_QUERY");
    // Just assert “some” total; don't be brittle on the exact count
    expect(typeof prob.total === "number" && prob.total >= 1).toBe(true);
  });

  it("search: typeahead mode when q provided (prefix + multi-token)", async () => {
    // Insert names that START with 'Zeta' so the ^-anchored regex matches
    await createActs(["Zeta Zorro", "Zeta Zone", "Bravo"]);

    const r = await request(server!)
      .get("/acts/search")
      .query({
        lat: 30.2672,
        lng: -97.7431,
        miles: 10,
        q: "Zeta Z", // multi-token prefix (nameRegex handles '^Zeta.*\\s*Z')
        limit: 10,
        offset: 0,
      })
      .expect(200);

    // Validate the base list payload
    const list = zActListDto.parse(r.body);
    expect(Array.isArray(list.items)).toBe(true);
    // We inserted two “Zeta …” acts; at least one should show up with this q
    expect(list.items.length).toBeGreaterThan(0);

    // Assert extra fields directly off the raw body (DTO does not include extras)
    expect((r.body as any).mode).toBe("typeahead");
    expect(typeof (r.body as any).areaTotal).toBe("number");
    expect((r.body as any).areaTotal).toBeGreaterThanOrEqual(list.total);
  });
});
