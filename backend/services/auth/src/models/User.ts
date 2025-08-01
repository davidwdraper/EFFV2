// models/userModel.ts
import mongoose, { Document, Model, Schema } from 'mongoose';
import bcrypt from 'bcrypt';

export interface IUser extends Document {
  eMailAddr: string;
  password: string;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>({
  eMailAddr: { type: String, unique: true, required: true },
  password: { type: String, required: true },
});

// 🔐 Pre-save hook for hashing
UserSchema.pre('save', async function (next) {
  const user = this as IUser;

  if (!user.isModified('password')) return next();
  user.password = await bcrypt.hash(user.password, 10);
  next();
});

// 🔐 Method to compare passwords
UserSchema.methods.comparePassword = function (
  candidate: string
): Promise<boolean> {
  return bcrypt.compare(candidate, this.password);
};

// ⚙️ Export with correct typing
export const UserModel: Model<IUser> = mongoose.model<IUser>('User', UserSchema);
