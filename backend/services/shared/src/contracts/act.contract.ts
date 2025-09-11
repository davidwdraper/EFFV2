// backend/services/shared/contracts/act.contract.ts
import { z } from "zod";

/**
 * Canonical Act contract (Zod-first).
 * - homeTown/homeTownId/state are always required.
 * - actLoc is always required (used for spatial queries).
 * - Mailing address (street1, street2, city, state, zip) is OPTIONAL.
 *   If provided, it overrides actLoc (geocoded lat/lng).
 */

export const timeStringSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
    'must be "HH:MM" or "HH:MM:SS" (24h)'
  );

export const blackoutDaysSchema = z
  .array(z.boolean())
  .length(7, "blackoutDays must be exactly 7 booleans");

export const nonEmptyStringArray = z
  .array(z.string().transform((s) => s.trim()))
  .refine((arr) => arr.length > 0, "must be a non-empty array")
  .refine(
    (arr) => arr.every((s) => s.length > 0),
    "all items must be non-empty strings"
  );

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

export const actContract = z.object({
  _id: z.string().optional(),
  dateCreated: z.date().optional(),
  dateLastUpdated: z.date().optional(),

  actStatus: z.number().int().default(0),
  actType: z.array(z.number().int()).nonempty(),

  userCreateId: z.string().min(1),
  userOwnerId: z.string().min(1),

  name: z.string().min(1),
  nameNormalized: z.string().min(1),
  aliases: z.array(z.string().min(1)).optional(),

  email: z.string().regex(EMAIL_RE, "Invalid email address").optional(),

  // Hometown (always required)
  homeTown: z.string().min(1),
  state: z.string().min(1),
  homeTownId: z.string().min(1),

  // Optional mailing address (if provided, used for geocoding actLoc)
  addressStreet1: z.string().optional(),
  addressStreet2: z.string().optional(),
  addressCity: z.string().optional(),
  addressState: z.string().optional(),
  addressZip: z.string().regex(ZIP_RE, "Invalid ZIP code").optional(),

  // Spatial point for search (always required)
  actLoc: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
  }),

  imageIds: z.array(z.string()).default([]),

  websiteUrl: z.string().url().optional(),
  distanceWillingToTravel: z.number().min(0),
  genreList: nonEmptyStringArray,
  actDuration: z.number().min(0),
  breakLength: z.number().int().min(0),
  numberOfBreaks: z.number().int().min(0),

  bookingNotes: z.string().optional(),
  earliestStartTime: timeStringSchema.optional(),
  latestStartTime: timeStringSchema.optional(),
  blackoutDays: blackoutDaysSchema.optional(),

  validatedBy: z.array(z.string().min(1)).max(3).default([]),
  invalidatedBy: z.array(z.string().min(1)).max(3).default([]),
});

export type Act = z.infer<typeof actContract>;
