// src/models/EventPlace.ts
import mongoose from 'mongoose';

const eventPlaceSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  placeId: { type: String, required: true },
  dateCreated: { type: Date, required: true },
  userId: { type: String, required: true }
}, { _id: false });

eventPlaceSchema.index({ eventId: 1, placeId: 1 }, { unique: true });

const EventPlaceModel = mongoose.model('EventPlace', eventPlaceSchema);

export default EventPlaceModel;
