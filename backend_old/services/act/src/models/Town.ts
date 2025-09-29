// backend/services/act/src/models/Town.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - docs/adr/0027-entity-services-on-shared-createserviceapp-internal-only-s2s-no-edge-guardrails.md
 *
 * Why:
 * - Keep the model boring (storage + indexes). Let the shared Zod contract
 *   validate shape and rules via a mapper at the boundary.
 * - _id remains a STRING to align with homeTownId:string across services.
 */

import { Schema, model, models, type Document } from "mongoose";
import type { Town } from "@eff/shared/src/contracts/town.contract";

export interface TownDocument extends Document, Omit<Town, "_id"> {
  _id: string; // string id (e.g., "austin-tx" or FIPS)
}

const TownSchema = new Schema<TownDocument>(
  {
    _id: { type: String, required: true }, // string, not ObjectId
    name: { type: String, required: true, index: true },
    state: { type: String, required: true, index: true },

    // Keep lat/lng for convenient numeric queries
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },

    county: { type: String },
    population: { type: Number },
    fips: { type: String },

    // GeoJSON point (required). [lng, lat]
    loc: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
  },
  {
    strict: true,
    versionKey: false,
    bufferCommands: false,
    collection: "towns",
  }
);

// Indexes for fast lookups and spatial queries
TownSchema.index({ name: 1, state: 1 }, { name: "idx_name_state" }); // non-unique across states
TownSchema.index({ loc: "2dsphere" });

const TownModel = models.Town || model<TownDocument>("Town", TownSchema);
export default TownModel;
