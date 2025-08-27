// backend/services/act/src/controllers/act/handlers/create.ts
import type { RequestHandler } from "express";
import { asyncHandler } from "@shared/middleware/asyncHandler";
import { zActCreate, zActDto, clean, respond } from "@shared/contracts";
import * as repo from "../../../repo/actRepo";
import { toActDto, toWire } from "../../../dto/actDto";

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zActCreate.safeParse(req.body ?? {});
  if (!parsed.success) {
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
          errors: parsed.error.issues?.map((i) => ({
            path: i.path,
            message: i.message,
            code: i.code,
            expected: (i as any).expected,
            received: (i as any).received,
          })),
        })
      );
  }
  const body = parsed.data as Record<string, any>;

  const nowIso = new Date().toISOString();
  const toInsert = clean({
    ...toWire(body),
    dateCreated: (body as any).dateCreated ?? nowIso,
    dateLastUpdated: nowIso,
  });

  if (typeof body?.homeTownId === "string" && body.homeTownId.trim() !== "") {
    const doc = await repo.upsertByNameAndHometown(
      body.name,
      body.homeTownId,
      toInsert
    );
    return respond(res, zActDto, toActDto(doc), 201);
  }

  try {
    const created = await repo.create(toInsert);
    const lean = await repo.findById(String(created._id));
    return respond(res, zActDto, toActDto(lean), 201);
  } catch (err: any) {
    const isDup =
      err?.code === 11000 ||
      err?.code === "11000" ||
      (typeof err?.message === "string" &&
        /E11000 duplicate key/i.test(err.message));
    if (isDup && body?.name) {
      const existing = await repo.findByName(body.name);
      if (existing) return respond(res, zActDto, toActDto(existing), 201);
    }
    throw err;
  }
});
