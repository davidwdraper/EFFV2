"use strict";
// backend/services/shared/config/env.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnvFromFileOrThrow = loadEnvFromFileOrThrow;
exports.assertRequiredEnv = assertRequiredEnv;
exports.requireEnv = requireEnv;
exports.requireNumber = requireNumber;
exports.requireBoolean = requireBoolean;
exports.requireUrl = requireUrl;
exports.requireJson = requireJson;
exports.redactEnv = redactEnv;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const dotenv_expand_1 = __importDefault(require("dotenv-expand"));
/** Load a specific env file. Throws if the file is missing or invalid. */
function loadEnvFromFileOrThrow(envFilePath) {
    if (!envFilePath || envFilePath.trim() === "") {
        throw new Error("ENV_FILE is required but was not provided.");
    }
    const resolved = path_1.default.resolve(process.cwd(), envFilePath);
    if (!fs_1.default.existsSync(resolved)) {
        throw new Error(`ENV_FILE not found at: ${resolved}`);
    }
    const parsed = dotenv_1.default.config({ path: resolved });
    if (parsed.error) {
        throw new Error(`Failed to load ENV_FILE: ${resolved} — ${String(parsed.error)}`);
    }
    dotenv_expand_1.default.expand(parsed);
}
/** Assert required environment variables are present (non-empty). */
function assertRequiredEnv(keys) {
    const missing = [];
    for (const k of keys) {
        const v = process.env[k];
        if (!v || v.trim() === "")
            missing.push(k);
    }
    if (missing.length) {
        throw new Error(`Missing required env vars: ${missing.join(", ")}`);
    }
}
/** Require a non-empty env var; returns trimmed string. */
function requireEnv(name) {
    const v = process.env[name];
    if (!v || !v.trim())
        throw new Error(`Missing required env: ${name}`);
    return v.trim();
}
/** Require an env var that parses to a finite number. */
function requireNumber(name) {
    const v = requireEnv(name);
    const n = Number(v);
    if (!Number.isFinite(n))
        throw new Error(`Env ${name} must be a finite number`);
    return n;
}
/** Require a strict boolean (true/false only). */
function requireBoolean(name) {
    const v = requireEnv(name).toLowerCase();
    if (v !== "true" && v !== "false")
        throw new Error(`Env ${name} must be "true" or "false"`);
    return v === "true";
}
/** Require a valid absolute URL (http/https). */
function requireUrl(name) {
    const v = requireEnv(name);
    let u;
    try {
        u = new URL(v);
    }
    catch {
        throw new Error(`Env ${name} must be a valid URL`);
    }
    if (!/^https?:$/.test(u.protocol))
        throw new Error(`Env ${name} must be http or https URL`);
    return v;
}
/** Require JSON and parse it (throws on invalid). */
function requireJson(name) {
    const v = requireEnv(name);
    try {
        return JSON.parse(v);
    }
    catch {
        throw new Error(`Env ${name} must be valid JSON`);
    }
}
/** Redact helper for safe logging of env maps (keeps key names, hides values). */
function redactEnv(obj) {
    return Object.fromEntries(Object.keys(obj).map((k) => [k, "***redacted***"]));
}
