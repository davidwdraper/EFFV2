"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeHttpLogger = makeHttpLogger;
// backend/services/shared/middleware/httpLogger.ts
const pino_http_1 = __importDefault(require("pino-http"));
const crypto_1 = require("crypto");
const logger_1 = require("../utils/logger");
function makeHttpLogger(serviceName) {
    return (0, pino_http_1.default)({
        logger: logger_1.logger,
        genReqId: (req, res) => {
            const hdr = req.headers["x-request-id"] ||
                req.headers["x-correlation-id"] ||
                req.headers["x-amzn-trace-id"];
            const id = (Array.isArray(hdr) ? hdr[0] : hdr) || (0, crypto_1.randomUUID)();
            res.setHeader("x-request-id", id);
            return String(id);
        },
        customLogLevel: (_req, res, err) => {
            if (err)
                return "error";
            const s = res.statusCode;
            if (s >= 500)
                return "error";
            if (s >= 400)
                return "warn";
            return "info";
        },
        customProps: (req) => {
            const r = req;
            const userId = r?.user?.userId || r?.auth?.userId;
            return { service: serviceName, route: r?.route?.path, userId };
        },
        autoLogging: {
            ignore: (req) => {
                const url = req.url;
                return (url === "/health" ||
                    url === "/healthz" ||
                    url === "/readyz" ||
                    url === "/favicon.ico");
            },
        },
        serializers: {
            req(req) {
                const r = req;
                return { id: r.id, method: r.method, url: r.url };
            },
            res(res) {
                return { statusCode: res.statusCode };
            },
        },
    });
}
