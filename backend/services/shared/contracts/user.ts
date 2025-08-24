// backend/services/shared/contracts/user.ts
import { z } from "zod";
import { zObjectId, zIsoDate } from "./common";

// Optional: keep TS type aliases for convenience (not used as schemas)
type ObjectIdString = z.infer<typeof zObjectId>;
type ISODateString = z.infer<typeof zIsoDate>;

export const UserDTO = z.object({
  _id: zObjectId, // <-- schema, not type
  email: z.string().email(),
  firstname: z.string().min(1),
  middlename: z.string().optional(),
  lastname: z.string().min(1),
  userStatus: z.number().int(),
  userType: z.number().int(),
  imageIds: z.array(z.string()).default([]),
  userEntryId: z.string().optional(),
  userOwnerId: z.string().optional(),
  dateCreated: zIsoDate, // <-- schema
  dateLastUpdated: zIsoDate, // <-- schema
});
export type UserDTO = z.infer<typeof UserDTO>;

export const UserCreateInput = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstname: z.string().min(1),
  lastname: z.string().min(1),
  middlename: z.string().optional(),
});
export type UserCreateInput = z.infer<typeof UserCreateInput>;
