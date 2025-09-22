// backend/services/act/test/act.controller.branches.more2.spec.ts

// ── Env first (so app/db see the right vars) ──────────────────────────────────
import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({
  path: path.resolve(process.cwd(), process.env.ENV_FILE || ".env.test"),
});

// Minimal hermetic defaults for this file
if (!process.env.ACT_SEARCH_UNFILTERED_CUTOFF)
  process.env.ACT_SEARCH_UNFILTERED_CUTOFF = "25";
if (process.env.REDIS_DISABLED == null) process.env.REDIS_DISABLED = "1";
process.env.NODE_ENV = process.env.NODE_ENV || "test";

// ── Test harness ──────────────────────────────────────────────────────────────
import http from "node:http";
import request from "supertest";
import { randomBytes } from "crypto";
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";
import type { Express } from "express";
import { zProblem } from "@shared/src/contracts/common";
import { zActDto } from "@shared/contracts/act";

// helper: 24-hex like Mongo ObjectId string
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
  // cleanup any rows we created
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
describe("Act controller – missing-doc & validation branches", () => {
  it("update: valid ObjectId but document missing → 404 NOT_FOUND", async () => {
    const missingId = oid(); // syntactically valid ObjectId
    const r = await request(server)
      .patch(`/acts/${missingId}`)
      .send({ websiteUrl: "https://example.com/x" })
      .expect(404);

    const prob = zProblem.parse(r.body);
    expect(prob.code).toBe("NOT_FOUND");
    expect(prob.status).toBe(404);
  });

  it("remove: valid ObjectId but document missing → 404 NOT_FOUND", async () => {
    const missingId = oid();
    const r = await request(server).delete(`/acts/${missingId}`).expect(404);
    const prob = zProblem.parse(r.body);
    expect(prob.code).toBe("NOT_FOUND");
    expect(prob.status).toBe(404);
  });

  it("list: zod validation (negative limit) → BAD_REQUEST 400", async () => {
    const r = await request(server).get("/acts?limit=-1&offset=0").expect(400);

    const prob = zProblem.parse(r.body);
    expect(prob.status).toBe(400);
    expect(prob.code).toBe("BAD_REQUEST"); // list uses zodBadRequest
  });

  it("sanity: create then delete (keeps coverage stable for success paths)", async () => {
    const payload = {
      actType: [1],
      userCreateId: oid(),
      userOwnerId: oid(),
      name: `BRANCH_${Math.random().toString(36).slice(2, 8)}`,
      homeTown: "Austin, TX",
      homeTownId: oid(),
      homeTownLoc: { type: "Point", coordinates: [-97.7431, 30.2672] },
    };

    const c = await request(server).post("/acts").send(payload).expect(201);
    const created = zActDto.parse(c.body);
    createdIds.add(created._id);

    await request(server).delete(`/acts/${created._id}`).expect(204);
    createdIds.delete(created._id);
  });
});
