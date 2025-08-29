// backend/services/shared/contracts/entity.contract.ts
// DO NOT USE - COPY ONLY - THIS IS PART OF THE TEMPLATE SERVICE
//      FOR CREATING NEW SERVICES
import { z } from "zod";

/**
 * Local template contracts (Zod) for controllers.
 * In real services, prefer pulling from shared/contracts when available.
 */

export const zObjectId = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Expected 24-hex Mongo ObjectId");

export const entityContract = z.object({
  _id: zObjectId,
  dateCreated: z.string(), // ISO
  dateLastUpdated: z.string(),
  // 👇 Add required entity fields here
  name: z.string().min(1),
});

export type Entity = z.infer<typeof entityContract>;
