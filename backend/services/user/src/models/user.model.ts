// backend/services/user/src/models/user.model.ts
import mongoose, { Schema, Document } from "mongoose";
import { normalizeEmail, emailToBucket } from "@shared/tenant/bucket";

// Persistence-only document type (do not export to domain)
export interface UserDocument extends Document {
  dateCreated: Date;
  dateLastUpdated: Date;

  userStatus: number;
  userType: number;

  userEntryId?: string;
  userOwnerId?: string;

  lastname: string;
  middlename?: string;
  firstname: string;

  email: string;
  // Canonicalized/partition helpers
  emailNorm?: string;
  bucket?: number;

  password: string;

  imageIds: string[];
}

const userSchema = new Schema<UserDocument>(
  {
    dateCreated: { type: Date, required: true },
    dateLastUpdated: { type: Date, required: true },

    userStatus: { type: Number, required: true, default: 0 },
    userType: { type: Number, required: true, default: 0 },

    userEntryId: { type: String },
    userOwnerId: { type: String },

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

    emailNorm: { type: String, index: true },
    bucket: { type: Number, min: 0, index: true },

    password: { type: String, required: true },

    imageIds: { type: [String], default: [] },
  },
  {
    bufferCommands: false, // SOP: disable buffering at model level
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

// Indexes
userSchema.index({ lastname: 1, firstname: 1 });
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

// Email normalization + partition helpers
userSchema.pre("validate", function (next) {
  const self = this as UserDocument & { email?: string };

  if (self.email) {
    const norm = normalizeEmail(self.email);
    self.email = norm;
    self.emailNorm = norm;
    try {
      self.bucket = emailToBucket(norm); // requires USER_BUCKETS env
    } catch {
      // Let it bubble; env should be asserted at boot per SOP.
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
