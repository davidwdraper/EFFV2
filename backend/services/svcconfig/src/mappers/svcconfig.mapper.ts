// backend/services/svcconfig/src/mappers/svcconfig.mapper.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADR-0032: Route Policy via svcconfig (service + policy merged payload)
 *
 * Converts raw Mongo documents into the strict SvcConfig domain object
 * defined by the shared Zod contract.
 *
 * NOTE: The domain contract intentionally excludes operational fields like
 * healthPath, exposeHealth, protectedGetPrefixes, publicPrefixes, overrides,
 * updatedBy, and notes. Those may exist in the DB/model but are not exposed here.
 */

import type { SvcConfigDoc } from "../models/svcconfig.model";
import {
  SvcConfigSchema,
  type SvcConfig,
} from "@eff/shared/src/contracts/svcconfig.contract";

export function dbToDomain(doc: SvcConfigDoc | any): SvcConfig {
  const o: any =
    typeof (doc as any).toObject === "function" ? (doc as any).toObject() : doc;

  const shaped: SvcConfig = {
    slug: o.slug,
    version: o.version,
    baseUrl: o.baseUrl,
    outboundApiPrefix: o.outboundApiPrefix,
    enabled: o.enabled,
    allowProxy: o.allowProxy,
    configRevision: o.configRevision,
    policy: o.policy,
    etag: o.etag,
    updatedAt: (o.updatedAt instanceof Date
      ? o.updatedAt
      : new Date(o.updatedAt)
    ).toISOString(),
  };

  return SvcConfigSchema.parse(shaped);
}
