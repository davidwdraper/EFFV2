ChatGPT session startup information.

New-Session SOP (NowVibin backend)
Prime Directives

I’m the developer. You want full file drops, not nibbles. I’ll provide complete, ready-to-paste files with the path in a comment on the first line.

Existing files? You upload them. I won’t guess. For any pre-existing file, I’ll ask you to paste it so I can merge accurately.

Uniform template. Every service mirrors the Act service structure and shared components 1:1.

Routes are one-liners. Route files only map HTTP → controller method. No logic in routes.

No hard-coded env values. Code never bakes secrets or config values. Env names are allowed; values come from env files.

Instrumentation on every endpoint. Entry/exit + errors via pino (pino-http in app.ts).

Audit on mutations. Any non-idempotent change (create/update/delete/side effects) is logged through the home-built audit logger and flushed once per request.

try/catch everywhere that matters. Controllers and bootstraps use structured error handling (via asyncHandler + global error middleware).

Best practices always. Safe-by-default, deterministic, lint/TS clean, minimal magic.

Audit-ready. Everything should withstand a technical audit (investors, M&A). Clear env validation, consistent logging, no silent fallbacks in production.

Header comment. Every file I produce starts with its full repo path in a single-line comment.

Dev convenience vs prod strictness. For local dev I can default the env file path to .env.dev in bootstrap; in prod, ENV_FILE must be explicit. No value fallbacks, ever.

Canonical Service Layout (mirror Act)
backend/services/<svc>/
├─ index.ts # boots app (imports ./src/bootstrap first)
└─ src/
├─ bootstrap.ts # loads ENV_FILE (dev: .env.dev), asserts required envs
├─ app.ts # express app, pino-http, health, routes, errors
├─ config.ts # named exports; no defaults; helpers like requireUpstream
├─ db.ts # connects to DB, safe logging, fail-fast or retry policy
├─ routes/
│ └─ <domain>Routes.ts # one-liners: router.<verb>(path, controller.method)
├─ controllers/
│ └─ <domain>Controller.ts # logic/validation; asyncHandler; audit pushes
├─ models/
│ └─ <Domain>.ts # mongoose model, default export; strict schema, indexes
└─ middleware/ (if needed)

Shared, identical across services:

backend/services/shared/
├─ config/env.ts # loadEnvFromFileOrThrow, assertRequiredEnv
├─ health.ts # createHealthRouter: /health, /healthz, /readyz; exports ReadinessFn
└─ utils/
├─ logger.ts # pino instance + postAudit(), extractLogContext()
└─ logMeta.ts # getCallerInfo() helper used by logger

Required Libraries & Typing Notes

Use pino + pino-http (do not install @types/pino-http; types are bundled).

Express + TypeScript (RequestHandler and an asyncHandler wrapper).

Mongoose models export default (export default Model), controllers import import Model from "...";

Use autoLogging.ignore with pino-http, not ignorePaths.

Generate/propagate a request id: read x-request-id/x-correlation-id/x-amzn-trace-id, else randomUUID(). Echo it back.

Bootstrap Template (per service)
// backend/services/<svc>/src/bootstrap.ts
import path from "path";
import { loadEnvFromFileOrThrow, assertRequiredEnv } from "../../shared/config/env";

// Dev-friendly: default to .env.dev if ENV_FILE not provided. In prod, set ENV_FILE explicitly.
const envFile = (process.env.ENV_FILE && process.env.ENV_FILE.trim()) || ".env.dev";
// Resolve from monorepo root, not service cwd
const resolved = path.resolve(\_\_dirname, "../../../../..", envFile);
console.log(`[bootstrap] Loading env from: ${resolved}`);
loadEnvFromFileOrThrow(resolved);

// Assert required env for this service (no value defaults)
assertRequiredEnv([
"LOG_LEVEL",
"LOG_SERVICE_URL",
"<SVC>_SERVICE_NAME", // e.g., ACT_SERVICE_NAME
"<SVC>_MONGO_URI", // if DB-backed
"<SVC>_PORT",
]);

Index Template
// backend/services/<svc>/index.ts
import "./src/bootstrap";
import app from "./src/app";
import { logger } from "../shared/utils/logger";
import { config } from "./src/config"; // or named exports; see config policy below

const port = config.port; // already validated
const server = app.listen(port, () => {
logger.info({ service: config.serviceName, port }, `${config.serviceName} listening`);
});

process.on("SIGTERM", () => { logger.info("SIGTERM"); server.close(() => process.exit(0)); });
process.on("SIGINT", () => { logger.info("SIGINT"); server.close(() => process.exit(0)); });

app.ts Template (pino, entry/exit, health, routes, errors)
// backend/services/<svc>/src/app.ts
import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { logger, postAudit, extractLogContext } from "../../shared/utils/logger";
import { createHealthRouter } from "../../shared/health";
import domainRoutes from "./routes/<domain>Routes"; // one-liners
import { serviceName } from "./config";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(pinoHttp({
logger,
genReqId: (req, res) => {
const hdr = req.headers["x-request-id"] || req.headers["x-correlation-id"] || req.headers["x-amzn-trace-id"];
const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID();
res.setHeader("x-request-id", id);
return String(id);
},
customLogLevel(\_req, res, err) {
if (err) return "error";
const s = res.statusCode; if (s >= 500) return "error"; if (s >= 400) return "warn"; return "info";
},
customProps(req) { return { service: serviceName, route: (req as any).route?.path }; },
autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/healthz" || req.url === "/readyz" || req.url === "/favicon.ico" },
serializers: {
req(req) { return { id: (req as any).id, method: req.method, url: req.url }; },
res(res) { return { statusCode: res.statusCode }; },
},
}));

// Entry/Exit logs (uniform)
app.use((req, res, next) => {
const start = process.hrtime.bigint();
req.log.info({ msg: "handler:start", method: req.method, url: req.originalUrl, params: req.params, query: req.query }, "request entry");
res.on("finish", () => {
const ms = Number(process.hrtime.bigint() - start) / 1e6;
req.log.info({ msg: "handler:finish", statusCode: res.statusCode, durationMs: Math.round(ms) }, "request exit");
});
next();
});

// Request-scoped audit buffer
declare global { namespace Express { interface Request { audit?: Array<Record<string, any>>; } } }
app.use((req, res, next) => {
req.audit = [];
res.on("finish", () => {
if (req.audit?.length) {
const ctx = extractLogContext(req);
void postAudit(req.audit.map(e => ({ ...ctx, ...e })));
req.log.info({ msg: "audit:flush", count: req.audit.length }, "audit events flushed");
}
});
next();
});

// Health endpoints (legacy + k8s)
app.use(createHealthRouter({
service: serviceName,
readiness: async () => ({ upstreams: { ok: true } }),
}));

// Routes (one-liner group mount)
app.use("/<domainPlural>", domainRoutes);

// 404 and error handler
app.use((\_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));
app.use((err: any, req: express.Request, res: express.Response, \_next: express.NextFunction) => {
const status = Number(err?.status || err?.statusCode || 500);
req.log?.error({ msg: "handler:error", err, status }, "request error");
res.status(Number.isFinite(status) ? status : 500).json({ error: { code: err?.code || "INTERNAL_ERROR", message: err?.message || "Unexpected error" } });
});

export default app;

Routes (one-liners)
// backend/services/<svc>/src/routes/<domain>Routes.ts
import { Router } from "express";
import \* as c from "../controllers/<domain>Controller";
const r = Router();

r.get("/ping", c.ping);
r.get("/", c.list);
r.get("/:id", c.getById);
r.post("/", c.create);
r.put("/:id", c.update);
r.delete("/:id", c.remove);

export default r;

Controllers (logic only, asyncHandler, try/catch via wrapper)
// backend/services/<svc>/src/controllers/<domain>Controller.ts
import type { RequestHandler, Request, Response, NextFunction } from "express";
import Model from "../models/<Domain>";

const asyncHandler = (fn: RequestHandler) =>
(req: Request, res: Response, next: NextFunction): void => { Promise.resolve(fn(req, res, next)).catch(next); };

export const ping: RequestHandler = asyncHandler(async (\_req, res) => {
res.json({ ok: true, service: "<svc>", ts: new Date().toISOString() });
});

export const create: RequestHandler = asyncHandler(async (req, res) => {
const body = req.body || {};
// validate required fields here...
const now = new Date().toISOString();
const doc = await Model.create({ ...body, dateCreated: now, dateLastUpdated: now });
// audit example
req.audit?.push({ type: "create", model: "<Domain>", id: String(doc.\_id) });
res.status(201).json(doc);
});

// list/get/update/remove: same pattern, add audits on mutations

Model (default export, indexes, consistent field names)
// backend/services/<svc>/src/models/<Domain>.ts
import mongoose, { Schema, Document } from "mongoose";

export interface <Domain>Document extends Document {
name: string;
email?: string;
dateCreated: string;
dateLastUpdated: string;
}

const schema = new Schema<<Domain>Document>({
name: { type: String, required: true, index: true },
email: { type: String, index: true },
dateCreated: { type: String, required: true },
dateLastUpdated: { type: String, required: true },
}, { toJSON: { virtuals: true, versionKey: false, transform: (\_d, r) => { r.id = r.\_id; delete r.\_id; } },
toObject: { virtuals: true, versionKey: false, transform: (\_d, r) => { r.id = r.\_id; delete r.\_id; } } });

schema.index({ name: 1 }, { unique: false });

export default mongoose.model<<Domain>Document>("<Domain>", schema);

Config (named exports; no defaults; helper for upstreams)
// backend/services/<svc>/src/config.ts
import { requireEnv, requireNumber } from "../../shared/env"; // your helpers

export const serviceName = requireEnv("<SVC>\_SERVICE_NAME"); // e.g., ACT_SERVICE_NAME
export const port = requireNumber("<SVC>\_PORT");

export function requireUpstream(name:
| "USER_SERVICE_URL" | "ACT_SERVICE_URL" | "PLACE_SERVICE_URL" | "EVENT_SERVICE_URL") {
return requireEnv(name);
}

export const mongoUri = process.env.<SVC>\_MONGO_URI ? requireEnv("<SVC>\_MONGO_URI") : "";
export const logLevel = requireEnv("LOG_LEVEL");
export const logServiceUrl = requireEnv("LOG_SERVICE_URL");

// Optional: export a config object if desired
export const config = { serviceName, port, mongoUri, logLevel, logServiceUrl, requireUpstream };

DB Connection (safe logging, no secret leakage)
// backend/services/<svc>/src/db.ts
import mongoose from "mongoose";
import { logger } from "../../shared/utils/logger";
import { config } from "./config";

export const connectDB = async () => {
try {
await mongoose.connect(config.mongoUri);
logger.info({ component: "mongodb" }, "[DB] Connected");
} catch (err) {
logger.error({ component: "mongodb", error: err instanceof Error ? err.message : String(err) }, "[DB] Connection error");
process.exit(1);
}
};

Health Router (shared)

Exposes /health, /healthz, /readyz.

Exports ReadinessFn type.

Gateway readiness may call upstream service /health and report status.

Logging & Audit Policy

Pino for runtime logs (stdout JSON): request entry, exit, errors. No DB writes from pino.

Audit logger (postAudit) for business events only; controllers push to req.audit[]; middleware flushes once on response finish.

logger.ts has: pino instance, extractLogContext, postAudit() (posts to LOG_SERVICE_URL), caller info normalization, and no env value defaults (env presence required; bootstrap ensures they’re set).

Env Policy

Dev: ENV_FILE optional, defaults to .env.dev at repo root.

Prod: ENV_FILE required. No hard-coded config values. No fallbacks for required keys.

Each service uses <SVC>\_-prefixed envs for clarity (e.g., ACT_PORT, ACT_MONGO_URI, ACT_SERVICE_NAME).

Testing Quickies (numeric ports)
curl -i http://localhost:4000/health # gateway
curl -i http://localhost:4000/readyz # gateway readiness (includes upstreams)
curl -i http://localhost:4001/health # act directly

What I’ll Ask For Each Time

Pre-existing files: “Paste <path> so I can merge.”

New service: “Confirm the domain name; I’ll drop full files for the template.”

Env layout: “Where is .env.dev located if not at repo root?”

We left off refactoring the backend. orchestrator was renamed gateway, and it is just gatekeeper and proxy. orchestrator-core was eliminated. The backend is tiered. The top tier is the gateway, the gateway can communicate with all services depending on need. the next tier is the business logic services that may need to call out to one or more entity services. The bottom tier, is the entity servcies which will usually have their own DB, or they proxy a 3rd party API. The bottom tier services to communicate directly with other services except for the logger.

index.ts files have import a bootstrap, to get logging working first.

That’s the blueprint. Paste this at the top of new sessions and we’ll stay locked on rails: identical services, audit-friendly, and investor-grade.
