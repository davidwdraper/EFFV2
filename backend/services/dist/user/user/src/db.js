"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/db.ts
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("./config");
mongoose_1.default
    .connect(config_1.config.mongoUri)
    .then(() => console.log('[MongoDB] connected'))
    .catch((err) => console.error('[MongoDB] connection error:', err));
