import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  dateCreated: { type: Date, required: true },
  dateLastUpdated: { type: Date, required: true },
  status: { type: Number, required: true, default: 0 },
  type: { type: [Number], required: true },
  userCreateId: { type: String, required: true },
  userOwnerId: { type: String, required: true },
  name: { type: String, required: true },
  comments: { type: String },
  startDateTime: { type: Date, required: true },
  endDateTime: { type: Date, required: true },
  repeatDay: { type: [Number], required: true },
  imageIds: { type: [String], default: [], maxlength: 10 }
}, { _id: false });

eventSchema.index({ name: 1 });
eventSchema.index({ type: 1 });

const EventModel = mongoose.model('Event', eventSchema);

export default EventModel;
