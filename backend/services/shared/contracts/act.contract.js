"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actContract = exports.nonEmptyStringArray = exports.blackoutDaysSchema = exports.timeStringSchema = void 0;
// backend/services/shared/contracts/act.contract.ts
const zod_1 = require("zod");
/**
 * Canonical Act contract (Zod-first).
 * - homeTown/homeTownId/state are always required.
 * - actLoc is always required (used for spatial queries).
 * - Mailing address (street1, street2, city, state, zip) is OPTIONAL.
 *   If provided, it overrides actLoc (geocoded lat/lng).
 */
exports.timeStringSchema = zod_1.z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'must be "HH:MM" or "HH:MM:SS" (24h)');
exports.blackoutDaysSchema = zod_1.z
    .array(zod_1.z.boolean())
    .length(7, "blackoutDays must be exactly 7 booleans");
exports.nonEmptyStringArray = zod_1.z
    .array(zod_1.z.string().transform((s) => s.trim()))
    .refine((arr) => arr.length > 0, "must be a non-empty array")
    .refine((arr) => arr.every((s) => s.length > 0), "all items must be non-empty strings");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
exports.actContract = zod_1.z.object({
    _id: zod_1.z.string().optional(),
    dateCreated: zod_1.z.date().optional(),
    dateLastUpdated: zod_1.z.date().optional(),
    actStatus: zod_1.z.number().int().default(0),
    actType: zod_1.z.array(zod_1.z.number().int()).nonempty(),
    userCreateId: zod_1.z.string().min(1),
    userOwnerId: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    nameNormalized: zod_1.z.string().min(1),
    aliases: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    email: zod_1.z.string().regex(EMAIL_RE, "Invalid email address").optional(),
    // Hometown (always required)
    homeTown: zod_1.z.string().min(1),
    state: zod_1.z.string().min(1),
    homeTownId: zod_1.z.string().min(1),
    // Optional mailing address (if provided, used for geocoding actLoc)
    addressStreet1: zod_1.z.string().optional(),
    addressStreet2: zod_1.z.string().optional(),
    addressCity: zod_1.z.string().optional(),
    addressState: zod_1.z.string().optional(),
    addressZip: zod_1.z.string().regex(ZIP_RE, "Invalid ZIP code").optional(),
    // Spatial point for search (always required)
    actLoc: zod_1.z.object({
        type: zod_1.z.literal("Point"),
        coordinates: zod_1.z.tuple([zod_1.z.number(), zod_1.z.number()]), // [lng, lat]
    }),
    imageIds: zod_1.z.array(zod_1.z.string()).default([]),
    websiteUrl: zod_1.z.string().url().optional(),
    distanceWillingToTravel: zod_1.z.number().min(0),
    genreList: exports.nonEmptyStringArray,
    actDuration: zod_1.z.number().min(0),
    breakLength: zod_1.z.number().int().min(0),
    numberOfBreaks: zod_1.z.number().int().min(0),
    bookingNotes: zod_1.z.string().optional(),
    earliestStartTime: exports.timeStringSchema.optional(),
    latestStartTime: exports.timeStringSchema.optional(),
    blackoutDays: exports.blackoutDaysSchema.optional(),
    validatedBy: zod_1.z.array(zod_1.z.string().min(1)).max(3).default([]),
    invalidatedBy: zod_1.z.array(zod_1.z.string().min(1)).max(3).default([]),
});
