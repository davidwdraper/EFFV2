// backend/services/svcconfig/src/mappers/svcconfig.mapper.ts
import type { SvcConfigDoc } from "../models/svcconfig.model";
import {
  SvcConfigSchema,
  type ServiceConfig,
} from "@shared/contracts/svcconfig.contract";

export function dbToDomain(doc: SvcConfigDoc | any): ServiceConfig {
  const o: any =
    typeof (doc as any).toObject === "function" ? (doc as any).toObject() : doc;

  const routeAliases = o?.overrides?.routeAliases
    ? Object.fromEntries(
        typeof o.overrides.routeAliases.entries === "function"
          ? o.overrides.routeAliases.entries()
          : Object.entries(o.overrides.routeAliases)
      )
    : undefined;

  const shaped: ServiceConfig = {
    slug: o.slug,
    enabled: !!o.enabled,
    allowProxy: !!o.allowProxy,
    baseUrl: o.baseUrl,
    outboundApiPrefix: o.outboundApiPrefix ?? "/api",
    healthPath: o.healthPath ?? "/health",
    exposeHealth: !!o.exposeHealth,
    protectedGetPrefixes: Array.isArray(o.protectedGetPrefixes)
      ? o.protectedGetPrefixes
      : [],
    publicPrefixes: Array.isArray(o.publicPrefixes) ? o.publicPrefixes : [],
    overrides: o.overrides
      ? {
          timeoutMs: o.overrides.timeoutMs,
          breaker: o.overrides.breaker
            ? {
                failureThreshold: o.overrides.breaker.failureThreshold,
                halfOpenAfterMs: o.overrides.breaker.halfOpenAfterMs,
                minRttMs: o.overrides.breaker.minRttMs,
              }
            : undefined,
          routeAliases,
        }
      : undefined,
    version: o.version ?? 1,
    updatedAt: (o.updatedAt instanceof Date
      ? o.updatedAt
      : new Date(o.updatedAt)
    ).toISOString(),
    updatedBy: o.updatedBy ?? "system",
    notes: o.notes,
  };

  // Validate against the shared schema (defensive)
  return SvcConfigSchema.parse(shaped);
}
