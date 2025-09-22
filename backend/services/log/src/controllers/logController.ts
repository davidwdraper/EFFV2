// backend/services/log/src/controllers/logController.ts

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { LogContract } from "@eff/shared/src/contracts/log.contract";
import Log from "../models/Log";
import { domainToDb } from "../mappers/log.mapper";

// Small helper to surface async errors to Express error middleware
const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.status(200).json({ ok: true, service: "log" });
});

/**
 * Accept either:
 *  - a single log object matching LogContract, or
 *  - a non-empty array of LogContract
 *
 * IMPORTANT: Build the union from LogContract’s own Zod instance to avoid
 * cross-instance type mismatches (the “_zod.version.minor” error).
 */
const zIngestBody = LogContract.or(LogContract.array().min(1));

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zIngestBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.message,
        details:
          typeof parsed.error.flatten === "function"
            ? parsed.error.flatten()
            : undefined,
      },
    });
  }

  // Optional user linkage if your auth middleware decorates req.user
  const userId =
    (req as any).user?._id || (req as any).user?.userId || undefined;

  const items = (Array.isArray(parsed.data) ? parsed.data : [parsed.data]).map(
    (e) => ({ ...e, userId })
  );

  // Map domain → DB shape and insert
  const docs = await Log.insertMany(
    items.map((e) => domainToDb(e as any)),
    {
      ordered: true,
    }
  );

  return res.status(202).json({ accepted: docs.length });
});
