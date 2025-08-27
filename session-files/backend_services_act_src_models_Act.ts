// backend/services/act/src/models/Act.ts
import mongoose, { Schema, Document, Types } from "mongoose";

// Keep this model self-contained to avoid drift with old interfaces.
// _id stays canonical; timestamps remain strings.

export type BlackoutDays = [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
]; // [Sun..Sat] or your chosen ordering

export interface ActDocument extends Document {
  // Timestamps as strings (ISO recommended)
  dateCreated: string;
  dateLastUpdated: string;

  // Core fields
  actStatus: number; // default 0
  actType: number[]; // >= 1
  userCreateId: string;
  userOwnerId: string;
  name: string;
  email?: string;

  // Hometown / geo
  homeTown: string; // human-readable (e.g., "Austin, TX")
  homeTownId: Types.ObjectId; // FK → Town
  homeTownLoc: { type: "Point"; coordinates: [number, number] }; // [lng, lat]

  // Assets
  imageIds?: string[];

  // NEW optional fields (for frontend; optional until UI refactor)
  websiteUrl?: string;
  distanceWillingToTravel?: number; // miles
  genreList?: number[]; // enum codes
  actDuration?: number; // minutes
  breakLength?: number; // minutes
  numberOfBreaks?: number;
  bookingNotes?: string;
  earliestStartTime?: string; // "HH:MM" or "HH:MM:SS"
  latestStartTime?: string; // "HH:MM" or "HH:MM:SS"
  blackoutDays?: BlackoutDays;
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const actSchema = new Schema<ActDocument>(
  {
    // timestamps kept as strings per your existing behavior
    dateCreated: { type: String, required: true },
    dateLastUpdated: { type: String, required: true },

    actStatus: { type: Number, required: true, default: 0 },
    actType: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => Array.isArray(v) && v.length > 0,
        message: "actType must be a non-empty array",
      },
    },

    userCreateId: { type: String, required: true },
    userOwnerId: { type: String, required: true },

    // Name is indexed (non-unique). Uniqueness is enforced only together with homeTownId.
    name: { type: String, required: true, index: true },

    // canonicalized email (non-unique helper index via { index: true })
    email: { type: String, index: true },

    // Human-readable town string (e.g., "Austin, TX")
    homeTown: { type: String, required: true },

    // Link + denormalized geo
    homeTownId: { type: Schema.Types.ObjectId, ref: "Town", required: true },
    homeTownLoc: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number], // [lng, lat]
        required: true,
        validate: {
          validator(v: number[]) {
            return (
              Array.isArray(v) &&
              v.length === 2 &&
              v.every((n) => Number.isFinite(n))
            );
          },
          message: "homeTownLoc.coordinates must be [lng, lat] numbers",
        },
      },
    },

    imageIds: { type: [String], default: [] },

    // ── NEW optional fields ───────────────────────────────────────────────────
    websiteUrl: { type: String },
    distanceWillingToTravel: { type: Number, min: 0 },
    genreList: { type: [Number], default: undefined }, // keep undefined if absent
    actDuration: { type: Number, min: 0 },
    breakLength: { type: Number, min: 0 },
    numberOfBreaks: { type: Number, min: 0 },
    bookingNotes: { type: String },
    earliestStartTime: {
      type: String,
      validate: {
        validator: (v: string | undefined) => v === undefined || timeRe.test(v),
        message: 'earliestStartTime must be "HH:MM" or "HH:MM:SS"',
      },
    },
    latestStartTime: {
      type: String,
      validate: {
        validator: (v: string | undefined) => v === undefined || timeRe.test(v),
        message: 'latestStartTime must be "HH:MM" or "HH:MM:SS"',
      },
    },
    blackoutDays: {
      type: [Boolean],
      validate: {
        validator: (v: boolean[] | undefined) =>
          v === undefined || (Array.isArray(v) && v.length === 7),
        message: "blackoutDays must be an array of 7 booleans",
      },
      default: undefined, // keep missing if not provided
    },
  },
  {
    strict: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      // IMPORTANT: Keep `_id` — no aliasing to `id`
      transform: (_doc, ret) => {
        // do NOT delete _id; controller handles DTO normalization
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      versionKey: false,
      transform: (_doc, ret) => {
        return ret;
      },
    },
  }
);

// Canonical uniqueness: same name can exist in many towns;
// only the pair (name, homeTownId) must be unique.
actSchema.index(
  { name: 1, homeTownId: 1 },
  { unique: true, name: "uniq_name_homeTownId" }
);

// 2dsphere index for radius search
actSchema.index({ homeTownLoc: "2dsphere" });

// Helpful secondary indexes (uncomment if/when needed)
// actSchema.index({ actType: 1 });
// actSchema.index({ userOwnerId: 1 });

const Act = mongoose.model<ActDocument>("Act", actSchema);
export default Act;
