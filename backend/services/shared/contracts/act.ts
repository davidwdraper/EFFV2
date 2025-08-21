// backend/services/shared/contracts/act.ts
import { z } from "zod";
import { ObjectIdString, ISODateString, GeoPoint, Paged } from "./common";

export const ActDTO = z.object({
  _id: ObjectIdString,
  name: z.string().min(1),
  email: z.string().email().optional(),
  homeTown: z.string().min(1),
  homeTownId: ObjectIdString,
  homeTownLoc: GeoPoint,
  imageIds: z.array(z.string()).default([]),
  dateCreated: ISODateString,
  dateLastUpdated: ISODateString,
  actStatus: z.number().int(),
  actType: z.array(z.number().int()),
  userCreateId: z.string(),
  userOwnerId: z.string(),
});
export type ActDTO = z.infer<typeof ActDTO>;

export const ActListResponse = Paged(ActDTO);
export type ActListResponse = z.infer<typeof ActListResponse>;

export const ActSearchQuery = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  miles: z.coerce.number().positive(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ActSearchQuery = z.infer<typeof ActSearchQuery>;
