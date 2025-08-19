// src/models/Act.ts
import mongoose, { Schema, Document, Types } from "mongoose";
import { IAct } from "@shared/interfaces/Act/IAct";

type ActFields = Omit<IAct, "_id">;

export interface ActDocument extends ActFields, Document {
  homeTownId: Types.ObjectId; // FK → Town
  homeTownLoc: { type: "Point"; coordinates: [number, number] }; // [lng, lat]
}

const actSchema = new Schema<ActDocument>(
  {
    // timestamps kept as strings per your existing behavior
    dateCreated: { type: String, required: true },
    dateLastUpdated: { type: String, required: true },

    actStatus: { type: Number, required: true, default: 0 },
    actType: { type: [Number], required: true },

    userCreateId: { type: String, required: true },
    userOwnerId: { type: String, required: true },

    name: { type: String, required: true, index: true },

    // ✅ canonicalized
    email: { type: String, index: true },

    // Human-readable town string (e.g., "Austin, TX")
    homeTown: { type: String, required: true },

    // Link + denormalized geo
    homeTownId: { type: Schema.Types.ObjectId, ref: "Town", required: true },
    homeTownLoc: {
      type: { type: String, enum: ["Point"], default: "Point", required: true },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator(v: number[]) {
            return (
              Array.isArray(v) &&
              v.length === 2 &&
              v.every((n) => Number.isFinite(n))
            );
          },
          message: "homeTownLoc.coordinates must be [lng, lat] as numbers",
        },
      },
    },

    imageIds: { type: [String], default: [] },
  },
  {
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
      },
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
      },
    },
  }
);

// Unique by (name, homeTownId)
actSchema.index({ name: 1, homeTownId: 1 }, { unique: true });

// 2dsphere index for radius search
actSchema.index({ homeTownLoc: "2dsphere" });

// (Optional) helpful secondary indexes if you expect filters on these fields
// actSchema.index({ actType: 1 });

const Act = mongoose.model<ActDocument>("Act", actSchema);
export default Act;
