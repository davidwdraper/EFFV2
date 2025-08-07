"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_SECRET = void 0;
// services/user/src/routes/shared/env.ts
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const NODE_ENV = process.env.NODE_ENV || 'dev';
// Resolve absolute path to .env.dev located at: eff/.env.dev
dotenv_1.default.config({
    path: path_1.default.resolve(__dirname, '../../../../../.env.' + NODE_ENV)
});
if (!process.env.JWT_SECRET) {
    throw new Error(`[userService] JWT_SECRET not found in .env.${NODE_ENV}`);
}
exports.JWT_SECRET = process.env.JWT_SECRET;
