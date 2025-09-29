// backend/services/act/test/town.controller.more.spec.ts

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.test"),
});

import http from "node:http";
import request from "supertest";
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import type { Express } from "express";
import mongoose from "mongoose";
import Town from "../src/models/Town";

let app: Express;
let server: http.Server;

const makeTown = (name: string, state = "TX", lat = 30.26, lng = -97.74) =>
  new Town({ name, state, lat, lng });

beforeAll(async () => {
  const appMod = await import("../src/app");
  const dbMod = await import("../src/db");
  app = (appMod as any).app ?? (appMod as any).default;
  await (dbMod as any).connectDb();

  // Seed a couple of towns used by these tests
  await Town.deleteMany({ name: /^NVTEST_/ });
  await Town.create([
    makeTown("NVTEST_Tamriel", "TX"),
    makeTown("NVTEST_Tampa", "FL"),
    makeTown("NVTEST_Taos", "NM"),
  ]);

  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
});

afterEach(async () => {
  // no per-test cleanup needed here
});

afterAll(async () => {
  await Town.deleteMany({ name: /^NVTEST_/ });
  await mongoose.disconnect();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("Town controller – extra branches", () => {
  it("typeahead: prefix match with limit clamp (limit >> 50 is coerced)", async () => {
    // Request a large-but-valid limit so router validation passes; controller should clamp to ≤ 50
    const r = await request(server)
      .get("/towns/typeahead?q=Tam&limit=200")
      .expect(200);
    const payload = (r.body ?? {}) as any;
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.count).toBe(payload.data.length);
    // We seeded Tamriel (TX) and Tampa (FL). Count should be ≥ 1.
    expect(payload.count).toBeGreaterThan(0);
    // Should never exceed 50 even if a larger limit was requested
    expect(payload.count).toBeLessThanOrEqual(50);
  });

  it("list: state-only filter returns results from that state (covers branch)", async () => {
    const r = await request(server).get("/towns?state=FL&limit=5").expect(200);
    const arr = r.body as Array<any>;
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.every((t) => t.state === "FL")).toBe(true);
  });
});
