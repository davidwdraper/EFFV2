import mongoose, { Schema } from "mongoose";
import { IUser } from "@shared/interfaces/User/IUser";

function arrayLimit(val: string[]) {
  return val.length <= 10;
}

const userSchema = new Schema<IUser>(
  {
    dateCreated: { type: Date, required: true },
    dateLastUpdated: { type: Date, required: true },
    userStatus: { type: Number, required: true, default: 0 },
    userType: { type: Number, required: true, default: 0 },
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

// ❌ REMOVE PASSWORD HASHING — already hashed upstream
// If you later add a frontend signup flow, consider reinstating this with a flag.

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

export const UserModel = mongoose.model<IUser>("User", userSchema);
