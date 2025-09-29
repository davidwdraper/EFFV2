// backend/services/act/test/act.more-coverage.spec.ts
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app";
import Act from "../src/models/Act";
import Town from "../src/models/Town";

describe("Act controller additional coverage", () => {
  let homeTown: any;
  let seededActId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    // Ensure at least one NVTEST_* town exists for any geo-related model fields
    homeTown =
      (await Town.findOne({ name: { $regex: /^NVTEST_/ } }).lean()) ||
      (await Town.create({
        name: "NVTEST_CoverageTown",
        state: "ZZ",
        lat: 0,
        lng: 0,
        loc: { type: "Point", coordinates: [0, 0] },
      }));

    // Seed an act directly (bypass POST schema friction)
    const now = new Date().toISOString();
    const coords = (homeTown.loc?.coordinates || [
      homeTown.lng,
      homeTown.lat,
    ]) as [number, number];
    const [lng, lat] = coords.map(Number);

    const seeded = await Act.create({
      dateCreated: now,
      dateLastUpdated: now,
      actStatus: 0,
      actType: [1],
      userCreateId: "u1",
      userOwnerId: "u1",
      name: "Coverage Duo Plain",
      homeTown: `${homeTown.name}, ${homeTown.state}`,
      homeTownId: new mongoose.Types.ObjectId(homeTown._id),
      homeTownLoc: { type: "Point", coordinates: [lng, lat] },
      imageIds: [],
      email: "cov@example.com",
    });
    seededActId = seeded._id as unknown as mongoose.Types.ObjectId;
  });

  it("PUT /acts/:id validation error path (non-empty actType)", async () => {
    const target = seededActId || (await Act.findOne({}).lean())?._id;
    if (!target) return; // nothing to update; skip
    const bad = await request(app)
      .put(`/acts/${target}`)
      .send({ actType: [] }) // violates validator
      .expect(400);
    expect(bad.body?.code || bad.body?.title).toBeTruthy();
  });

  it("DELETE /acts/:id NOT_FOUND path", async () => {
    const r = await request(app)
      .delete(`/acts/${new mongoose.Types.ObjectId()}`)
      .expect(404);
    expect(r.body?.status).toBe(404);
  });
});
