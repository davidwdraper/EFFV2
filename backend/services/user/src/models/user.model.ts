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

  password?: string; // not required on PUT create; hidden by default

  imageIds: string[];
}

const now = () => new Date();

const userSchema = new Schema<UserDocument>(
  {
    // Dates: model stamps them (defaults + update hook below)
    dateCreated: { type: Date, required: true, default: now },
    dateLastUpdated: { type: Date, required: true, default: now },

    userStatus: { type: Number, required: true, default: 0 },
    userType: { type: Number, required: true, default: 0 },

    userEntryId: { type: String },
    userOwnerId: { type: String },

    lastname: { type: String, required: true, index: true, trim: true },
    middlename: { type: String, trim: true },
    firstname: { type: String, required: true, index: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true, // global uniqueness (for now)
      lowercase: true,
      trim: true,
      index: true,
    },

    emailNorm: { type: String, index: true },
    bucket: { type: Number, min: 0, index: true },

    // Credentials are NOT part of the domain contract.
    // Hide by default; specific handlers may opt-in via .select('+password').
    password: { type: String, select: false, required: false },

    imageIds: { type: [String], default: [] },
  },
  {
    bufferCommands: false, // SOP: disable buffering at model level
    timestamps: false, // we control dates explicitly
    toJSON: {
      virtuals: true,
      versionKey: false,
      getters: true, // apply getters so dates emit as ISO strings
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
      getters: true, // apply getters on .toObject()
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
      // Let env assertion fail at boot per SOP if misconfigured.
    }
  }
  next();
});

// Auto-update dateLastUpdated on any atomic update
userSchema.pre("findOneAndUpdate", function () {
  this.set({ dateLastUpdated: now() });
});

// Post-save: ensure owner/entry ids default to self if missing
userSchema.post("save", async function (doc) {
  const id = String(doc._id);
  if (!doc.userEntryId || !doc.userOwnerId) {
    await UserModel.updateOne(
      { _id: id },
      { userEntryId: id, userOwnerId: id, dateLastUpdated: now() }
    ).exec();
  }
});

// Getters so dates serialize as ISO strings (matches zIsoDate)
userSchema.path("dateCreated").get((v: Date) => v?.toISOString());
userSchema.path("dateLastUpdated").get((v: Date) => v?.toISOString());

// Export model
const UserModel = mongoose.model<UserDocument>("User", userSchema);
export default UserModel;
