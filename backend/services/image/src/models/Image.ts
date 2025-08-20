// backend/services/image/src/models/Image.ts
import mongoose, { Schema, Types } from "mongoose";

/**
 * Single-owner image model with orphan/linked lifecycle and TTL cleanup.
 * TTL applies only while state === 'orphan' via expiresAtDate.
 */

export type ImageState = "orphan" | "linked" | "deleted";
export type ModerationStatus = "pending" | "valid" | "invalid" | "check";

export interface ImageDocument {
  _id: Types.ObjectId;
  uploadBatchId?: string;
  image: Buffer; // raw bytes (excluded by default)
  contentType?: string;
  originalFilename?: string;

  // Optional metadata
  bytes?: number;
  width?: number;
  height?: number;
  checksum?: string;

  creationDate: Date;
  expiresAtDate?: Date; // when set (for orphans), TTL index purges
  state: ImageState; // orphan | linked | deleted
  moderation?: ModerationStatus;
  notes?: string;

  createdBy: Types.ObjectId; // uploader (User _id)
}

const schema = new Schema<ImageDocument>(
  {
    uploadBatchId: { type: String, index: true },

    // Don’t fetch the big blob unless explicitly requested
    image: { type: Buffer, required: true, select: false }, // select:false excludes by default :contentReference[oaicite:0]{index=0}

    contentType: { type: String },
    originalFilename: { type: String },

    bytes: { type: Number },
    width: { type: Number },
    height: { type: Number },
    checksum: { type: String, index: true },

    creationDate: { type: Date, default: Date.now },
    expiresAtDate: { type: Date }, // TTL index defined below (expireAfterSeconds: 0) :contentReference[oaicite:1]{index=1}

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
    toJSON: {
      virtuals: false,
      transform(_doc, ret) {
        ret.id = ret._id?.toString?.();
        delete ret._id;
        delete ret.image; // never leak raw bytes in DTOs
        return ret;
      },
    },
    toObject: {
      virtuals: false,
      transform(_doc, ret) {
        ret.id = ret._id?.toString?.();
        delete ret._id;
        delete ret.image;
        return ret;
      },
    },
  }
);

// TTL: remove docs when expiresAtDate < now (only set for orphans)
schema.index({ expiresAtDate: 1 }, { expireAfterSeconds: 0 }); // TTL index config :contentReference[oaicite:2]{index=2}

// Helpful secondary indexes
schema.index({ creationDate: -1 });
schema.index({ createdBy: 1, creationDate: -1 });
schema.index({ state: 1, creationDate: -1 });
schema.index({ uploadBatchId: 1, creationDate: -1 });

// Optional de-dupe: same owner + same checksum, excluding “deleted”
schema.index(
  { createdBy: 1, checksum: 1 },
  {
    unique: true,
    partialFilterExpression: {
      checksum: { $type: "string" },
      state: { $ne: "deleted" },
    }, // partial index pattern :contentReference[oaicite:3]{index=3}
  }
);

// Auto-fill bytes if missing
schema.pre("save", function (next) {
  if (!this.bytes && (this as any).image)
    (this as any).bytes = (this as any).image.length;
  next();
});

const ImageModel = mongoose.model<ImageDocument>("Image", schema);
export default ImageModel;
