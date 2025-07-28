import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  actId: String,
  placeId: String,
  datetime: Date,
  recurrence: String // Optional: 'daily', 'weekly', 'monthly', etc.
});

const Event = mongoose.model('Event', eventSchema);
export default Event;