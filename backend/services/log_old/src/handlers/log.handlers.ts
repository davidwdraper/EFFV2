// backend/services/log/src/handlers/log.handlers.ts
/**
 * NowVibin — Backend
 * Service: log
 * -----------------------------------------------------------------------------
 * WHY:
 * - “Thin handlers” pattern: Validate → map → repo → return domain.
 * - Explicit trace logs make stalls obvious (enter/validated/insert start/done).
 * - LOG_BYPASS_DB=1 lets us prove the path without touching Mongo (handy in CI).
 */

import type { RequestHandler } from "express";
import { LogContract } from "@eff/shared/src/contracts/log";
import Log from "../models/Log";
import { domainToDb } from "../mappers/log.mapper";

// WHY: Accept either a single event or a non-empty array; build from the
//      shared contract to avoid Zod instance mismatches across packages.
const zIngestBody = LogContract.or(LogContract.array().min(1));

export const ping: RequestHandler = (_req, res) => {
  // WHY: Keep ping cheap (no DB); helps local smoke and infra checks.
  res.status(200).json({ ok: true, service: "log" });
};

export const create: RequestHandler = async (req, res, next) => {
  try {
    // WHY: Entry trace proves we reached the handler (helps isolate middleware stalls).
    req.log?.info({ msg: "log:create:enter" });

    // WHY: CI/local escape hatch: bypass DB to prove plumbing + validation.
    if (process.env.LOG_BYPASS_DB === "1") {
      req.log?.info({ msg: "log:create:bypass-db" });
      const count = Array.isArray(req.body) ? req.body.length : 1;
      return res.status(202).json({ accepted: count });
    }

    const parsed = zIngestBody.safeParse(req.body);
    if (!parsed.success) {
      req.log?.warn({
        msg: "log:create:validation:fail",
        err: parsed.error.message,
      });
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: parsed.error.message },
      });
    }

    req.log?.info({ msg: "log:create:validated" });

    // WHY: Optional linkage if upstream decorates req.user; safe to be undefined.
    const userId =
      (req as any).user?._id || (req as any).user?.userId || undefined;

    // WHY: Normalize to array for a single insert path; no branchy code.
    const items = (
      Array.isArray(parsed.data) ? parsed.data : [parsed.data]
    ).map((e) => ({ ...e, userId }));

    req.log?.info({
      msg: "log:create:insertMany:start",
      count: items.length,
    });

    const docs = await Log.insertMany(
      items.map((e) => domainToDb(e as any)),
      {
        ordered: true,
      }
    );

    req.log?.info({
      msg: "log:create:insertMany:done",
      inserted: docs.length,
    });

    // WHY: Ingest is fire-and-forget; return acceptance count (202).
    return res.status(202).json({ accepted: docs.length });
  } catch (err) {
    req.log?.error({ msg: "log:create:error", err });
    return next(err);
  }
};
