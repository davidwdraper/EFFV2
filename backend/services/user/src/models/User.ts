import mongoose, { Schema } from "mongoose";
import bcrypt from "bcrypt";
import { IUser } from "./IUser";

const SALT_ROUNDS = 10;

function arrayLimit(val: string[]) {
  return val.length <= 10;
}

const userSchema = new Schema<IUser>(
  {
    dateCreated: { type: Date, required: true },
    dateLastUpdated: { type: Date, required: true },
    userStatus: { type: Number, required: true, default: 0 },
    userType: { type: Number, required: true },
    userEntryId: { type: String }, // populated post-save
    userOwnerId: { type: String }, // populated post-save
    lastname: { type: String, required: true },
    middlename: { type: String },
    firstname: { type: String, required: true },
    eMailAddr: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    imageIds: {
      type: [String],
      validate: [arrayLimit, "{PATH} exceeds the limit of 10"],
      default: [],
    },
  },
  { timestamps: false }
);

// 🔐 Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
  next();
});

// 🧠 Assign IDs post-save safely (no middleware loop)
userSchema.post("save", async function (doc) {
  const id = doc._id.toString();

  if (!doc.userEntryId || !doc.userOwnerId) {
    await UserModel.updateOne(
      { _id: id },
      {
        userEntryId: id,
        userOwnerId: id,
        dateLastUpdated: new Date(),
      }
    );
  }
});

// 📦 Create and export model
export const UserModel = mongoose.model<IUser>("User", userSchema);
