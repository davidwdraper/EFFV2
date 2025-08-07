import mongoose, { Schema } from "mongoose";

const TownSchema = new Schema({
  name: { type: String, required: true }, // "Austin"
  state: { type: String, required: true }, // "TX"
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },

  // ✅ GeoJSON point for radius searches
  loc: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: undefined }, // [lng, lat]
  },
});

// Useful name/state index
TownSchema.index({ name: 1, state: 1 });

// ✅ 2dsphere index for $geoNear
TownSchema.index({ loc: "2dsphere" });

export default mongoose.model("Town", TownSchema);
