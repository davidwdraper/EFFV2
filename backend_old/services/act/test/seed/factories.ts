// backend/services/act/test/seed/factories.ts
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import ActModel from "../../src/models/Act";
import TownModel from "../../src/models/Town";

// --------- Types ---------
type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends object ? PartialDeep<T[K]> : T[K];
};

// --------- Your original idempotent seeds (kept) ---------
export async function upsertAct(doc: PartialDeep<any> & { name: string }) {
  // Match on name to keep idempotent
  await ActModel.updateOne(
    { name: doc.name },
    {
      $setOnInsert: {
        _id: new mongoose.Types.ObjectId(),
        dateCreated: new Date(),
        dateLastUpdated: new Date(),
        userCreateId: randomUUID(),
        userOwnerId: randomUUID(),
        actStatus: 0,
        actType: [1],
        eMailAddr: "seed@nv.test",
        imageIds: [],
      },
      $set: {
        ...doc,
        dateLastUpdated: new Date(),
      },
    },
    { upsert: true }
  );
}

export async function ensureZetaActs() {
  await upsertAct({ name: "Zeta Alpha", actType: [1], actStatus: 0 });
  await upsertAct({ name: "Zeta Beta", actType: [1], actStatus: 0 });
}

// --------- Added: builders for towns & acts (for geo/radius tests) ---------
export function buildTown(overrides: Partial<any> = {}) {
  const name = overrides.name ?? "Austin";
  const state = overrides.state ?? "TX";
  const lat = overrides.lat ?? 30.2672;
  const lng = overrides.lng ?? -97.7431;
  return {
    name,
    state,
    lat,
    lng,
    county: overrides.county ?? "Travis",
    population: overrides.population ?? 900000,
    fips: overrides.fips ?? "48453",
    loc: { type: "Point", coordinates: [lng, lat] as [number, number] },
    ...overrides,
  };
}

export async function ensureTown(t: Partial<any>) {
  const doc = buildTown(t);
  await TownModel.updateOne(
    { name: doc.name, state: doc.state },
    {
      $setOnInsert: doc,
      $set: { loc: doc.loc }, // keep geo in sync
    },
    { upsert: true }
  );
  return await TownModel.findOne({ name: doc.name, state: doc.state }).lean();
}

export function buildAct(overrides: Partial<any> = {}) {
  const now = new Date();
  const userId = new mongoose.Types.ObjectId().toString();
  return {
    actId: randomUUID(),
    dateCreated: now,
    dateLastUpdated: now,
    actStatus: overrides.actStatus ?? 0,
    actType: overrides.actType ?? [1],
    userCreateId: overrides.userCreateId ?? userId,
    userOwnerId: overrides.userOwnerId ?? userId,
    name: overrides.name ?? `NVTEST Act ${randomUUID().slice(0, 8)}`,
    eMailAddr: overrides.eMailAddr ?? "act@test.local",
    imageIds: overrides.imageIds ?? [],
    hometown: overrides.hometown ?? {
      name: "Austin",
      state: "TX",
      lat: 30.2672,
      lng: -97.7431,
    },
    ...overrides,
  };
}

export async function createAct(payload: Partial<any> = {}) {
  const data = buildAct(payload);
  const created = await ActModel.create(data);
  return created.toObject();
}

export default {
  // originals
  upsertAct,
  ensureZetaActs,
  // new
  buildTown,
  ensureTown,
  buildAct,
  createAct,
};
