import mongoose, { Schema } from "mongoose";

const TownSchema = new Schema({
  name: { type: String, required: true },
  state: { type: String, required: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
});

export default mongoose.model("Town", TownSchema);
