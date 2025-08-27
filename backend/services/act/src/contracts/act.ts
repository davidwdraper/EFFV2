// backend/services/act/src/contracts/act.ts
import { z, ZodError } from "zod";
import type { Response } from "express";

/**
 * Local Act contracts (Zod) + small HTTP helpers
 * ------------------------------------------------
 * Purpose: unblock the Act service from alias/barrel drift by keeping a
 * minimal, self-contained set of schemas that controllers can import.
 *
 * These mirror the shared contracts we’ve been using:
 *  - zActCreate  : input validation for POST /acts
 *  - zActDto     : output DTO validation (what we send over the wire)
 *  - clean       : strip undefined fields from objects
 *  - respond     : validate + send JSON with status
 *  - zodBadRequest: RFC7807 response for Zod validation failures
 *
 * Notes:
 *  - GeoJSON points stored as { type: "Point", coordinates: [lng, lat] }.
 *  - actType accepts scalar int or non-empty int[] and normalizes to [].
 *  - Optional string fields tolerate "" → undefined where it helps tests.
 *  - Times are "HH:MM" or "HH:MM:SS" (24-hour).
 */

// ---------- Small helpers (HTTP + utilities) ----------

export function clean<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

export function respond<T extends z.ZodTypeAny>(
  res: Response,
  schema: T,
  payload: unknown,
  status = 200
) {
  const out = schema.parse(payload);
  return res.status(status).json(out);
}

export function zodBadRequest(res: Response, error: ZodError) {
  const errors = error.issues.map((i) => ({
    path: Array.isArray(i.path) ? i.path.join(".") : String(i.path ?? ""),
    code: i.code,
    message: i.message,
  }));
  return res.status(400).json({
    type: "about:blank",
    title: "Bad Request",
    status: 400,
    code: "BAD_REQUEST",
    detail: "Validation failed",
    errors,
  });
}

// ---------- Primitives used by the Act contracts ----------

/** Mongo ObjectId as 24 hex chars */
const zObjectId = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Expected 24-hex Mongo ObjectId");

/** Time-of-day "HH:MM" or "HH:MM:SS" (24h) */
const zTimeOfDay = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
    'Expected "HH:MM" or "HH:MM:SS"'
  );

/** GeoJSON Point for hometown location (controller ensures [lng, lat]) */
export const zHomeTownLoc = z.object({
  type: z.literal("Point").optional(),
  coordinates: z.tuple([
    z.coerce.number().min(-180).max(180), // lng
    z.coerce.number().min(-90).max(90), // lat
  ]),
});

/** Accept scalar or non-empty array; normalize to array */
const zActTypeFlexible = z
  .union([z.array(z.number().int()).min(1), z.coerce.number().int()])
  .transform((v) => (Array.isArray(v) ? v : [v]));

/** Optional strings that may be "" from clients/tests -> normalize to undefined */
const zOptEmail = z
  .union([z.string().email(), z.literal("")])
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const zOptUrl = z
  .union([z.string().url(), z.literal("")])
  .optional()
  .transform((v) => (v === "" ? undefined : v));

// ---------- Output DTO (what controllers send back) ----------

export const zActDto = z.object({
  _id: zObjectId,
  dateCreated: z.string(), // ISO string
  dateLastUpdated: z.string(), // ISO string

  actStatus: z.number().int().optional(),
  actType: z.array(z.number().int()),

  userCreateId: zObjectId,
  userOwnerId: zObjectId,

  name: z.string().optional(),
  email: z.string().email().optional(),
  imageIds: z.array(zObjectId).optional(),

  // Hometown / geo
  homeTown: z.string(),
  homeTownId: z.string(),
  homeTownLoc: zHomeTownLoc,

  // Optional booking/config fields
  websiteUrl: z.string().url().optional(),
  distanceWillingToTravel: z.number().int().optional(), // miles
  genreList: z.array(z.number().int()).optional(),
  actDuration: z.number().int().optional(), // minutes
  breakLength: z.number().int().optional(), // minutes
  numberOfBreaks: z.number().int().optional(),
  bookingNotes: z.string().optional(),
  earliestStartTime: z.string().optional(), // "HH:MM" or "HH:MM:SS"
  latestStartTime: z.string().optional(),
  blackoutDays: z
    .tuple([
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
      z.boolean(),
    ])
    .optional(),
});

// ---------- Create input (POST /acts) ----------

export const zActCreate = z
  .object({
    actStatus: z.number().int().optional(),
    actType: zActTypeFlexible,

    userCreateId: zObjectId,
    userOwnerId: zObjectId,

    name: z.coerce.string().min(1).max(200),
    email: zOptEmail,
    imageIds: z.array(zObjectId).max(10).optional(),

    // Hometown / geo
    homeTown: z.coerce.string().min(1).max(200),
    homeTownId: z.coerce.string().min(1).max(100),
    homeTownLoc: zHomeTownLoc,

    // Optional booking/config
    websiteUrl: zOptUrl,
    distanceWillingToTravel: z.coerce.number().int().min(0).optional(),
    genreList: z.array(z.number().int()).optional(),
    actDuration: z.coerce.number().int().min(0).optional(),
    breakLength: z.coerce.number().int().min(0).optional(),
    numberOfBreaks: z.coerce.number().int().min(0).optional(),
    bookingNotes: z.coerce.string().optional(),
    earliestStartTime: zTimeOfDay.optional(),
    latestStartTime: zTimeOfDay.optional(),
    blackoutDays: z
      .tuple([
        z.boolean(),
        z.boolean(),
        z.boolean(),
        z.boolean(),
        z.boolean(),
        z.boolean(),
        z.boolean(),
      ])
      .optional(),
  })
  .strip();
