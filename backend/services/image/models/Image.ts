import mongoose from 'mongoose';

const ImageSchema = new mongoose.Schema({
  image: {
    type: Buffer,
    required: true,
  },
  creationDate: {
    type: Date,
    default: Date.now,
  },
  notes: {
    type: String,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User',
  },
});

export const ImageModel = mongoose.model('Image', ImageSchema);
