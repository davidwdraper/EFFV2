"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.coreMiddleware = coreMiddleware;
// backend/services/shared/middleware/core.ts
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
function coreMiddleware() {
    return [
        (0, cors_1.default)({ origin: true, credentials: true }),
        express_1.default.json({ limit: "2mb" }),
        express_1.default.urlencoded({ extended: true }),
    ];
}
