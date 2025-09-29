// src/models/EventAct.ts
import mongoose from 'mongoose';

const eventActSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  actId: { type: String, required: true },
  dateCreated: { type: Date, required: true }
}, { _id: false });

eventActSchema.index({ eventId: 1, actId: 1 }, { unique: true });

const EventActModel = mongoose.model('EventAct', eventActSchema);

export default EventActModel;
