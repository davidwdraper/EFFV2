// backend/services/act/src/controllers/act/handlers/update.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import {
  zodBadRequest,
  zActUpdate,
  clean,
  respond,
  zActDto,
} from "@shared/contracts";
import { notFound } from "@shared/http/errors";
import * as repo from "../../../repo/actRepo";
import { toActDto, toWire } from "../../../dto/actDto";
import { zIdParam } from "./schemas";

export const update: RequestHandler = asyncHandler(async (req, res) => {
  const idParsed = zIdParam.safeParse(req.params);
  if (!idParsed.success) return zodBadRequest(res, idParsed.error);
  const { id } = idParsed.data;

  const bodyParsed = zActUpdate.safeParse(req.body ?? {});
  if (!bodyParsed.success) {
    return res
      .status(400)
      .type("application/problem+json")
      .json(
        clean({
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          code: "VALIDATION_ERROR",
          detail: "Validation failed",
          errors: bodyParsed.error.issues?.map((i) => ({
            path: i.path,
            message: i.message,
            code: i.code,
            expected: (i as any).expected,
            received: (i as any).received,
          })),
        })
      );
  }

  // Enforce non-empty actType when provided (matches spec)
  if (
    Object.prototype.hasOwnProperty.call(bodyParsed.data, "actType") &&
    Array.isArray((bodyParsed.data as any).actType) &&
    (bodyParsed.data as any).actType.length === 0
  ) {
    return res
      .status(400)
      .type("application/problem+json")
      .json(
        clean({
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          code: "VALIDATION_ERROR",
          detail: "Validation failed",
          errors: [
            {
              path: ["actType"],
              message: "actType must contain at least one value",
              code: "too_small",
              minimum: 1,
              type: "array",
              inclusive: true,
            },
          ],
        })
      );
  }

  const updateBody = clean({
    ...toWire(bodyParsed.data),
    dateLastUpdated: new Date().toISOString(),
  });

  const doc = await repo.updateById(id, updateBody);
  if (!doc) return notFound(res);
  return respond(res, zActDto, toActDto(doc));
});
