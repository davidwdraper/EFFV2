"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
// File: shared/utils/logger.ts
const axios_1 = __importDefault(require("axios"));
const NODE_ENV = process.env.NODE_ENV || 'dev';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_SERVICE_URL = process.env.LOG_SERVICE_URL || 'http://localhost:4006/log';
console.warn('[logger] 🧪 This is the real logger.ts being loaded');
const levelMap = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};
const currentLevel = levelMap[LOG_LEVEL.toLowerCase()] ?? 2;
function getCallerLocation() {
    const err = new Error();
    const stack = err.stack?.split('\n') || [];
    // Find first stack line outside logger.ts and node_modules
    const callerLine = stack.find(line => line.includes('/services/') &&
        line.includes('.ts') &&
        !line.includes('node_modules'));
    if (!callerLine) {
        console.warn('[logger] No matching caller line found');
        return {};
    }
    const match = callerLine.match(/at\s+(.*):(\d+):(\d+)/);
    if (!match) {
        console.warn('[logger] Regex failed to extract location from:', callerLine);
        return {};
    }
    const fullPath = match[1];
    const line = parseInt(match[2], 10);
    const pathParts = fullPath.split('/');
    const file = pathParts.slice(-2).join('/');
    const service = pathParts.includes('services') ? pathParts[pathParts.indexOf('services') + 1] : undefined;
    return { service, file, line };
}
function extractLogContext(req) {
    return {
        path: req.originalUrl,
        method: req.method,
        userId: req.user?._id,
        entityId: req.params?.id,
        entityName: req.entityName,
        ip: req.ip,
    };
}
exports.logger = {
    async log(type, message, meta = {}) {
        const level = levelMap[type];
        console.warn(`[logger] log() called with type="${type}" | level=${level} | currentLevel=${currentLevel}`); // ✅ Add this
        if (level > currentLevel)
            return;
        const { service, file, line } = getCallerLocation();
        try {
            await axios_1.default.post(LOG_SERVICE_URL, {
                logType: level,
                logSeverity: level,
                message,
                ...meta,
                service,
                sourceFile: file,
                sourceLine: line,
                timeCreated: new Date().toISOString(),
            });
        }
        catch (err) {
            if (NODE_ENV === 'dev') {
                if (err instanceof Error) {
                    // TODO: write to filesystem
                    console.warn('[logger] Failed to send log:', err.message);
                }
                else {
                    console.warn('[logger] Failed to send log:', err);
                }
            }
        }
    },
    error(msg, meta) {
        return this.log('error', msg, meta);
    },
    warn(msg, meta) {
        return this.log('warn', msg, meta);
    },
    info(msg, meta) {
        return this.log('info', msg, meta);
    },
    debug(msg, meta) {
        return this.log('debug', msg, meta);
    },
    extractLogContext,
};
