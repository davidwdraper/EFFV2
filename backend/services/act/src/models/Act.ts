// src/models/Act.ts
import mongoose, { Schema, Document } from 'mongoose';
import { IAct } from '@shared/interfaces/Act/IAct';

// Remove _id from IAct so Mongoose can define its own version
type ActFields = Omit<IAct, '_id'>;

// Define the model document type
export interface ActDocument extends ActFields, Document {}

const actSchema = new Schema<ActDocument>({
  dateCreated: { type: String, required: true },
  dateLastUpdated: { type: String, required: true },
  actStatus: { type: Number, required: true, default: 0 },
  actType: { type: [Number], required: true },
  userCreateId: { type: String, required: true },
  userOwnerId: { type: String, required: true },
  name: { type: String, required: true },
  eMailAddr: { type: String },
  imageIds: { type: [String], default: [] },
});

const Act = mongoose.model<ActDocument>('Act', actSchema);

export default Act;
