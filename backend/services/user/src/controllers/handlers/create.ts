// backend/services/user/src/controllers/handlers/create.ts
import { Request, Response, NextFunction } from "express";
import { zUserReplace } from "@eff/shared/src/contracts/user.contract";
import * as repo from "../../repo/userRepo";
import type { MongoServerError } from "mongodb";

/**
 * Create via PUT /api/user (collection root)
 * - Validates zUserReplace (email, firstname, lastname; optionals ok)
 * - NO dates here (model stamps dateCreated/dateLastUpdated)
 * - NO password here (auth service sets it later)
 * - Mongo/Mongoose generates _id; response returns domain-safe object
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  const rid = (req as any).id;
  try {
    const input = zUserReplace.parse(req.body);

    const created = await repo.create({
      email: input.email,
      firstname: input.firstname,
      middlename: input.middlename ?? undefined,
      lastname: input.lastname,
      userStatus: input.userStatus ?? 0,
      userType: input.userType ?? 0,
      imageIds: input.imageIds ?? [],
      // optional provenance
      userEntryId: (req as any).auth?.svc ?? undefined,
      userOwnerId: undefined,
    });

    // Audit (buffered; global flush later)
    (req as any).audit?.push({
      rid,
      action: "user:create",
      subject: created.id ?? created._id,
      meta: { email: created.email },
    });

    res.status(201).json(created);
  } catch (err) {
    const e = err as Partial<MongoServerError>;
    if (e?.code === 11000 && e?.keyPattern?.email) {
      return res.status(409).json({
        code: "CONFLICT",
        status: 409,
        message: "Email already exists",
      });
    }
    next(err); // global problemJson middleware will shape this
  }
}

export default create;
