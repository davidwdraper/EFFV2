"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zObjectId = void 0;
// backend/services/shared/contracts/objectId.ts
const zod_1 = require("zod");
/**
 * Canonical ObjectId schema.
 * Accepts:
 *  - native ObjectId (already cast by Mongoose), OR
 *  - 24-char hex string
 */
exports.zObjectId = zod_1.z
    .union([
    // Hex string pattern
    zod_1.z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId format"),
    // Allow pass-through of actual ObjectId instances (rare in DTOs, but safe)
    zod_1.z
        .any()
        .refine((val) => val &&
        typeof val === "object" &&
        val.constructor?.name === "ObjectId", {
        message: "Invalid ObjectId instance",
    }),
])
    .transform((v) => (typeof v === "string" ? v : String(v)));
