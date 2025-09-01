// backend/services/user/src/models/user.directory.model.ts
import mongoose, { Schema, Document } from "mongoose";

// Persistence-only; a separate read-model for discovery searches
export interface DirectoryDocument extends Document {
  userId: string;
  bucket: number;
  email: string; // raw (internal/audit)
  emailNorm: string; // normalized
  givenName?: string;
  familyName?: string;
  nameFold: string; // "john smith" lowercased/trimmed
  givenFold?: string; // "john"
  familyFold?: string; // "smith"
  city?: string;
  state?: string;
  country?: string;
  dateCreated: string; // kept as string for back-compat
  dateLastUpdated: string;
}

const schema = new Schema<DirectoryDocument>(
  {
    userId: { type: String, required: true, index: true },
    bucket: { type: Number, required: true, min: 0 },
    email: { type: String, required: true },
    emailNorm: { type: String, required: true, index: true },
    givenName: { type: String },
    familyName: { type: String },
    nameFold: { type: String, required: true, index: true },
    givenFold: { type: String, index: true },
    familyFold: { type: String, index: true },
    city: { type: String },
    state: { type: String },
    country: { type: String },
    dateCreated: { type: String, required: true },
    dateLastUpdated: { type: String, required: true },
  },
  {
    bufferCommands: false, // SOP
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_d, r) => {
        (r as any).id = (r as any)._id;
        delete (r as any)._id;
      },
    },
    toObject: { virtuals: true, versionKey: false },
    strict: true,
    strictQuery: true,
  }
);

// Global uniqueness on normalized email (case-insensitive)
schema.index(
  { emailNorm: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

export default mongoose.model<DirectoryDocument>("Directory", schema);
