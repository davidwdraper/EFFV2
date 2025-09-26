// backend/services/svcconfig/src/models/routePolicy.model.ts
/**
 * Docs:
 * - ADR-0032 — Route Policy via svcconfig
 * - Contract: backend/services/shared/src/contracts/svcconfig.contract.ts
 */

import mongoose, { Schema, type Document } from "mongoose";

export type UserAssertionMode = "required" | "optional" | "forbidden";

export interface RouteRule {
  method: string;
  path: string;
  public: boolean;
  userAssertion: UserAssertionMode;
  opId?: string;
}

export interface RoutePolicyDoc extends Document {
  slug: string;
  version: number;
  revision: number;
  rules: RouteRule[];
  updatedAt: Date;
}

const RuleSchema = new Schema<RouteRule>(
  {
    method: { type: String, required: true, uppercase: true, trim: true },
    path: { type: String, required: true, trim: true },
    public: { type: Boolean, required: true, default: false },
    userAssertion: {
      type: String,
      enum: ["required", "optional", "forbidden"],
      required: true,
      default: "required",
    },
    opId: { type: String, trim: true },
  },
  { _id: false }
);

const RoutePolicySchema = new Schema<RoutePolicyDoc>(
  {
    slug: { type: String, required: true, index: true },
    version: { type: Number, required: true, index: true },
    revision: { type: Number, required: true, default: 1 },
    rules: { type: [RuleSchema], required: true, default: [] },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "routePolicies", minimize: true }
);

RoutePolicySchema.index(
  { slug: 1, version: 1 },
  { unique: true, name: "uniq_policy_slug_version" }
);

const RoutePolicy =
  (mongoose.models.RoutePolicy as mongoose.Model<RoutePolicyDoc>) ||
  mongoose.model<RoutePolicyDoc>(
    "RoutePolicy",
    RoutePolicySchema,
    "routePolicies"
  );

export default RoutePolicy;
