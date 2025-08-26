// backend/services/act/src/models/Town.ts
import mongoose, { Schema, Document } from "mongoose";

/**
 * Towns = reference data (manually loaded), GET-only by default.
 * To (re)load or modify towns, set ALLOW_TOWN_WRITES=1 (or ACT_TOWNS_READONLY=0).
 */

export interface TownDocument extends Document {
  name: string; // "Austin"
  state: string; // "TX"
  lat: number;
  lng: number;
  county?: string;
  population?: number;
  fips?: string;
  loc?: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
}

const TownSchema = new Schema<TownDocument>(
  {
    name: { type: String, required: true, index: true },
    state: { type: String, required: true, index: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },

    // Optional enrichments (retained)
    county: { type: String },
    population: { type: Number },
    fips: { type: String },

    // ✅ GeoJSON point for radius searches
    loc: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        // keep undefined so we set it from lat/lng in pre('save')
        default: undefined,
      },
    },
  },
  {
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
      },
    },
  }
);

// ── Read-only mode toggle ─────────────────────────────────────────────────────
const READONLY =
  process.env.ALLOW_TOWN_WRITES !== "1" &&
  (process.env.NODE_ENV === "test" || process.env.ACT_TOWNS_READONLY !== "0");

// Guard helper for mutating ops
const guardWrite = (next: (err?: Error) => void) => {
  if (READONLY) {
    return next(
      new Error(
        "Towns collection is read-only (set ALLOW_TOWN_WRITES=1 or ACT_TOWNS_READONLY=0 for loader scripts)."
      )
    );
  }
  return next();
};

// Ensure loc is always aligned with lat/lng; also respect read-only
TownSchema.pre("save", function (next) {
  if (READONLY) return guardWrite(next);
  const doc = this as TownDocument;
  if (!doc.loc || !Array.isArray(doc.loc.coordinates)) {
    doc.loc = { type: "Point", coordinates: [doc.lng, doc.lat] };
  } else {
    doc.loc.coordinates[0] = doc.lng;
    doc.loc.coordinates[1] = doc.lat;
  }
  next();
});

// Block other mutating ops in read-only mode
// replace your insertMany hook with this typed version
TownSchema.pre(
  "insertMany",
  function (
    this: mongoose.Model<TownDocument>,
    next: (err?: mongoose.CallbackError) => void,
    _docs: any[],
    _options?: any
  ) {
    guardWrite(next);
  }
);
TownSchema.pre("updateOne", function (next) {
  guardWrite(next);
});
TownSchema.pre("updateMany", function (next) {
  guardWrite(next);
});
TownSchema.pre("findOneAndUpdate", function (next) {
  guardWrite(next);
});
TownSchema.pre("deleteOne", function (next) {
  guardWrite(next);
});
TownSchema.pre("deleteMany", function (next) {
  guardWrite(next);
});
TownSchema.pre("findOneAndDelete", function (next) {
  guardWrite(next);
});

// Uniqueness & geo (preserved)
TownSchema.index({ name: 1, state: 1 }, { unique: true }); // enforce ref-data uniqueness
TownSchema.index({ population: -1 });
TownSchema.index({ loc: "2dsphere" });

export default (mongoose.models.Town as mongoose.Model<TownDocument>) ||
  mongoose.model<TownDocument>("Town", TownSchema);
