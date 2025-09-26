// backend/services/svcconfig/src/repo/routePolicy.repo.ts
/**
 * Docs:
 * - ADR-0032 — Route policy keyed by (slug, version)
 * - Contract: backend/services/shared/src/contracts/svcconfig.contract.ts
 */

import RoutePolicy from "../models/routePolicy.model";
import type { RoutePolicyDoc } from "../models/routePolicy.model";

export async function getPolicyBySlugVersion(slug: string, version: number) {
  return RoutePolicy.findOne({ slug, version }).lean<RoutePolicyDoc | null>();
}
