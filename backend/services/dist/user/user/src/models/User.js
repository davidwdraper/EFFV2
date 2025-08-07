"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const bcrypt_1 = __importDefault(require("bcrypt"));
function arrayLimit(val) {
    return val.length <= 10;
}
const userSchema = new mongoose_1.Schema({
    dateCreated: { type: Date, required: true },
    dateLastUpdated: { type: Date, required: true },
    userStatus: { type: Number, required: true, default: 0 },
    userType: { type: Number, required: true },
    userEntryId: { type: String }, // populated post-save
    userOwnerId: { type: String }, // populated post-save
    lastname: { type: String, required: true },
    middlename: { type: String },
    firstname: { type: String, required: true },
    eMailAddr: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    imageIds: {
        type: [String],
        validate: [arrayLimit, '{PATH} exceeds the limit of 10'],
        default: [],
    },
}, { timestamps: false });
// 🔐 Hash password before save
userSchema.pre('save', async function (next) {
    if (!this.isModified('password'))
        return next();
    this.password = await bcrypt_1.default.hash(this.password, 10);
    next();
});
// 🧠 Assign _id to entry/owner IDs post-save if not set
userSchema.post('save', async function (doc) {
    const id = doc._id.toString();
    if (!doc.userEntryId || !doc.userOwnerId) {
        doc.userEntryId = id;
        doc.userOwnerId = id;
        doc.dateLastUpdated = new Date();
        await doc.save(); // triggers no re-hash due to password check
    }
});
// 📦 Create and export model with IUser type
exports.UserModel = mongoose_1.default.model('User', userSchema);
