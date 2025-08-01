// models/Log.ts

import mongoose, { Schema, Document } from "mongoose";
import { ILogFields } from "@shared/interfaces/Log/ILog";

export interface LogDocument extends ILogFields, Document {}

const logSchema = new Schema<LogDocument>({
  logType: { type: Number, required: true },
  logSeverity: { type: Number, required: true },
  message: { type: String, required: true },
  path: { type: String },
  userId: { type: String },
  entityName: { type: String },
  entityId: { type: String },
  timeCreated: { type: String, required: true }, // ISO string for frontend compatibility
});

const Log = mongoose.model<LogDocument>("Log", logSchema);

export default Log;
