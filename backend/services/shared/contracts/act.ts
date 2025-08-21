// backend/services/shared/contracts/act.ts
import { z } from "zod";
import {
  zObjectId,
  zIsoDate,
  zPagination,
  zGeoQuery,
  zTimeOfDay,
  zListResponse,
} from "./common";

/** GeoJSON Point for hometown location */
export const zHomeTownLoc = z.object({
  type: z.literal("Point").optional(), // legacy-friendly
  coordinates: z
    .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) // [lng, lat]
    .or(z.array(z.number()).length(2)),
});

/** Genre as numeric enumeration (expand later) */
export const zGenreCode = z.number().int();

/** DB shape (Mongo read) */
export const zActDb = z.object({
  _id: zObjectId,
  dateCreated: zIsoDate,
  dateLastUpdated: zIsoDate,
  actStatus: z.number().int(),
  actType: z.array(z.number().int()).min(1),
  userCreateId: zObjectId,
  userOwnerId: zObjectId,
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  imageIds: z.array(zObjectId).max(10).optional(),

  // Hometown/geo
  homeTown: z.string().min(1).max(200),
  homeTownId: z.string().min(1).max(100),
  homeTownLoc: zHomeTownLoc,

  // Optional booking/config fields
  websiteUrl: z.string().url().optional(),
  distanceWillingToTravel: z.coerce.number().int().min(0).optional(), // miles
  genreList: z.array(zGenreCode).optional(),
  actDuration: z.coerce.number().int().min(0).optional(), // minutes
  breakLength: z.coerce.number().int().min(0).optional(), // minutes
  numberOfBreaks: z.coerce.number().int().min(0).optional(),
  bookingNotes: z.string().optional(),
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
});

/** Wire DTO (normalize dates to ISO strings; keep _id) */
export const zActDto = z.object({
  _id: zObjectId,
  dateCreated: z.string(),
  dateLastUpdated: z.string(),
  actStatus: z.number().int(),
  actType: z.array(z.number().int()),
  userCreateId: zObjectId,
  userOwnerId: zObjectId,
  name: z.string(),
  email: z.string().email().optional(),
  imageIds: z.array(zObjectId).optional(),

  homeTown: z.string(),
  homeTownId: z.string(),
  homeTownLoc: zHomeTownLoc,

  websiteUrl: z.string().url().optional(),
  distanceWillingToTravel: z.number().int().optional(),
  genreList: z.array(zGenreCode).optional(),
  actDuration: z.number().int().optional(),
  breakLength: z.number().int().optional(),
  numberOfBreaks: z.number().int().optional(),
  bookingNotes: z.string().optional(),
  earliestStartTime: z.string().optional(),
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

/** Create input */
export const zActCreate = z.object({
  actStatus: z.number().int().optional(),
  actType: z.array(z.number().int()).min(1),
  userCreateId: zObjectId,
  userOwnerId: zObjectId,
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  imageIds: z.array(zObjectId).max(10).optional(),

  homeTown: z.string().min(1).max(200),
  homeTownId: z.string().min(1).max(100),
  homeTownLoc: zHomeTownLoc,

  websiteUrl: z.string().url().optional(),
  distanceWillingToTravel: z.coerce.number().int().min(0).optional(),
  genreList: z.array(zGenreCode).optional(),
  actDuration: z.coerce.number().int().min(0).optional(),
  breakLength: z.coerce.number().int().min(0).optional(),
  numberOfBreaks: z.coerce.number().int().min(0).optional(),
  bookingNotes: z.string().optional(),
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
});

/** Update input (partial, at least one key) */
export const zActUpdate = z
  .object({
    actStatus: z.number().int().optional(),
    actType: z.array(z.number().int()).min(1).optional(),
    userOwnerId: zObjectId.optional(),
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().optional(),
    imageIds: z.array(zObjectId).max(10).optional(),

    homeTown: z.string().min(1).max(200).optional(),
    homeTownId: z.string().min(1).max(100).optional(),
    homeTownLoc: zHomeTownLoc.optional(),

    websiteUrl: z.string().url().optional(),
    distanceWillingToTravel: z.coerce.number().int().min(0).optional(),
    genreList: z.array(zGenreCode).optional(),
    actDuration: z.coerce.number().int().min(0).optional(),
    breakLength: z.coerce.number().int().min(0).optional(),
    numberOfBreaks: z.coerce.number().int().min(0).optional(),
    bookingNotes: z.string().optional(),
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
  .refine((o) => Object.keys(o).length > 0, {
    message: "At least one field must be provided",
  });

/** Search queries */
export const zActSearchQuery = zPagination.extend({
  q: z.string().trim().min(1).max(200).optional(),
});
export const zActByHometownQuery = zPagination.merge(zGeoQuery).extend({
  q: z.string().trim().min(1).max(200).optional(),
});

/** List DTO */
export const zActListDto = zListResponse(zActDto);

/** Inferred TS types (frontend can import these) */
export type ActDb = z.infer<typeof zActDb>;
export type ActDto = z.infer<typeof zActDto>;
export type ActCreate = z.infer<typeof zActCreate>;
export type ActUpdate = z.infer<typeof zActUpdate>;
export type ActSearchQuery = z.infer<typeof zActSearchQuery>;
export type ActByHometownQuery = z.infer<typeof zActByHometownQuery>;
export type ActListDto = z.infer<typeof zActListDto>;
