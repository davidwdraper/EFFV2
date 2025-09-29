import mongoose from 'mongoose';

const placeSchema = new mongoose.Schema({
  name: String,
  category: String,
  description: String,
  address: String,
  latitude: Number,
  longitude: Number
});

placeSchema.index({ latitude: 1, longitude: 1 });

const Place = mongoose.model('Place', placeSchema);
export default Place;