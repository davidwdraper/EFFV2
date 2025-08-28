// backend/services/act/src/validators/act.dto.ts
import { z } from "zod";
import {
  actContract,
  timeStringSchema,
} from "../../../shared/contracts/act.contract";

// CREATE: everything except DB-managed fields
// backend/services/act/src/validators/act.dto.ts
export const createActDto = actContract
  .omit({ _id: true, dateCreated: true, dateLastUpdated: true })
  .extend({
    // allow caller to omit; repo will fallback to town coords
    actLoc: actContract.shape.actLoc.optional(),
  });

// UPDATE: partial, but keep invariants on nested objects
export const updateActDto = z.object({
  // Only allow fields that make sense to change
  actStatus: z.number().int().optional(),
  actType: z.array(z.number().int()).nonempty().optional(),
  userOwnerId: z.string().min(1).optional(),

  name: z.string().min(1).optional(),
  aliases: z.array(z.string().min(1)).optional(),
  email: actContract.shape.email.optional(),

  // Town context is usually stable; allow correction if needed
  homeTown: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  homeTownId: z.string().min(1).optional(),

  // Optional mailing address (if provided, will trigger geocoding)
  addressStreet1: z.string().optional(),
  addressStreet2: z.string().optional(),
  addressCity: z.string().optional(),
  addressState: z.string().optional(),
  addressZip: actContract.shape.addressZip.optional(),

  // actLoc can be set directly by service (e.g., after geocode)
  actLoc: actContract.shape.actLoc.optional(),

  imageIds: z.array(z.string()).optional(),

  websiteUrl: z.string().url().optional(),
  distanceWillingToTravel: z.number().min(0).optional(),
  genreList: z.array(z.string().min(1)).nonempty().optional(),
  actDuration: z.number().min(0).optional(),
  breakLength: z.number().int().min(0).optional(),
  numberOfBreaks: z.number().int().min(0).optional(),

  bookingNotes: z.string().optional(),
  earliestStartTime: timeStringSchema.optional(),
  latestStartTime: timeStringSchema.optional(),
  blackoutDays: z.array(z.boolean()).length(7).optional(),

  validatedBy: z.array(z.string().min(1)).max(3).optional(),
  invalidatedBy: z.array(z.string().min(1)).max(3).optional(),
});

// Search DTOs
export const searchByRadiusDto = z.object({
  // center point [lng, lat]
  center: z.tuple([z.number(), z.number()]),
  maxMiles: z.number().positive(), // convert to meters in repo
  actType: z.array(z.number().int()).optional(),
  genre: z.string().optional(), // optional contains match
  nameLike: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const findByIdDto = z.object({
  id: z.string().min(1),
});

export type CreateActDto = z.infer<typeof createActDto>;
export type UpdateActDto = z.infer<typeof updateActDto>;
export type SearchByRadiusDto = z.infer<typeof searchByRadiusDto>;
