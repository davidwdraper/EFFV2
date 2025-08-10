import mongoose, { Schema, Types, model } from "mongoose";

/**
 * Single-owner image model with orphan/linked lifecycle and TTL cleanup.
 * TTL applies only while state === 'orphan' via expiresAtDate.
 */

export type ImageState = "orphan" | "linked" | "deleted";
export type ModerationStatus = "pending" | "valid" | "invalid" | "check";

export interface IImage {
  _id: Types.ObjectId;
  uploadBatchId?: string;
  image: Buffer;
  contentType?: string;
  originalFilename?: string;

  // Optional metadata
  bytes?: number;
  width?: number;
  height?: number;
  checksum?: string;

  creationDate: Date;
  expiresAtDate?: Date; // set when orphan; TTL index cleans it
  state: ImageState; // orphan | linked | deleted
  moderation?: ModerationStatus;
  notes?: string;

  createdBy: Types.ObjectId; // User _id (uploader)
}

const ImageSchema = new Schema<IImage>(
  {
    uploadBatchId: { type: String, index: true },
    image: { type: Buffer, required: true },
    contentType: { type: String },
    originalFilename: { type: String },

    bytes: { type: Number },
    width: { type: Number },
    height: { type: Number },
    checksum: { type: String, index: true },

    creationDate: { type: Date, default: Date.now, index: -1 },
    expiresAtDate: { type: Date }, // TTL index below
    state: {
      type: String,
      enum: ["orphan", "linked", "deleted"],
      default: "orphan",
      index: true,
    },
    moderation: {
      type: String,
      enum: ["pending", "valid", "invalid", "check"],
      default: "pending",
      index: true,
    },
    notes: { type: String },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// TTL: remove docs when expiresAtDate < now (only set for orphans)
ImageSchema.index({ expiresAtDate: 1 }, { expireAfterSeconds: 0 });

// Helpful secondary indexes
ImageSchema.index({ createdBy: 1, creationDate: -1 });
ImageSchema.index({ state: 1, creationDate: -1 });
ImageSchema.index({ uploadBatchId: 1, creationDate: -1 });

export const ImageModel = model<IImage>("Image", ImageSchema);
