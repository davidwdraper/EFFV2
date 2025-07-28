import mongoose from 'mongoose';

const eventActSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  actId: { type: String, required: true },
  dateCreated: { type: Date, required: true },
  createUserId: { type: String, required: true },
}, { versionKey: false });

eventActSchema.index({ eventId: 1, actId: 1 }, { unique: true });

export const EventAct = mongoose.model('EventAct', eventActSchema);
