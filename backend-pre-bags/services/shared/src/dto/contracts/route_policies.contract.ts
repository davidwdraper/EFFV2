// backend/services/shared/src/contracts/route_policies.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0037 — Unified Route Policies (Edge + S2S)
 *   - ADR-0031 — Route Policy Gate (Foundation)
 *   - ADR-0032 — Route Policy Gate (Design + Pipeline)
 *   - ADR-0029 — Contract-ID + BodyHandler pipeline
 *
 * Purpose:
 * - Canonical schema/contract for unified route policies (Edge + S2S).
 * - Normalized "Doc" schemas ensure ObjectIds are always strings at runtime.
 * - Provides helpers to parse/normalize inputs and compute policy keys.
 * - Exposes an S2S contract (RoutePoliciesMirrorContract) via ContractBase
 *   for the Facilitator's mirror endpoint returning route policies.
 *
 * Invariants:
 * - No environment literals or fallbacks (env-less contract module).
 * - Single concern: schemas + normalization + contract header identity.
 */

import { z } from "zod";
import { ContractBase } from "./base/ContractBase";

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

const methodEnum = z.enum(["GET", "PUT", "POST", "PATCH", "DELETE"]);
const typeEnum = z.enum(["Edge", "S2S"]);

// ─────────────────────────────────────────────────────────────────────────────
// Loose/Input Schemas (accept both string and {$oid} for ObjectIds)
// ─────────────────────────────────────────────────────────────────────────────

const objectIdLoose = z.union([
  z.string().min(1),
  z.object({ $oid: z.string().min(1) }),
]);

/**
 * Base input shared by Edge/S2S. Accepts loose ObjectId shapes.
 */
export const basePolicyInputSchema = z.object({
  _id: objectIdLoose.optional(),
  svcconfigId: objectIdLoose,

  slug: z.string().min(1).describe("Redundant human-readable slug (unindexed)"),

  type: typeEnum,
  method: methodEnum,
  path: z.string().min(1),
  bearerRequired: z.boolean(),
  enabled: z.boolean(),
  updatedAt: z.string().min(1), // ISO string
  notes: z.string().optional(),
  minAccessLevel: z.number().optional(),
});

/** Edge input */
export const edgePolicyInputSchema = basePolicyInputSchema.extend({
  type: z.literal("Edge"),
});

/** S2S input */
export const s2sPolicyInputSchema = basePolicyInputSchema.extend({
  type: z.literal("S2S"),
  allowedCallers: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
});

/** Unified input schema */
export const routePolicyInputSchema = z.union([
  edgePolicyInputSchema,
  s2sPolicyInputSchema,
]);
export const routePolicyInputArraySchema = z.array(routePolicyInputSchema);

// Input types (loose)
export type RoutePolicyInput = z.infer<typeof routePolicyInputSchema>;
export type EdgeRoutePolicyInput = z.infer<typeof edgePolicyInputSchema>;
export type S2SRoutePolicyInput = z.infer<typeof s2sPolicyInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Normalized/Doc Schemas (IDs are always strings)
// ─────────────────────────────────────────────────────────────────────────────

export const basePolicyDocSchema = z.object({
  _id: z.string().min(1).optional(),
  svcconfigId: z.string().min(1),

  slug: z.string().min(1),

  type: typeEnum,
  method: methodEnum,
  path: z.string().min(1),
  bearerRequired: z.boolean(),
  enabled: z.boolean(),
  updatedAt: z.string().min(1), // ISO string
  notes: z.string().optional(),
  minAccessLevel: z.number().optional(),
});

export const edgePolicyDocSchema = basePolicyDocSchema.extend({
  type: z.literal("Edge"),
});

export const s2sPolicyDocSchema = basePolicyDocSchema.extend({
  type: z.literal("S2S"),
  allowedCallers: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
});

/** Unified normalized doc schema */
export const routePolicyDocSchema = z.union([
  edgePolicyDocSchema,
  s2sPolicyDocSchema,
]);
export const routePolicyDocArraySchema = z.array(routePolicyDocSchema);

// Normalized types (Doc)
export type EdgeRoutePolicyDoc = z.infer<typeof edgePolicyDocSchema>;
export type S2SRoutePolicyDoc = z.infer<typeof s2sPolicyDocSchema>;
export type RoutePolicyDoc = EdgeRoutePolicyDoc | S2SRoutePolicyDoc;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (normalization + parsing)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeObjectId(v: string | { $oid: string }): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "$oid" in v && typeof v.$oid === "string") {
    return v.$oid;
  }
  throw new Error("Invalid ObjectId format");
}

/** Internal: map loose input → normalized doc, then validate doc */
function toDoc(input: RoutePolicyInput): RoutePolicyDoc {
  const _id = input._id ? normalizeObjectId(input._id) : undefined;
  const svcconfigId = normalizeObjectId(input.svcconfigId);

  const common = {
    _id,
    svcconfigId,
    slug: input.slug,
    type: input.type,
    method: input.method,
    path: input.path,
    bearerRequired: input.bearerRequired,
    enabled: input.enabled,
    updatedAt: input.updatedAt,
    notes: input.notes,
    minAccessLevel: input.minAccessLevel,
  } as const;

  if (input.type === "Edge") {
    return edgePolicyDocSchema.parse(common);
  } else {
    const withS2S = {
      ...common,
      allowedCallers: input.allowedCallers,
      scopes: input.scopes,
    };
    return s2sPolicyDocSchema.parse(withS2S);
  }
}

/** Parse a single unknown into a normalized RoutePolicyDoc */
export function parseRoutePolicy(input: unknown): RoutePolicyDoc {
  const loose = routePolicyInputSchema.parse(input);
  return toDoc(loose);
}

/** Parse many unknowns into normalized RoutePolicyDoc[] */
export function parseRoutePolicies(input: unknown): RoutePolicyDoc[] {
  const arr = routePolicyInputArraySchema.parse(input);
  return arr.map(toDoc);
}

/** Key helper mirrors DB unique index: { svcconfigId, type, method, path } */
export function policyKey(
  p: Pick<RoutePolicyDoc, "svcconfigId" | "type" | "method" | "path">
): string {
  return `${p.svcconfigId}:${p.type}:${p.method}:${p.path}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// S2S Contract (Facilitator mirror → route policies)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RoutePoliciesMirrorContract
 *
 * - CONTRACT_ID is a compile-time constant per ADR-0029.
 * - Request body is empty (mirror fetch is keyed by path + headers).
 * - Response body is an array of normalized RoutePolicyDoc.
 *
 * Typical usage:
 *   // sender
 *   const id = RoutePoliciesMirrorContract.getContractId();
 *   // set header x-contract-id: id
 *   // ensure response validates: RoutePoliciesMirrorContract.response.parse(json)
 *
 *   // receiver
 *   RoutePoliciesMirrorContract.verify(req.headers["x-contract-id"]);
 *   // produce body validated by RoutePoliciesMirrorContract.response
 */
export class RoutePoliciesMirrorContract extends ContractBase<
  // Request has no body (transport is GET), but we keep type discipline.
  // Using z.undefined() here keeps BodyHandler strict.
  undefined,
  RoutePolicyDoc[]
> {
  public static readonly CONTRACT_ID = "svcconfig/route-policies@v1";

  public readonly request = z.undefined();
  public readonly response = routePolicyDocArraySchema;
}
