// backend/services/log/src/controllers/logController.ts
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { dateNowIso } from "@shared/utils/dateUtils";
import Log from "../models/Log";
import { ILogFields } from "@shared/interfaces/Log/ILog";

const asyncHandler =
  (fn: RequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const ping: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ ok: true, service: "log", ts: dateNowIso() });
});

export const create: RequestHandler = asyncHandler(async (req, res) => {
  // Do not allow caller to forge userId
  if ("userId" in (req.body ?? {})) {
    return res.status(400).send({ error: "userId cannot be set manually" });
  }

  // Accept your original payload shape; align with shared interface
  const {
    logType,
    logSeverity,
    message,
    path,
    entityId,
    entityName,
    // you referenced these in your route; we’ll pass them through if your model supports them
    service,
    sourceFile,
    sourceLine,
  } = (req.body ?? {}) as Partial<ILogFields> & {
    service?: string;
    sourceFile?: string;
    sourceLine?: number | string;
  };

  if (
    typeof logType !== "number" ||
    typeof logSeverity !== "number" ||
    typeof message !== "string"
  ) {
    return res
      .status(400)
      .send({ error: "logType, logSeverity, and message are required" });
  }

  const timeCreated = dateNowIso();
  const userId = (req as any).user?._id || undefined;

  const doc = await Log.create({
    logType,
    logSeverity,
    message,
    path,
    entityId,
    entityName,
    userId,
    timeCreated,
    // These will persist only if your schema includes them; see note below
    service,
    sourceFile,
    sourceLine,
  } as any);

  res.status(201).send(doc.toObject());
});
