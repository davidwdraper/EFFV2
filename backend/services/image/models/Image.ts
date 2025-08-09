// services/images/src/models/Image.ts
import mongoose from "mongoose";

const ImageSchema = new mongoose.Schema(
  {
    image: { type: Buffer, required: true },
    contentType: { type: String }, // optional but useful
    originalFilename: { type: String }, // optional
    creationDate: { type: Date, default: Date.now },
    notes: { type: String },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: false }
);

export const ImageModel = mongoose.model("Image", ImageSchema);
