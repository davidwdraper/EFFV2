// backend/services/act/test/act.controller.edgecases.spec.ts

import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.test"),
});

import http from "node:http";
import request from "supertest";
import { randomBytes } from "crypto";
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import type { Express } from "express";
import { z } from "zod";
import { zActDto, zActListDto } from "@shared/contracts/act";
import { zProblem } from "@shared/contracts/common";

let app: Express;
let server: http.Server;
let connectDb: undefined | (() => Promise<void>);
let disconnectDb: undefined | (() => Promise<void>);
const createdIds = new Set<string>();

const oid = () => randomBytes(12).toString("hex");
const minimalAct = (name: string) => ({
  actType: [1],
  userCreateId: oid(),
  userOwnerId: oid(),
  name,
  homeTown: "Austin, TX",
  homeTownId: oid(),
  homeTownLoc: { type: "Point", coordinates: [-97.7431, 30.2672] },
});

async function waitForMongo(timeoutMs = 10000) {
  const { default: mongoose } = await import("mongoose");
  mongoose.set("bufferCommands", false);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (mongoose.connection.readyState === 1) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Mongo not connected");
}

beforeAll(async () => {
  const appMod = await import("../src/app");
  const dbMod = await import("../src/db");
  app = (appMod as any).app ?? (appMod as any).default;
  connectDb = (dbMod as any).connectDb;
  disconnectDb = (dbMod as any).disconnectDb;
  await connectDb?.();
  await waitForMongo();

  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
});

afterEach(async () => {
  for (const id of Array.from(createdIds)) {
    try {
      await request(server).delete(`/acts/${id}`).expect(204);
    } catch {}
    createdIds.delete(id);
  }
});

afterAll(async () => {
  await disconnectDb?.();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("Act controller – edge cases to lift branch coverage", () => {
  it("search: q present but no matches → still returns typeahead mode with areaTotal and 0 items", async () => {
    // Seed one act inside radius so areaTotal > 0
    const c = await request(server)
      .post("/acts")
      .send(minimalAct("Alpha Name"))
      .expect(201);
    const created = zActDto.parse(c.body);
    createdIds.add(created._id);

    const r = await request(server)
      .get(
        "/acts/search?lat=30.2672&lng=-97.7431&miles=50&q=NoMatchToken&limit=5&offset=0"
      )
      .expect(200);

    // Validate base DTO
    const list = zActListDto.parse(r.body);
    expect(Array.isArray(list.items)).toBe(true);
    expect(list.items.length).toBe(0);

    // Assert extras on the raw payload
    const payload = z
      .object({
        mode: z.literal("typeahead"),
        areaTotal: z.number().nonnegative(),
      })
      .parse(r.body);
    expect(payload.areaTotal).toBeGreaterThan(0);
  });

  it("list: name filter escapes regex metacharacters (escapeRe branch)", async () => {
    const tricky = "A+B (C)[D] ^$ . * ? | \\";
    const c = await request(server)
      .post("/acts")
      .send(minimalAct(tricky))
      .expect(201);
    const created = zActDto.parse(c.body);
    createdIds.add(created._id);

    const r = await request(server)
      .get(`/acts?limit=10&offset=0&name=${encodeURIComponent(tricky)}`)
      .expect(200);
    const list = zActListDto.parse(r.body);
    expect(list.items.some((i) => i._id === created._id)).toBe(true);
  });

  it("remove: valid ObjectId but nonexistent → NOT_FOUND Problem+JSON", async () => {
    const fakeId = randomBytes(12).toString("hex");
    const r = await request(server).delete(`/acts/${fakeId}`).expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.code ?? "NOT_FOUND").toBe("NOT_FOUND");
  });
});
