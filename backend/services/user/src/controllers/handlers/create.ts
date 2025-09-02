// backend/services/user/src/controllers/handlers/create.ts
import { Request, Response, NextFunction } from "express";
import { zUserReplace } from "@shared/contracts/user.contract";
import * as repo from "../../repo/userRepo";

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
    next(err); // global problemJson middleware will shape this
  }
}

export default create;
