// backend/services/log/src/controllers/logController.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { LogCreateDto } from "../validators/log.dto";
import Log from "../models/Log";
import { dbToDomain, domainToDb } from "../mappers/log.mapper";

const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, service: "log" });
});

export const create: RequestHandler = asyncHandler(async (req, res) => {
  // Validate against canonical DTO (derived from Zod contract)
  const parsed = LogCreateDto.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.message,
      },
    });
  }

  // Enforce: caller cannot set userId; stamp from auth if available
  const userId =
    (req as any).user?._id || (req as any).user?.userId || undefined;

  const doc = await Log.create(
    domainToDb({
      ...parsed.data,
      userId,
    } as any)
  );

  res.status(201).json(dbToDomain(doc));
});
