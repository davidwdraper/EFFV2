import mongoose from 'mongoose';

const userActSchema = new mongoose.Schema({
  actId: { type: String, required: true },
  userId: { type: String, required: true },
  dateCreated: { type: Date, required: true },
  userRole: { type: [Number], required: true }
}, { _id: false });

userActSchema.index({ actId: 1, userId: 1 }, { unique: true });

const UserAct = mongoose.model('UserAct', userActSchema);

export default UserAct;
