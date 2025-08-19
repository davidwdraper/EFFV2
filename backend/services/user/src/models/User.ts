// backend/services/user/src/models/User.ts
import mongoose, { Schema, Document } from "mongoose";
import { IUser } from "@shared/interfaces/User/IUser";

function arrayLimit(val: string[]) {
  return Array.isArray(val) && val.length <= 10;
}

// Export the document type so other modules can import it.
export interface UserDocument extends Document, IUser {}

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
      unique: true,
      lowercase: true,
      trim: true,
      index: true, // ✅ explicit email index
    },
    password: { type: String, required: true },
    imageIds: {
      type: [String],
      validate: [arrayLimit, "{PATH} exceeds the limit of 10"],
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
  }
);

// Compound index for lastname + firstname
userSchema.index({ lastname: 1, firstname: 1 });

// Normalize email consistently
userSchema.pre("validate", function (next) {
  const self = this as any;
  if (self.email) self.email = String(self.email).toLowerCase().trim();
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
