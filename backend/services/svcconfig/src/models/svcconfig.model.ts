// backend/services/svcconfig/src/models/svcconfig.model.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP:  docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0029-versioned-s2s-and-x-nv-api-version.md
 *
 * Why (APR-0029):
 * - Allow multiple records per slug distinguished by API version.
 * - Make (slug, version) the uniqueness boundary. No URL/env overrides in code;
 *   source of truth is svcconfig.
 */

import mongoose, { Schema } from "mongoose";

const SvcConfigSchema = new Schema(
  {
    // Identity
    slug: { type: String, required: true, index: true }, // no longer unique by itself
    version: { type: Number, required: true, default: 1 },

    // Routing / exposure
    enabled: { type: Boolean, default: true },
    allowProxy: { type: Boolean, default: true },

    // Transport targets (authoritative — NOT overridden by .env)
    baseUrl: { type: String, required: true },
    outboundApiPrefix: { type: String, default: "/api" },
    healthPath: { type: String, default: "/health" },
    exposeHealth: { type: Boolean, default: true },

    // Policy
    protectedGetPrefixes: { type: [String], default: [] },
    publicPrefixes: { type: [String], default: [] },

    // Optional tuning
    overrides: {
      timeoutMs: { type: Number },
      breaker: {
        failureThreshold: { type: Number },
        halfOpenAfterMs: { type: Number },
        minRttMs: { type: Number },
      },
      routeAliases: { type: Map, of: String },
    },

    // Audit/meta
    updatedAt: { type: Date, required: true, default: () => new Date() },
    updatedBy: { type: String, required: true, default: "system" },
    notes: { type: String },
  },
  { collection: "service_configs" }
);

// Compound uniqueness: slug + version
SvcConfigSchema.index(
  { slug: 1, version: 1 },
  { unique: true, name: "uniq_slug_version" }
);

export type SvcConfigDoc = mongoose.InferSchemaType<typeof SvcConfigSchema>;
export default mongoose.model<SvcConfigDoc>("SvcConfig", SvcConfigSchema);
