// backend/services/svcconfig/src/controllers/svcconfig/handlers/list.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR-0032: Route Policy via svcconfig
 *
 * Lists stored service configs. All documents are validated
 * against SvcConfigSchema via dbToDomain before returning.
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import { SvcConfig } from "../../../models/svcconfig.model";

// NOTE: list returns DB rows (admin snapshot), not the merged read contract.
// Canonical read shape remains in read.ts only.

export async function list(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[SvcConfigHandlers.list] enter");
  try {
    const rawLimit = req.query.limit as string | undefined;
    const rawSkip = req.query.skip as string | undefined;

    const skip = Math.max(parseInt(rawSkip ?? "0", 10) || 0, 0);
    const limit = rawLimit
      ? Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 200)
      : 0; // 0 = no limit

    const query = SvcConfig.find({});
    if (skip > 0) query.skip(skip);
    if (limit > 0) query.limit(limit);

    // Lean out & project only DB fields we actually have in this collection.
    const docs = await query.lean().exec();

    const items = docs.map((o: any) => ({
      slug: o.slug,
      version: o.version ?? 1,
      enabled: !!o.enabled,
      allowProxy: !!o.allowProxy,
      baseUrl: o.baseUrl,
      outboundApiPrefix: o.outboundApiPrefix ?? "/api",
      // operational/metadata present in the model:
      healthPath: o.healthPath ?? "/health",
      exposeHealth: !!o.exposeHealth,
      protectedGetPrefixes: Array.isArray(o.protectedGetPrefixes)
        ? o.protectedGetPrefixes
        : [],
      publicPrefixes: Array.isArray(o.publicPrefixes) ? o.publicPrefixes : [],
      overrides: o.overrides ?? undefined,
      updatedAt: (o.updatedAt instanceof Date
        ? o.updatedAt
        : new Date(o.updatedAt)
      ).toISOString(),
      updatedBy: o.updatedBy ?? "system",
      notes: o.notes ?? undefined,
      // DO NOT include configRevision/policy/etag here — those belong to read.ts
    }));

    logger.debug(
      { requestId, count: items.length, limit: limit || null, skip },
      "[SvcConfigHandlers.list] exit"
    );
    res.json({ items, count: items.length, limit: limit || null, skip });
  } catch (err) {
    logger.debug({ requestId, err }, "[SvcConfigHandlers.list] error");
    next(err);
  }
}
