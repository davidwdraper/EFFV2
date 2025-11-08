// backend/services/shared/src/contracts/routePolicy.contract.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0031 — Route Policy Gate at Gateway & Facilitator Endpoints
 * - ADR-0029 — Contract-ID + BodyHandler pipeline
 *
 * Purpose:
 * - Contract-first Zod schemas + ContractBase classes for RoutePolicy ops.
 * - Lookup key = (svcconfigId, version, method, path); exact-match only (v1).
 * - Access is governed by `minAccessLevel`:
 *     0 = anon (public), >=1 = JWT required with `acl >= minAccessLevel`.
 *
 * Notes:
 * - Requests are flat bodies. Responses are enveloped by RouterBase (outside this file).
 * - GETs in HTTP may carry query params; the BodyHandler normalizes into the request body
 *   that matches the `request` schema here (no envelope).
 */

import { z } from "zod";
import { ContractBase } from "./base/ContractBase";

/* ---------------------------------- */
/*              Enums/Types           */
/* ---------------------------------- */

export const HttpMethod = z.enum(["PUT", "POST", "PATCH", "GET", "DELETE"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

export const AccessLevel = {
  Anon: 0,
  Basic: 1,
  Lite: 2,
  Prem: 3,
  Lifer: 4,
  Admin5: 5, // 5+ for higher admin tiers
} as const;

const objectId = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "must be a 24-char hex ObjectId");

export const ApiVersion = z.number().int().gte(1);

/** Service-local normalized path (leading '/', no trailing slash unless root, no query/hash). */
export const ServicePath = z.string().min(1).transform(normalizePath);

/** Canonical RoutePolicy DTO kept in Mongo and returned to callers. */
export const RoutePolicyDto = z.object({
  _id: objectId,
  svcconfigId: objectId,
  version: ApiVersion,
  method: HttpMethod, // normalized to UPPERCASE
  path: ServicePath, // normalized form
  minAccessLevel: z.number().int().gte(0),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type RoutePolicyDto = z.infer<typeof RoutePolicyDto>;

/* Create / Update DTOs */
export const RoutePolicyCreate = z.object({
  svcconfigId: objectId,
  version: ApiVersion,
  method: HttpMethod.transform(normalizeMethod),
  path: ServicePath,
  minAccessLevel: z.number().int().gte(0),
});
export type RoutePolicyCreate = z.infer<typeof RoutePolicyCreate>;

export const RoutePolicyUpdate = z.object({
  minAccessLevel: z.number().int().gte(0),
});
export type RoutePolicyUpdate = z.infer<typeof RoutePolicyUpdate>;

/* Lookup DTO (exact match) */
export const RoutePolicyGetRequest = z.object({
  svcconfigId: objectId,
  version: ApiVersion,
  method: HttpMethod.transform(normalizeMethod),
  path: ServicePath,
});
export type RoutePolicyGetRequest = z.infer<typeof RoutePolicyGetRequest>;

/* ---------------------------------- */
/*          Contract Classes          */
/* ---------------------------------- */

/**
 * GET (exact) — fetch a single policy by unique key.
 * HTTP shape: GET /routePolicy?svcconfigId=...&version=...&method=...&path=...
 * BodyHandler must materialize that into this request body (flat).
 */
export class RoutePolicyGetContract extends ContractBase<
  RoutePolicyGetRequest,
  { policy: RoutePolicyDto | null }
> {
  public static readonly CONTRACT_ID = "facilitator/routePolicy.get@v1";
  public readonly request = RoutePolicyGetRequest;
  public readonly response = z.object({
    policy: RoutePolicyDto.nullable(),
  });
}

/**
 * POST — create a new policy row (unique on svcconfigId+version+method+path).
 */
export class RoutePolicyCreateContract extends ContractBase<
  RoutePolicyCreate,
  { policy: RoutePolicyDto }
> {
  public static readonly CONTRACT_ID = "facilitator/routePolicy.create@v1";
  public readonly request = RoutePolicyCreate;
  public readonly response = z.object({
    policy: RoutePolicyDto,
  });
}

/**
 * PUT by id — update minAccessLevel only (v1).
 * HTTP path: PUT /routePolicy/:id
 * Body: { id, minAccessLevel }
 */
export const RoutePolicyUpdateRequest = z.object({
  id: objectId,
  minAccessLevel: z.number().int().gte(0),
});
export type RoutePolicyUpdateRequest = z.infer<typeof RoutePolicyUpdateRequest>;

export class RoutePolicyUpdateContract extends ContractBase<
  RoutePolicyUpdateRequest,
  { policy: RoutePolicyDto }
> {
  public static readonly CONTRACT_ID = "facilitator/routePolicy.update@v1";
  public readonly request = RoutePolicyUpdateRequest;
  public readonly response = z.object({
    policy: RoutePolicyDto,
  });
}

/* ---------------------------------- */
/*          Helper Utilities          */
/* ---------------------------------- */

/** Normalize HTTP method to UPPERCASE (defensive only). */
export function normalizeMethod(m: string): HttpMethod {
  return (m || "").toUpperCase() as HttpMethod;
}

/**
 * Normalize service-local path:
 * - ensure leading '/'
 * - collapse duplicate slashes
 * - strip querystring/hash
 * - strip trailing slash (except root '/')
 */
export function normalizePath(input: string): string {
  let p = (input || "").trim();

  // strip query/hash
  const qi = p.indexOf("?");
  if (qi >= 0) p = p.slice(0, qi);
  const hi = p.indexOf("#");
  if (hi >= 0) p = p.slice(0, hi);

  // ensure leading slash
  if (!p.startsWith("/")) p = `/${p}`;

  // collapse multiple slashes
  p = p.replace(/\/{2,}/g, "/");

  // strip trailing slash unless root
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);

  return p;
}

/** Cache key used by the gateway routePolicyGate (exact match only). */
export function makeRoutePolicyCacheKey(args: {
  svcconfigId: string;
  version: number;
  method: string;
  path: string;
}): string {
  const method = normalizeMethod(args.method);
  const path = normalizePath(args.path);
  return `${args.svcconfigId}|v${args.version}|${method}|${path}`;
}

/** Derived label for ops/telemetry; logic uses minAccessLevel directly. */
export function derivePolicyLabel(
  minAccessLevel: number
): "public" | "private" {
  return minAccessLevel === AccessLevel.Anon ? "public" : "private";
}

/** JWT is required iff minAccessLevel >= 1. */
export function requiresJwt(minAccessLevel: number): boolean {
  return minAccessLevel >= AccessLevel.Basic;
}

/* ---------------------------------- */
/*      Uniqueness (persistence)      */
/* ---------------------------------- */
/**
 * Enforce unique index at the DB layer:
 *   (svcconfigId, version, method, path)
 *
 * Mongo index example:
 * db.routePolicies.createIndex(
 *   { svcconfigId: 1, version: 1, method: 1, path: 1 },
 *   { unique: true, name: "uniq_svc_ver_method_path" }
 * )
 */
export const RoutePolicyUniqueKey = [
  "svcconfigId",
  "version",
  "method",
  "path",
] as const;

/* ---------------------------------- */
/*   Narrow handoff to JWT middleware  */
/* ---------------------------------- */

/** Minimal subset for passing through res.locals/req.security to TokenValidation. */
export type RoutePolicyDecision = Pick<
  RoutePolicyDto,
  "minAccessLevel" | "svcconfigId" | "version" | "method" | "path"
>;
