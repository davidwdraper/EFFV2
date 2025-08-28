"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditBuffer = auditBuffer;
const logger_1 = require("../utils/logger");
const IS_PROD = process.env.NODE_ENV === "production";
const ENABLE_INFO_DEBUG = String(process.env.LOG_ENABLE_INFO_DEBUG || "").toLowerCase() === "true";
function auditBuffer() {
    return (req, res, next) => {
        req.audit = [];
        res.on("finish", () => {
            const buf = req.audit;
            if (!buf || buf.length === 0)
                return;
            // Merge stable request context into each audit event (service, requestId, path, etc.)
            const ctx = (0, logger_1.extractLogContext)(req);
            const events = buf.map((e) => ({ ...ctx, ...e }));
            // Fire-and-forget: logger util handles LogSvc/FS/notify per SOP
            void (0, logger_1.postAudit)(events);
            // Telemetry: only emit locally in dev/test (or if explicitly enabled in prod)
            if (!IS_PROD || ENABLE_INFO_DEBUG) {
                // pino-http attaches req.log
                req.log?.info({ count: events.length, path: req.originalUrl }, "audit:flush");
            }
        });
        next();
    };
}
