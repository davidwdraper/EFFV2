// backend/services/svcconfig/src/controllers/svcconfig/handlers/read.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR-0032: Route Policy via svcconfig (service + policy merged payload)
 *
 * Returns:
 *   backend/services/shared/src/contracts/svcconfig.contract.ts (SvcConfigSchema)
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "@eff/shared/src/utils/logger";
import { SvcConfigSchema } from "@eff/shared/src/contracts/svcconfig.contract";
import * as svcRepo from "../../../repo/svcconfig.repo";
import * as polRepo from "../../../repo/routePolicy.repo";

export async function read(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  const { slug } = req.params;
  const versionParam = req.query.version;
  const version = versionParam !== undefined ? Number(versionParam) : undefined;

  logger.debug({ requestId, slug, version }, "[SvcConfig.handlers.read] enter");
  try {
    const svc =
      version !== undefined
        ? await svcRepo.getBySlugVersion(slug, version)
        : await svcRepo.getLatestBySlug(slug);

    if (!svc) {
      return res.status(404).json({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: `Unknown svcconfig slug${
          version !== undefined ? `@v${version}` : ""
        }`,
      });
    }

    const pol = await polRepo.getPolicyBySlugVersion(svc.slug, svc.version);

    const rawPayload = {
      slug: svc.slug,
      version: svc.version,
      baseUrl: svc.baseUrl,
      outboundApiPrefix: svc.outboundApiPrefix ?? "/api",
      enabled: svc.enabled,
      allowProxy: svc.allowProxy,
      configRevision: svc.version,
      policy: pol
        ? {
            revision: pol.revision || 1,
            defaults: { public: false, userAssertion: "required" as const },
            rules: pol.rules.map((r) => ({
              method: r.method,
              path: r.path,
              public: !!r.public,
              userAssertion: r.userAssertion,
              opId: r.opId,
            })),
          }
        : {
            revision: 0,
            defaults: { public: false, userAssertion: "required" as const },
            rules: [],
          },
      etag: `"svc:${svc.slug}:v${svc.version}:r${pol?.revision ?? 0}"`,
      updatedAt:
        // @ts-ignore lean docs can be plain JS objects
        svc.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    };

    const payload = SvcConfigSchema.parse(rawPayload);

    logger.debug(
      {
        requestId,
        slug: payload.slug,
        version: payload.version,
        policyRev: payload.policy.revision,
      },
      "[SvcConfig.handlers.read] ok"
    );

    return res.json(payload);
  } catch (err) {
    logger.warn({ requestId, err }, "[SvcConfig.handlers.read] error");
    next(err);
  }
}
