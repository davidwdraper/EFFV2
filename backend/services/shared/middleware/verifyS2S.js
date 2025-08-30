"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyS2S = verifyS2S;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const AUD = process.env.S2S_JWT_AUDIENCE || "internal-services";
const ALLOWED_ISS = (process.env.S2S_ALLOWED_ISSUERS || "gateway,gateway-core,internal")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const ALLOWED_CALLERS = (process.env.S2S_ALLOWED_CALLERS || "gateway,gateway-core")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const OPEN = new Set(["/", "/health", "/healthz", "/readyz"]);
function verifyS2S(req, res, next) {
    if (OPEN.has(req.path))
        return next();
    const raw = req.headers.authorization || "";
    const tok = raw.startsWith("Bearer ") ? raw.slice(7) : "";
    if (!tok)
        return res
            .status(401)
            .json({ code: "UNAUTHORIZED", status: 401, message: "Missing token" });
    try {
        const p = jsonwebtoken_1.default.verify(tok, process.env.S2S_JWT_SECRET, {
            audience: AUD,
        });
        if (!ALLOWED_ISS.includes(p.iss)) {
            return res
                .status(401)
                .json({ code: "UNAUTHORIZED", status: 401, message: "Bad issuer" });
        }
        if (!ALLOWED_CALLERS.includes(p.svc)) {
            return res
                .status(403)
                .json({
                code: "FORBIDDEN",
                status: 403,
                message: "Caller not allowed",
            });
        }
        req.s2s = p;
        return next();
    }
    catch {
        return res
            .status(401)
            .json({
            code: "UNAUTHORIZED",
            status: 401,
            message: "Invalid signature",
        });
    }
}
