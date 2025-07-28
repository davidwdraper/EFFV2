import mongoose from 'mongoose';

const eventPlaceSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  placeId: { type: String, required: true },
  dateCreated: { type: Date, required: true },
  createUserId: { type: String, required: true },
}, { versionKey: false });

eventPlaceSchema.index({ eventId: 1, placeId: 1 }, { unique: true });

export const EventPlace = mongoose.model('EventPlace', eventPlaceSchema);
