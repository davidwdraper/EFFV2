"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Determine current environment (default to development)
const env = process.env.NODE_ENV || 'development';
// Dynamically load the correct .env file (.env.local, .env.docker, etc.)
const envPath = path_1.default.resolve(__dirname, `../../../.env.${env}`);
dotenv_1.default.config({ path: envPath });
// Export service-specific and shared config values
exports.config = {
    env,
    port: parseInt(process.env.ACT_PORT || '4001', 10),
    mongoUri: process.env.ACT_MONGO_URI || 'mongodb://localhost:27017/eff_user_db',
    jwtSecret: process.env.JWT_SECRET || '2468',
    logLevel: process.env.LOG_LEVEL || 'info',
};
