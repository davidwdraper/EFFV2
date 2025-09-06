// backend/services/act/src/models/Act.ts
import { Schema, Document, model } from "mongoose";
import { normalizeActName } from "@shared/utils/normalizeActName";

export type BlackoutDays = [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
];

export interface ActDocument extends Document {
  dateCreated: Date;
  dateLastUpdated: Date;

  actStatus: number;
  actType: number[];
  userCreateId: string;
  userOwnerId: string;

  name: string;
  nameNormalized: string;
  aliases?: string[];

  email?: string;

  homeTown: string;
  state: string;
  homeTownId: string;

  // Optional mailing address
  addressStreet1?: string;
  addressStreet2?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;

  // Spatial location (always required)
  actLoc: { type: "Point"; coordinates: [number, number] };

  imageIds: string[];

  websiteUrl?: string;
  distanceWillingToTravel: number;
  genreList: string[];
  actDuration: number;
  breakLength: number;
  numberOfBreaks: number;

  bookingNotes?: string;
  earliestStartTime?: string;
  latestStartTime?: string;
  blackoutDays?: BlackoutDays;

  validatedBy: string[];
  invalidatedBy: string[];
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const zipRe = /^\d{5}(-\d{4})?$/;

const ActSchema = new Schema<ActDocument>(
  {
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

    name: { type: String, required: true, index: true },
    nameNormalized: { type: String, required: true, index: true },
    aliases: { type: [String], default: [] },

    email: { type: String, index: true },

    homeTown: { type: String, required: true },
    state: { type: String, required: true },
    homeTownId: { type: String, required: true },

    // Optional mailing address
    addressStreet1: { type: String },
    addressStreet2: { type: String },
    addressCity: { type: String },
    addressState: { type: String },
    addressZip: {
      type: String,
      validate: {
        validator: (v: string) => !v || zipRe.test(v),
        message: "Invalid ZIP code",
      },
    },

    // Spatial point: required for search, default to town coords if no address provided
    actLoc: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator(v: number[]) {
            return (
              Array.isArray(v) && v.length === 2 && v.every(Number.isFinite)
            );
          },
          message: "actLoc.coordinates must be [lng, lat] numbers",
        },
      },
    },

    imageIds: { type: [String], default: [] },

    websiteUrl: { type: String },
    distanceWillingToTravel: {
      type: Number,
      required: true,
      min: 0,
      default: () => Number(process.env.ACT_DISTANCE_DEFAULT_MI || 50),
    },
    genreList: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) =>
          Array.isArray(v) &&
          v.length > 0 &&
          v.every((s) => typeof s === "string" && s.trim().length > 0),
        message: "genreList must be a non-empty array of strings",
      },
    },
    actDuration: { type: Number, required: true, min: 0 },
    breakLength: { type: Number, required: true, min: 0 },
    numberOfBreaks: { type: Number, required: true, min: 0 },

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
    },

    validatedBy: {
      type: [String],
      validate: {
        validator: (v: string[]) => Array.isArray(v) && v.length <= 3,
        message: "validatedBy must contain at most 3 user IDs",
      },
      default: [],
    },
    invalidatedBy: {
      type: [String],
      validate: {
        validator: (v: string[]) => Array.isArray(v) && v.length <= 3,
        message: "invalidatedBy must contain at most 3 user IDs",
      },
      default: [],
    },
  },
  {
    strict: true,
    versionKey: false,
    timestamps: { createdAt: "dateCreated", updatedAt: "dateLastUpdated" },
  }
);

ActSchema.index(
  { nameNormalized: 1, homeTownId: 1 },
  {
    unique: true,
    name: "uniq_nameNormalized_homeTownId",
    collation: { locale: "en", strength: 1 },
  }
);

ActSchema.index({ actLoc: "2dsphere" });

ActSchema.pre("validate", function (next) {
  try {
    const normalized = normalizeActName(this.name);
    this.nameNormalized = normalized || this.name?.toLowerCase()?.trim() || "";
    if (
      !this.actLoc ||
      !Array.isArray(this.actLoc.coordinates) ||
      this.actLoc.coordinates.length !== 2
    ) {
      return next(new Error("actLoc.coordinates must be provided [lng, lat]"));
    }
    next();
  } catch (err) {
    next(err as Error);
  }
});

const ActModel = model<ActDocument>("Act", ActSchema);
export default ActModel;
