/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs: 0029, 0032
 *
 * A service config record is uniquely identified by (slug, version).
 */

import mongoose, { Schema } from "mongoose";

const SvcConfigSchema = new Schema(
  {
    slug: { type: String, required: true, index: true },
    version: { type: Number, required: true, default: 1 },

    enabled: { type: Boolean, default: true },
    allowProxy: { type: Boolean, default: true },

    baseUrl: { type: String, required: true },
    outboundApiPrefix: { type: String, default: "/api" },
    healthPath: { type: String, default: "/health" },
    exposeHealth: { type: Boolean, default: true },

    protectedGetPrefixes: { type: [String], default: [] },
    publicPrefixes: { type: [String], default: [] },

    overrides: {
      timeoutMs: { type: Number },
      breaker: {
        failureThreshold: { type: Number },
        halfOpenAfterMs: { type: Number },
        minRttMs: { type: Number },
      },
      routeAliases: { type: Map, of: String },
    },

    updatedAt: { type: Date, required: true, default: () => new Date() },
    updatedBy: { type: String, required: true, default: "system" },
    notes: { type: String },
  },
  { collection: "service_configs" }
);

SvcConfigSchema.index(
  { slug: 1, version: 1 },
  { unique: true, name: "uniq_slug_version" }
);

export type SvcConfigDoc = mongoose.InferSchemaType<typeof SvcConfigSchema>;

export const SvcConfig = mongoose.models.SvcConfig
  ? (mongoose.models.SvcConfig as mongoose.Model<SvcConfigDoc>)
  : mongoose.model<SvcConfigDoc>(
      "SvcConfig",
      SvcConfigSchema,
      "service_configs"
    );
