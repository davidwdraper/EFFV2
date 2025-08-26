// backend/services/act/src/models/Town.ts
import mongoose, { Schema, Document } from "mongoose";

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

    // Optional enrichments retained across refactors
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

// Ensure loc is always aligned with lat/lng
TownSchema.pre("save", function (next) {
  const doc = this as TownDocument;
  if (!doc.loc || !Array.isArray(doc.loc.coordinates)) {
    doc.loc = { type: "Point", coordinates: [doc.lng, doc.lat] };
  } else {
    doc.loc.coordinates[0] = doc.lng;
    doc.loc.coordinates[1] = doc.lat;
  }
  next();
});

// Uniqueness & geo
TownSchema.index({ name: 1, state: 1 }, { unique: true }); // enforce ref-data uniqueness
TownSchema.index({ population: -1 });
TownSchema.index({ loc: "2dsphere" });

export default (mongoose.models.Town as mongoose.Model<TownDocument>) ||
  mongoose.model<TownDocument>("Town", TownSchema);
