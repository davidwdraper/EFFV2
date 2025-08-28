// backend/services/act/src/models/Town.ts
import { Schema, Document, model } from "mongoose";

/**
 * Town model used by Act repo for geospatial fallbacks.
 * NOTE: _id is a STRING to match homeTownId:string across services.
 */

export interface TownDocument extends Document {
  _id: string; // string id (e.g., "austin-tx" or FIPS)
  name: string; // "Austin"
  state: string; // "TX"
  lat: number;
  lng: number;
  county?: string;
  population?: number;
  fips?: string;
  loc: { type: "Point"; coordinates: [number, number] }; // [lng, lat]
}

const TownSchema = new Schema<TownDocument>(
  {
    _id: { type: String, required: true }, // << string, not ObjectId
    name: { type: String, required: true, index: true },
    state: { type: String, required: true, index: true },

    lat: { type: Number, required: true },
    lng: { type: Number, required: true },

    county: { type: String },
    population: { type: Number },
    fips: { type: String },

    loc: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
        validate: {
          validator(v: number[]) {
            return (
              Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)
            );
          },
          message: "loc.coordinates must be [lng, lat] numbers",
        },
      },
    },
  },
  {
    strict: true,
    versionKey: false,
    // indexes built here; connection should have bufferCommands=false at bootstrap per SOP
  }
);

// Fast lookups and spatial queries
TownSchema.index({ name: 1, state: 1 }, { name: "idx_name_state" }); // non-unique: towns with same name exist across states
TownSchema.index({ loc: "2dsphere" });

const TownModel = model<TownDocument>("Town", TownSchema);
export default TownModel;
