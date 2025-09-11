// backend/services/act/src/validators/act.dto.ts
import { z } from "zod";
import {
  actContract,
  timeStringSchema,
} from "@shared/src/contracts/act.contract";

/**
 * CREATE (API surface):
 * Minimal fields accepted at the edge; repo/model will fill/derive the rest.
 * IMPORTANT: passthrough so we don't drop required fields the repo/model expects.
 */
export const createActDto = z
  .object({
    name: z.string().min(1),
    websiteUrl: actContract.shape.websiteUrl.optional(),
    tags: z.array(z.string().min(1)).optional(),
    // Allow direct location if caller provides one; repo may override/derive
    actLoc: actContract.shape.actLoc.optional(),
  })
  .passthrough();

/**
 * UPDATE (API surface):
 * Partial, constrained to fields that make sense to change.
 */
export const updateActDto = z.object({
  actStatus: z.number().int().optional(),
  actType: z.array(z.number().int()).nonempty().optional(),
  userOwnerId: z.string().min(1).optional(),

  name: z.string().min(1).optional(),
  aliases: z.array(z.string().min(1)).optional(),
  email: actContract.shape.email.optional(),

  homeTown: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  homeTownId: z.string().min(1).optional(),

  // Flat address fields; if provided, repo may trigger geocoding
  addressStreet1: z.string().optional(),
  addressStreet2: z.string().optional(),
  addressCity: z.string().optional(),
  addressState: z.string().optional(),
  addressZip: actContract.shape.addressZip.optional(),

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
  center: z.tuple([z.number(), z.number()]),
  maxMiles: z.number().positive(),
  actType: z.array(z.number().int()).optional(),
  genre: z.string().optional(),
  nameLike: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const findByIdDto = z.object({
  id: z.string().min(1),
});

export type CreateActDto = z.infer<typeof createActDto>;
export type UpdateActDto = z.infer<typeof updateActDto>;
export type SearchByRadiusDto = z.infer<typeof searchByRadiusDto>;
