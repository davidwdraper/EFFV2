// backend/services/svcconfig/src/controllers/svcconfig/handlers/patch.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import * as repo from "../../../repo/svcconfig.repo";
import { publishChanged } from "../../../pubsub";
import { dbToDomain } from "../../../mappers/svcconfig.mapper";
import {
  SvcConfigSchema,
  type ServiceConfig,
} from "@shared/src/contracts/svcconfig.contract";
import type { SvcConfigDoc } from "../../../models/svcconfig.model";

// PATCH = partial; forbid slug-in-body (slug comes from :slug param)
const PatchSvcConfigSchema = SvcConfigSchema.partial().omit({ slug: true });
type PatchSvcConfig = Partial<Omit<ServiceConfig, "slug">>;

function toModelPatch(patch: PatchSvcConfig): Partial<SvcConfigDoc> {
  const out: Partial<SvcConfigDoc> = {};

  if ("enabled" in patch) out.enabled = !!patch.enabled;
  if ("allowProxy" in patch) out.allowProxy = !!patch.allowProxy;
  if ("baseUrl" in patch && patch.baseUrl != null) out.baseUrl = patch.baseUrl;
  if ("outboundApiPrefix" in patch)
    out.outboundApiPrefix = patch.outboundApiPrefix!;
  if ("healthPath" in patch) out.healthPath = patch.healthPath!;
  if ("exposeHealth" in patch) out.exposeHealth = !!patch.exposeHealth;
  if ("protectedGetPrefixes" in patch)
    out.protectedGetPrefixes = patch.protectedGetPrefixes ?? [];
  if ("publicPrefixes" in patch)
    out.publicPrefixes = patch.publicPrefixes ?? [];
  if ("notes" in patch) out.notes = patch.notes;

  if ("overrides" in patch) {
    const o = patch.overrides;
    out.overrides =
      o &&
      ({
        timeoutMs: o.timeoutMs,
        breaker: o.breaker && {
          failureThreshold: o.breaker.failureThreshold,
          halfOpenAfterMs: o.breaker.halfOpenAfterMs,
          minRttMs: o.breaker.minRttMs,
        },
        routeAliases: o.routeAliases
          ? new Map(Object.entries(o.routeAliases))
          : undefined,
      } as any);
  }

  return out;
}

export async function patch(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  const { slug } = req.params;
  logger.debug({ requestId, slug }, "[SvcConfigHandlers.patch] enter");
  try {
    const dto = PatchSvcConfigSchema.parse(req.body) as PatchSvcConfig;

    const updated = await repo.patchBySlug(slug, {
      ...toModelPatch(dto),
      updatedBy: (req as any).s2s?.caller || "system",
    });
    if (!updated)
      return res
        .status(404)
        .json({ title: "Not Found", status: 404, detail: "Unknown slug" });

    (req as any).audit?.push({
      type: "SVCCONFIG_UPDATED",
      entity: "SvcConfig",
      entityId: (updated as any)._id,
      data: { slug: updated.slug, version: updated.version },
    });

    await publishChanged({ slug: updated.slug, version: updated.version! });

    logger.debug(
      { requestId, slug: updated.slug },
      "[SvcConfigHandlers.patch] exit"
    );
    res.json(dbToDomain(updated as any));
  } catch (err) {
    logger.debug({ requestId, err }, "[SvcConfigHandlers.patch] error");
    next(err);
  }
}
