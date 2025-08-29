// backend/services/template/src/models/geo.model.ts
import { Schema, Document, model } from "mongoose";

/**
 * Template Geo Document
 * -------------------------------------------------
 * Replace with real fields from your geo.contract.ts
 */
export interface EntityDocument extends Document {
  dateCreated: Date;
  dateLastUpdated: Date;
  name: string;
  // add your geo-specific fields here
}

const EntitySchema = new Schema<EntityDocument>(
  {
    name: { type: String, required: true, index: true },
    // add more geo-specific fields with validators, defaults, etc.
  },
  {
    strict: true,
    versionKey: false,
    timestamps: { createdAt: "dateCreated", updatedAt: "dateLastUpdated" },
  }
);

// Example unique index — adjust or remove
EntitySchema.index({ name: 1 }, { unique: true, name: "uniq_name" });

/**
 * Pre-validate hook for normalization or invariants
 * Replace with geo-specific logic (e.g. normalizeName)
 */
EntitySchema.pre("validate", function (next) {
  try {
    if (!this.name) {
      return next(new Error("name is required"));
    }
    this.name = this.name.trim();
    next();
  } catch (err) {
    next(err as Error);
  }
});

const EntityModel = model<EntityDocument>("Geo", EntitySchema);
export default EntityModel;
