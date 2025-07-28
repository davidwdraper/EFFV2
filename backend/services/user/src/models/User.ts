import mongoose from 'mongoose';

function arrayLimit(val: string[]) {
  return val.length <= 10;
}

const userSchema = new mongoose.Schema(
  {
    dateCreated: { type: Date, required: true },
    dateLastUpdated: { type: Date, required: true },
    userStatus: { type: Number, required: true, default: 0 },
    userType: { type: Number, required: true },
    userEntryId: { type: String, required: true },
    userOwnerId: { type: String, required: true },
    lastname: { type: String, required: true },
    middlename: { type: String },
    firstname: { type: String, required: true },
    eMailAddr: { type: String, required: true, unique: true }, // removed inline index
    imageIds: {
      type: [String],
      validate: [arrayLimit, '{PATH} exceeds the limit of 10'],
      default: [],
    },
  },
  {
    timestamps: false,
  }
);

// Indexes
userSchema.index({ lastname: 1, firstname: 1 });
userSchema.index({ eMailAddr: 1 }, { unique: true });

export default mongoose.model('User', userSchema);
