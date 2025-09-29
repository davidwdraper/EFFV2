// backend/services/act/test/act.controller.branches.extra.spec.ts

// ── Load env BEFORE importing app/db ──────────────────────────────────────────
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.dev"),
});

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.REDIS_DISABLED = process.env.REDIS_DISABLED ?? "1";
process.env.ACT_SEARCH_UNFILTERED_CUTOFF =
  process.env.ACT_SEARCH_UNFILTERED_CUTOFF || "25";

// ── Tests ─────────────────────────────────────────────────────────────────────
import http from "node:http";
import request from "supertest";
import { randomBytes } from "crypto";
import { describe, it, beforeAll, afterAll, afterEach, expect } from "vitest";
import type { Express } from "express";
import { zActDto } from "@shared/contracts/act";
import { zProblem } from "@shared/src/contracts/common";

let app: Express;
let server: http.Server;
let connectDb: undefined | (() => Promise<void>);
let disconnectDb: undefined | (() => Promise<void>);

const NV_PREFIX = "NVBR_";
const createdIds = new Set<string>();
const oid = () => randomBytes(12).toString("hex");

const minimalAct = () => ({
  actType: [1],
  userCreateId: oid(),
  userOwnerId: oid(),
  name: `${NV_PREFIX}${Math.random().toString(36).slice(2, 10)}`,
  homeTown: "Austin, TX",
  homeTownId: oid(),
  homeTownLoc: { type: "Point", coordinates: [-97.7431, 30.2672] },
});

beforeAll(async () => {
  const appMod = await import("../src/app");
  const dbMod = await import("../src/db");
  app = ((appMod as any).app ?? (appMod as any).default) as Express;
  connectDb = (dbMod as any).connectDb;
  disconnectDb = (dbMod as any).disconnectDb;

  await connectDb?.();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
});

afterAll(async () => {
  await disconnectDb?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

describe("Act controller – extra branches for 90%+", () => {
  it("create: server sets dateCreated/dateLastUpdated (client-supplied dateCreated ignored)", async () => {
    const clientDate = "2021-05-01T12:00:00.000Z"; // will be ignored by schema
    const payload = { ...minimalAct(), dateCreated: clientDate };

    const c = await request(server).post("/acts").send(payload).expect(201);
    const created = zActDto.parse(c.body);
    createdIds.add(created._id);

    // dateCreated is present and is NOT the client-supplied value
    expect(typeof created.dateCreated).toBe("string");
    expect(created.dateCreated).not.toBe(clientDate);

    // dateLastUpdated present and >= dateCreated
    expect(typeof created.dateLastUpdated).toBe("string");
    expect(
      new Date(created.dateLastUpdated).getTime() >=
        new Date(created.dateCreated).getTime()
    ).toBe(true);
  });

  it("update: valid ObjectId that does not exist → 404 NOT_FOUND (update notFound branch)", async () => {
    const nonExistentId = "f".repeat(24); // valid hex ObjectId-like
    const r = await request(server)
      .patch(`/acts/${nonExistentId}`)
      .send({ websiteUrl: "https://x.example" })
      .expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.code).toBe("NOT_FOUND");
  });

  it("delete: valid ObjectId that does not exist → 404 NOT_FOUND (remove notFound branch)", async () => {
    const nonExistentId = "e".repeat(24);
    const r = await request(server)
      .delete(`/acts/${nonExistentId}`)
      .expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.code).toBe("NOT_FOUND");
  });

  it("update: after a delete, patching same id → 404 (distinct path from getById 404)", async () => {
    // create
    const c = await request(server)
      .post("/acts")
      .send(minimalAct())
      .expect(201);
    const created = zActDto.parse(c.body);

    // delete
    await request(server).delete(`/acts/${created._id}`).expect(204);

    // patch same id (triggers update's notFound path)
    const r = await request(server)
      .patch(`/acts/${created._id}`)
      .send({ websiteUrl: "https://after-delete.example" })
      .expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.code).toBe("NOT_FOUND");
  });
});
