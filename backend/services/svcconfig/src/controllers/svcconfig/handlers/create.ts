// backend/services/svcconfig/src/controllers/svcconfig/handlers/create.ts
import type { Request, Response, NextFunction } from "express";
import { logger } from "@shared/utils/logger";
import * as repo from "../../../repo/svcconfig.repo";
import { publishChanged } from "../../../pubsub";
import { dbToDomain } from "../../../mappers/svcconfig.mapper";
import {
  SvcConfigSchema,
  type ServiceConfig,
} from "@shared/contracts/svcconfig.contract";
import type { SvcConfigDoc } from "../../../models/svcconfig.model";

// Build a create schema from the shared one (server-managed fields omitted)
const CreateSvcConfigSchema = SvcConfigSchema.omit({
  version: true,
  updatedAt: true,
  updatedBy: true,
});

// TS type uses the shared type (no z.infer)
type CreateSvcConfig = Omit<
  ServiceConfig,
  "version" | "updatedAt" | "updatedBy"
>;

function toModelFields(dto: CreateSvcConfig): Partial<SvcConfigDoc> {
  const modelOverrides =
    dto.overrides &&
    ({
      timeoutMs: dto.overrides.timeoutMs,
      breaker: dto.overrides.breaker && {
        failureThreshold: dto.overrides.breaker.failureThreshold,
        halfOpenAfterMs: dto.overrides.breaker.halfOpenAfterMs,
        minRttMs: dto.overrides.breaker.minRttMs,
      },
      // Model field is a Map<string,string>; convert from Record if present
      routeAliases: dto.overrides.routeAliases
        ? new Map(Object.entries(dto.overrides.routeAliases))
        : undefined,
    } as any); // keep cast local to the conversion boundary

  return {
    slug: dto.slug,
    enabled: dto.enabled,
    allowProxy: dto.allowProxy,
    baseUrl: dto.baseUrl,
    outboundApiPrefix: dto.outboundApiPrefix ?? "/api",
    healthPath: dto.healthPath ?? "/health",
    exposeHealth: dto.exposeHealth ?? true,
    protectedGetPrefixes: dto.protectedGetPrefixes ?? [],
    publicPrefixes: dto.publicPrefixes ?? [],
    overrides: modelOverrides,
    notes: dto.notes,
  };
}

export async function create(req: Request, res: Response, next: NextFunction) {
  const requestId = String(req.headers["x-request-id"] || "");
  logger.debug({ requestId }, "[SvcConfigHandlers.create] enter");
  try {
    const dto = CreateSvcConfigSchema.parse(req.body) as CreateSvcConfig;

    const created = await repo.create({
      ...toModelFields(dto),
      updatedBy: (req as any).s2s?.caller || "system",
    });

    (req as any).audit?.push({
      type: "SVCCONFIG_CREATED",
      entity: "SvcConfig",
      entityId: (created as any)._id,
      data: { slug: created.slug },
    });

    await publishChanged({ slug: created.slug, version: created.version! });

    logger.debug(
      { requestId, slug: created.slug },
      "[SvcConfigHandlers.create] exit"
    );
    res.status(201).json(dbToDomain(created as any));
  } catch (err) {
    logger.debug({ requestId, err }, "[SvcConfigHandlers.create] error");
    next(err);
  }
}
