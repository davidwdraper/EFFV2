"use strict";
// backend/services/shared/health.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHealthRouter = createHealthRouter;
const express_1 = __importDefault(require("express"));
function getReqId(req) {
    const h = req.headers["x-request-id"] ||
        req.headers["x-correlation-id"] ||
        req.headers["x-amzn-trace-id"];
    return (Array.isArray(h) ? h[0] : h) || req.id || undefined;
}
/**
 * Exposes:
 *   GET /health   -> legacy/compat liveness
 *   GET /healthz  -> k8s-style liveness
 *   GET /readyz   -> readiness; may include upstream details
 */
function createHealthRouter(opts) {
    const router = express_1.default.Router();
    const base = {
        service: opts.service,
        env: opts.env ?? process.env.NODE_ENV,
        version: opts.version,
        gitSha: opts.gitSha,
    };
    // Legacy liveness (compat with older scripts/monitors)
    router.get("/health", (req, res) => {
        res.json({ ...base, ok: true, instance: getReqId(req) });
    });
    // Kubernetes liveness
    router.get("/healthz", (req, res) => {
        res.json({ ...base, ok: true, instance: getReqId(req) });
    });
    // Readiness (+ optional upstream checks)
    router.get("/readyz", async (req, res) => {
        try {
            const details = opts.readiness ? await opts.readiness(req) : {};
            res.json({ ...base, ok: true, instance: getReqId(req), ...details });
        }
        catch (err) {
            res.status(503).json({
                ...base,
                ok: false,
                instance: getReqId(req),
                error: err instanceof Error ? err.message : String(err),
            });
        }
    });
    return router;
}
