// backend/services/log/src/controllers/logController.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { z } from "zod";
import { LogContract } from "@shared/contracts/log";
import Log from "../models/Log";
import { domainToDb } from "../mappers/log.mapper";

const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.status(200).json({ ok: true, service: "log" });
});

// Accept single object or non-empty array
const zIngestBody = z.union([LogContract, z.array(LogContract).min(1)]);

export const create: RequestHandler = asyncHandler(async (req, res) => {
  const parsed = zIngestBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.message,
        details: parsed.error.flatten?.(),
      },
    });
  }

  const userId =
    (req as any).user?._id || (req as any).user?.userId || undefined;

  const items = (Array.isArray(parsed.data) ? parsed.data : [parsed.data]).map(
    (e) => ({ ...e, userId })
  );

  const docs = await Log.insertMany(
    items.map((e) => domainToDb(e as any)),
    {
      ordered: true,
    }
  );

  return res.status(202).json({ accepted: docs.length });
});
