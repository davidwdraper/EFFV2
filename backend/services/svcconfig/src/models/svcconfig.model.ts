// backend/services/svcconfig/src/models/svcconfig.model.ts
import mongoose, { Schema } from "mongoose";

const SvcConfigSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
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
    version: { type: Number, required: true, default: 1 },
    updatedAt: { type: Date, required: true, default: () => new Date() },
    updatedBy: { type: String, required: true, default: "system" },
    notes: { type: String },
  },
  { collection: "service_configs" }
);

export type SvcConfigDoc = mongoose.InferSchemaType<typeof SvcConfigSchema>;
export default mongoose.model<SvcConfigDoc>("SvcService", SvcConfigSchema);
