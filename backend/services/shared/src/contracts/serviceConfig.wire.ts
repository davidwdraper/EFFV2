// backend/services/shared/src/contracts/serviceConfig.wire.ts
/**
 * Docs:
 * - SOP: Core SOP (Reduced, Clean)
 * - ADR-0007: SvcConfig Contract — fixed shapes & keys (wire)
 * - ADR-0020: Mirror & Push — single envelope, stable record
 *
 * Purpose:
 * - Canonical **wire** schema for ServiceConfig JSON and the Mirror payload.
 * - Zod only at edges. Domain imports these *types* but not the validators.
 *
 * Invariants:
 * - `enabled` is **literally true** in the mirror (disabled entries aren’t mirrored).
 * - `exposeHealth` and `outboundApiPrefix` are required (boolean / string).
 * - Mirror is a flat Record keyed by "<slug>@<version>".
 */

import { z } from "zod";

/* --------------------------------- helpers -------------------------------- */

export const svcKey = (slug: string, version: number): string =>
  `${String(slug).toLowerCase()}@${Math.trunc(Number(version))}`;

/* ------------------------------- policy docs ------------------------------ */

export const SvcMethodSchema = z.enum([
  "GET",
  "PUT",
  "POST",
  "PATCH",
  "DELETE",
]);

const MongoIdLooseSchema = z.union([
  z.string().min(1),
  z.object({ $oid: z.string().min(1) }),
]);

export const EdgePolicyJSONSchema = z.object({
  type: z.literal("Edge"),
  svcconfigId: MongoIdLooseSchema,
  _id: MongoIdLooseSchema.optional(),
  slug: z.string().min(1),
  method: SvcMethodSchema,
  path: z.string().min(1),
  bearerRequired: z.boolean(),
  enabled: z.boolean(),
  updatedAt: z.string().min(1), // ISO-ish string
  notes: z.string().min(1).optional(),
  minAccessLevel: z.number().int().optional(),
});

export const S2SPolicyJSONSchema = z.object({
  type: z.literal("S2S"),
  svcconfigId: MongoIdLooseSchema,
  _id: MongoIdLooseSchema.optional(),
  slug: z.string().min(1),
  method: SvcMethodSchema,
  path: z.string().min(1),
  enabled: z.boolean(),
  updatedAt: z.string().min(1),
  notes: z.string().min(1).optional(),
});

export const EdgePolicyJSONArraySchema = z.array(EdgePolicyJSONSchema);
export const S2SPolicyJSONArraySchema = z.array(S2SPolicyJSONSchema);

/* --------------------------- service config (wire) ------------------------- */

export const ServiceConfigJSONSchema = z.object({
  _id: z.string().min(1),
  slug: z.string().min(1),
  version: z.number().int().min(1),
  enabled: z.literal(true), // literal true on the wire
  internalOnly: z.boolean(),
  baseUrl: z.string().min(1),
  outboundApiPrefix: z.string().min(1), // REQUIRED by wire
  exposeHealth: z.boolean(), // REQUIRED by wire
  changedByUserId: z.string().min(1).optional(),
  updatedAt: z.string().min(1),
  policies: z.object({
    edge: EdgePolicyJSONArraySchema,
    s2s: S2SPolicyJSONArraySchema,
  }),
});

export type ServiceConfigJSON = z.infer<typeof ServiceConfigJSONSchema>;

/* ---------------------------------- mirror -------------------------------- */

export const MirrorJSONSchema = z.record(z.string(), ServiceConfigJSONSchema);
export type MirrorJSON = Record<string, ServiceConfigJSON>;
