// backend/services/user/src/models/User.ts
import mongoose, { Schema, Document } from "mongoose";
import { IUser } from "@shared/interfaces/User/IUser";
import { normalizeEmail, emailToBucket } from "../../../shared/tenant/bucket";

// Export the document type so other modules can import it.
export interface UserDocument extends Document, IUser {
  // New fields for future partitioning (kept optional for existing docs)
  emailNorm?: string;
  bucket?: number;
}

const userSchema = new Schema<UserDocument>(
  {
    dateCreated: { type: Date, required: true },
    dateLastUpdated: { type: Date, required: true },

    userStatus: { type: Number, required: true, default: 0 },
    userType: { type: Number, required: true, default: 0 },

    userEntryId: { type: String }, // populated post-save
    userOwnerId: { type: String }, // populated post-save

    lastname: { type: String, required: true, index: true },
    middlename: { type: String },
    firstname: { type: String, required: true, index: true },

    email: {
      type: String,
      required: true,
      unique: true, // keep global uniqueness today
      lowercase: true,
      trim: true,
      index: true,
    },

    // ── Canonicalized fields (non-breaking; optional for legacy docs) ──
    emailNorm: { type: String, index: true },
    bucket: { type: Number, min: 0, index: true },

    password: { type: String, required: true },

    // Removed the 10-item validation limit; keep array with default []
    imageIds: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: false,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.password;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.password;
        return ret;
      },
    },
    strict: true,
    strictQuery: true,
  }
);

// Compound index for lastname + firstname (kept)
userSchema.index({ lastname: 1, firstname: 1 });

// Future-proof uniqueness: when both emailNorm & bucket are present, enforce unique.
// Partial so legacy docs without these fields won't block index creation.
userSchema.index(
  { bucket: 1, emailNorm: 1 },
  {
    unique: true,
    partialFilterExpression: {
      bucket: { $exists: true },
      emailNorm: { $exists: true },
    },
  }
);

// Normalize email consistently and derive emailNorm + bucket.
// Keep behavior backward-compatible: we always set email to normalized form,
// and we also set emailNorm/bucket so controllers can start using them.
userSchema.pre("validate", function (next) {
  const self = this as UserDocument & { email?: string };

  if (self.email) {
    const norm = normalizeEmail(self.email);
    self.email = norm; // preserve your current single-field email canonicalization
    self.emailNorm = norm; // canonical field for future use
    try {
      self.bucket = emailToBucket(norm); // requires USER_BUCKETS; env is asserted at boot
    } catch {
      // Let it bubble if env missing; fail-fast is desired per SOP.
    }
  }

  next();
});

// Post-save: ensure owner/entry ids default to self if missing
userSchema.post("save", async function (doc) {
  const id = String(doc._id);
  if (!doc.userEntryId || !doc.userOwnerId) {
    await UserModel.updateOne(
      { _id: id },
      { userEntryId: id, userOwnerId: id, dateLastUpdated: new Date() }
    ).exec();
  }
});

const UserModel = mongoose.model<UserDocument>("User", userSchema);
export default UserModel;

// Optional DTO type for controller responses (no password)
export type UserDTO = Omit<UserDocument, "password">;
