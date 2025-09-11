// backend/services/shared/contracts/objectId.ts
import { z } from "zod";

/**
 * Canonical ObjectId schema.
 * Accepts:
 *  - native ObjectId (already cast by Mongoose), OR
 *  - 24-char hex string
 */
export const zObjectId = z
  .union([
    // Hex string pattern
    z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId format"),
    // Allow pass-through of actual ObjectId instances (rare in DTOs, but safe)
    z
      .any()
      .refine(
        (val) =>
          val &&
          typeof val === "object" &&
          val.constructor?.name === "ObjectId",
        {
          message: "Invalid ObjectId instance",
        }
      ),
  ])
  .transform((v) => (typeof v === "string" ? v : String(v)));
