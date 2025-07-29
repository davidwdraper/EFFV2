import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcrypt';
import { IUser } from './IUser';

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
      validate: [arrayLimit, '{PATH} exceeds the limit of 10'],
      default: [],
    },
  },
  { timestamps: false }
);

// 🔐 Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// 🧠 Assign _id to entry/owner IDs post-save if not set
userSchema.post('save', async function (doc) {
  const id = doc._id.toString();

  if (!doc.userEntryId || !doc.userOwnerId) {
    doc.userEntryId = id;
    doc.userOwnerId = id;
    doc.dateLastUpdated = new Date();
    await doc.save(); // triggers no re-hash due to password check
  }
});

// 📦 Create and export model with IUser type
export const UserModel = mongoose.model<IUser>('User', userSchema);
