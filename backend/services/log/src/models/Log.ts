import mongoose from 'mongoose';

const LogSchema = new mongoose.Schema({
  logType: { type: Number, required: true },
  logSeverity: { type: Number, required: true },
  message: { type: String, required: true },
  path: { type: String },
  userId: { type: String },
  entityId: { type: String },
  entityName: { type: String },
  service: { type: String },
  sourceFile: { type: String },
  sourceLine: { type: Number },
  timeCreated: { type: Date, required: true },
});

export const LogModel = mongoose.model('Log', LogSchema);
