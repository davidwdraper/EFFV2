// PATH: backend/services/user/src/controllers/handlers/getUserByEmailWithPassword.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@eff/shared/src/middleware/asyncHandler";
import { normalizeEmail } from "@eff/shared/src/tenant/bucket";
import * as repo from "../../repo/userRepo";

// GET /api/users/private/email/:email
// Returns a safe user DTO AND the hashed password (for auth service only).
export const getUserByEmailWithPassword: RequestHandler = asyncHandler(
  async (req, res) => {
    const raw = String(req.params.email || "");
    const email = normalizeEmail(raw);

    const doc = await repo.findByEmailWithPassword(email);
    if (!doc) return res.status(404).json({ error: "User not found" });

    // Build safe user DTO (mirror model transform without password)
    const user = {
      id: String((doc as any)._id ?? doc.id),
      email: String(doc.email),
      firstname: String(doc.firstname ?? ""),
      middlename:
        (typeof doc.middlename === "string" && doc.middlename.trim()) ||
        undefined,
      lastname: String(doc.lastname ?? ""),
      userStatus: Number(doc.userStatus ?? 0),
      userType: Number(doc.userType ?? 0),
      imageIds: Array.isArray(doc.imageIds) ? doc.imageIds : [],
      userEntryId:
        typeof (doc as any).userEntryId === "string"
          ? (doc as any).userEntryId
          : undefined,
      userOwnerId:
        typeof (doc as any).userOwnerId === "string"
          ? (doc as any).userOwnerId
          : undefined,
      dateCreated:
        (doc as any).dateCreated instanceof Date
          ? (doc as any).dateCreated.toISOString()
          : String((doc as any).dateCreated ?? ""),
      dateLastUpdated:
        (doc as any).dateLastUpdated instanceof Date
          ? (doc as any).dateLastUpdated.toISOString()
          : String((doc as any).dateLastUpdated ?? ""),
    };

    // Explicitly include the hashed password for auth only
    const password =
      typeof (doc as any).password === "string" ? (doc as any).password : "";

    return res.status(200).json({ user, password });
  }
);

export default getUserByEmailWithPassword;
