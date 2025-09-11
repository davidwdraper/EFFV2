// backend/services/log/src/models/Log.ts
import mongoose, { Schema, Document } from "mongoose";
import type { LogEvent } from "../../../shared/src/contracts/log";

export interface LogDocument extends Omit<LogEvent, "sourceLine">, Document {
  sourceLine?: number;
}

const LogSchema = new Schema<LogDocument>(
  {
    // identity & timestamps
    eventId: { type: String, required: true, unique: true, index: true },
    timeCreated: { type: String, required: true, index: true },

    // origin & routing
    service: { type: String, index: true },
    channel: { type: String, required: true, index: true }, // "audit" | "error"
    level: { type: String, required: true, index: true },

    // message & context
    message: { type: String, required: true, index: true },
    path: { type: String },
    method: { type: String },
    status: { type: Number },
    requestId: { type: String, index: true },
    userId: { type: String, index: true },
    entityName: { type: String, index: true },
    entityId: { type: String, index: true },

    // caller metadata
    sourceFile: { type: String },
    sourceLine: { type: Number },
    sourceFunction: { type: String },

    // payload bag
    payload: { type: Schema.Types.Mixed },

    // schema version
    v: { type: Number, default: 1 },
  },
  {
    versionKey: false,
    bufferCommands: false,
    timestamps: false,
  }
);

// helpful compound index for common queries
LogSchema.index({ channel: 1, timeCreated: -1 });
LogSchema.index({ service: 1, timeCreated: -1 });

const Log = mongoose.model<LogDocument>("Log", LogSchema, "logs");
export default Log;
