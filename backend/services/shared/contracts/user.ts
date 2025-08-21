// backend/services/shared/contracts/user.ts
import { z } from "zod";
import { ObjectIdString, ISODateString } from "./common";

export const UserDTO = z.object({
  _id: ObjectIdString,
  email: z.string().email(),
  firstname: z.string().min(1),
  middlename: z.string().optional(),
  lastname: z.string().min(1),
  userStatus: z.number().int(),
  userType: z.number().int(),
  imageIds: z.array(z.string()).default([]),
  userEntryId: z.string().optional(),
  userOwnerId: z.string().optional(),
  dateCreated: ISODateString,
  dateLastUpdated: ISODateString,
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
