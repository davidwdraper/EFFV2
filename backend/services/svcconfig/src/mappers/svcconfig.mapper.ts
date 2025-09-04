// backend/services/svcconfig/src/mappers/srcservice.mapper.ts
import type { SvcConfigDoc } from "../models/svcconfig.model";

export type SvcConfigDomain = {
  slug: string;
  enabled: boolean;
  allowProxy: boolean;
  baseUrl: string;
  outboundApiPrefix: string;
  healthPath: string;
  exposeHealth: boolean;
  protectedGetPrefixes: string[];
  publicPrefixes: string[];
  overrides?: {
    timeoutMs?: number;
    breaker?: {
      failureThreshold?: number;
      halfOpenAfterMs?: number;
      minRttMs?: number;
    };
    routeAliases?: Record<string, string>;
  };
  version: number;
  updatedAt: string;
  updatedBy: string;
  notes?: string;
};

export function dbToDomain(doc: SvcConfigDoc | any): SvcConfigDomain {
  const o: any =
    typeof (doc as any).toObject === "function" ? (doc as any).toObject() : doc;
  const routeAliases = o?.overrides?.routeAliases
    ? Object.fromEntries(
        typeof o.overrides.routeAliases.entries === "function"
          ? o.overrides.routeAliases.entries()
          : Object.entries(o.overrides.routeAliases)
      )
    : undefined;

  return {
    slug: o.slug,
    enabled: !!o.enabled,
    allowProxy: !!o.allowProxy,
    baseUrl: o.baseUrl,
    outboundApiPrefix: o.outboundApiPrefix ?? "/api",
    healthPath: o.healthPath ?? "/health",
    exposeHealth: !!o.exposeHealth,
    protectedGetPrefixes: o.protectedGetPrefixes ?? [],
    publicPrefixes: o.publicPrefixes ?? [],
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
}
