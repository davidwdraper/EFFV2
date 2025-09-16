// backend/services/act/src/models/Act.ts
/**
 * Docs:
 * - Arch: docs/architecture/backend/OVERVIEW.md
 * - ADRs:
 *   - docs/adr/0017-environment-loading-and-validation.md
 *   - docs/adr/0015-edge-guardrails-stay-in-gateway-remove-from-shared.md
 *   - (NEW) docs/adr/XXXX-entity-services-on-shared-createServiceApp.md
 *
 * Why:
 * - Keep the Mongoose model boring: storage + indexes.
 * - Enforce shape/rules via the shared Zod contract in a mapper at the boundary.
 * - This avoids duplicating regex/array rules in two places.
 */

import { Schema, Document, model, models } from "mongoose";
import { normalizeActName } from "@eff/shared/src/utils/normalizeActName";
import type { Act } from "@eff/shared/src/contracts/act.contract";

export interface ActDocument extends Document, Omit<Act, "_id"> {
  _id: any;
}

const ActSchema = new Schema<ActDocument>(
  {
    // Meta / timestamps are driven by Mongoose timestamps mapping below
    dateCreated: { type: Date },
    dateLastUpdated: { type: Date },

    actStatus: { type: Number, required: true, default: 0 },

    // Arrays: keep minimal validators; Zod does strict checks in the mapper
    actType: { type: [Number], required: true },

    userCreateId: { type: String, required: true },
    userOwnerId: { type: String, required: true },

    name: { type: String, required: true, index: true },
    nameNormalized: { type: String, required: true, index: true },
    aliases: { type: [String], default: [] },

    // Email format is validated by the Zod contract; DB just stores it
    email: { type: String, index: true },

    // Hometown (always required by contract)
    homeTown: { type: String, required: true },
    state: { type: String, required: true },
    homeTownId: { type: String, required: true },

    // Optional mailing address (format validated by Zod)
    addressStreet1: { type: String },
    addressStreet2: { type: String },
    addressCity: { type: String },
    addressState: { type: String },
    addressZip: { type: String },

    // Spatial point (required by contract)
    actLoc: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
      },
    },

    imageIds: { type: [String], default: [] },

    websiteUrl: { type: String },
    distanceWillingToTravel: {
      type: Number,
      required: true,
      min: 0,
      default: () => Number(process.env.ACT_DISTANCE_DEFAULT_MI || 50),
    },

    genreList: { type: [String], required: true },

    actDuration: { type: Number, required: true, min: 0 },
    breakLength: { type: Number, required: true, min: 0 },
    numberOfBreaks: { type: Number, required: true, min: 0 },

    bookingNotes: { type: String },
    earliestStartTime: { type: String },
    latestStartTime: { type: String },

    // Exactly 7 booleans — enforced by Zod; DB stores as array
    blackoutDays: { type: [Boolean] },

    validatedBy: { type: [String], default: [] },
    invalidatedBy: { type: [String], default: [] },
  },
  {
    strict: true,
    versionKey: false,
    bufferCommands: false,
    timestamps: { createdAt: "dateCreated", updatedAt: "dateLastUpdated" },
    collection: "acts",
  }
);

// ---- Indexes ----
ActSchema.index(
  { nameNormalized: 1, homeTownId: 1 },
  {
    unique: true,
    name: "uniq_nameNormalized_homeTownId",
    collation: { locale: "en", strength: 1 },
  }
);
ActSchema.index({ actLoc: "2dsphere" });
ActSchema.index({ state: 1, homeTownId: 1 });
ActSchema.index({ dateLastUpdated: -1, _id: -1 });

// ---- Normalization (minimal) ----
// Keep only the bits not covered by Zod (we still compute nameNormalized)
ActSchema.pre("validate", function (next) {
  try {
    const normalized = normalizeActName(this.name);
    this.nameNormalized = normalized || this.name?.toLowerCase()?.trim() || "";
    // quick guard for coordinates presence (shape strictly validated in Zod)
    if (
      !this.actLoc ||
      !Array.isArray(this.actLoc.coordinates) ||
      this.actLoc.coordinates.length !== 2
    ) {
      return next(new Error("actLoc.coordinates must be [lng, lat]"));
    }
    next();
  } catch (err) {
    next(err as Error);
  }
});

const ActModel = models.Act || model<ActDocument>("Act", ActSchema);
export default ActModel;
