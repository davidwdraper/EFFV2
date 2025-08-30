// backend/services/gateway-core/src/middleware/verifyInternalJwt.ts
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

type JwtHeader = { alg?: string; typ?: string; [k: string]: unknown };
type JwtPayload = {
  sub?: string;
  iss?: string;
  aud?: string;
  exp?: number; // unix seconds
  nbf?: number;
  iat?: number;
  svc?: string; // caller service id
  [k: string]: unknown;
};

const AUD_EXPECT = process.env.S2S_JWT_AUDIENCE || "internal-services";
const SECRET = process.env.S2S_JWT_SECRET || "";
const ALLOWED_ISSUERS = (
  process.env.S2S_ALLOWED_ISSUERS || "gateway,gateway-core,internal"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_CALLERS = (process.env.S2S_ALLOWED_CALLERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean); // e.g. "act,place,reporter"
const MAX_TTL_SEC = Number(process.env.S2S_MAX_TTL_SEC || 120); // hard cap
const CLOCK_SKEW_SEC = Number(process.env.S2S_CLOCK_SKEW_SEC || 5); // small leeway

function b64urlToBuf(b64url: string): Buffer {
  const padLen = (4 - (b64url.length % 4 || 4)) % 4;
  const b64 = (b64url + "=".repeat(padLen))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}
function parseJson<T>(buf: Buffer): T {
  return JSON.parse(buf.toString("utf8")) as T;
}

export function verifyInternalJwt(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const log = (req as any).log || console;

  if (!SECRET) {
    log.error({ reason: "missing S2S_JWT_SECRET env" }, "s2s auth fail");
    return res.status(500).json({
      code: "SERVER_MISCONFIG",
      status: 500,
      message: "Missing S2S_JWT_SECRET",
    });
  }

  const auth = String(req.headers.authorization || "");
  const [scheme, token] = auth.split(" ");
  if (!token || scheme !== "Bearer") {
    log.warn({ reason: "missing/invalid auth scheme" }, "s2s auth fail");
    return res
      .status(401)
      .json({ code: "UNAUTHORIZED", status: 401, message: "Missing token" });
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    log.warn({ reason: "malformed token" }, "s2s auth fail");
    return res
      .status(401)
      .json({ code: "UNAUTHORIZED", status: 401, message: "Malformed token" });
  }
  const [h, p, s] = parts;

  // Decode and check header
  let header: JwtHeader;
  try {
    header = parseJson<JwtHeader>(b64urlToBuf(h));
  } catch {
    log.warn({ reason: "bad header decode" }, "s2s auth fail");
    return res
      .status(401)
      .json({ code: "UNAUTHORIZED", status: 401, message: "Bad token header" });
  }
  if (header.alg !== "HS256") {
    log.warn({ reason: "alg != HS256", alg: header.alg }, "s2s auth fail");
    return res
      .status(401)
      .json({ code: "UNAUTHORIZED", status: 401, message: "Unsupported alg" });
  }
  if (header.typ && header.typ !== "JWT") {
    log.warn({ reason: "typ != JWT", typ: header.typ }, "s2s auth fail");
    return res
      .status(401)
      .json({ code: "UNAUTHORIZED", status: 401, message: "Bad token typ" });
  }

  // Verify signature
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${h}.${p}`)
    .digest();
  const got = b64urlToBuf(s);
  if (
    expected.length !== got.length ||
    !crypto.timingSafeEqual(expected, got)
  ) {
    log.warn({ reason: "bad signature" }, "s2s auth fail");
    return res
      .status(401)
      .json({
        code: "UNAUTHORIZED",
        status: 401,
        message: "Invalid signature",
      });
  }

  // Decode payload
  let payload: JwtPayload;
  try {
    payload = parseJson<JwtPayload>(b64urlToBuf(p));
  } catch {
    log.warn({ reason: "bad payload decode" }, "s2s auth fail");
    return res
      .status(401)
      .json({
        code: "UNAUTHORIZED",
        status: 401,
        message: "Bad token payload",
      });
  }

  // Claims checks
  const now = Math.floor(Date.now() / 1000);
  const nbf = (payload.nbf ?? 0) - CLOCK_SKEW_SEC;
  const exp = (payload.exp ?? 0) + CLOCK_SKEW_SEC;
  const iat =
    payload.iat ?? (payload.exp ? payload.exp - MAX_TTL_SEC : undefined);

  if (!payload.aud || payload.aud !== AUD_EXPECT) {
    log.warn(
      { reason: "aud mismatch", aud_expect: AUD_EXPECT, aud_got: payload.aud },
      "s2s auth fail"
    );
    return res
      .status(401)
      .json({ code: "UNAUTHORIZED", status: 401, message: "Invalid audience" });
  }
  if (!payload.iss || !ALLOWED_ISSUERS.includes(payload.iss)) {
    log.warn(
      {
        reason: "issuer not allowed",
        iss_got: payload.iss,
        allowed: ALLOWED_ISSUERS,
      },
      "s2s auth fail"
    );
    return res
      .status(401)
      .json({ code: "UNAUTHORIZED", status: 401, message: "Bad issuer" });
  }
  if (!payload.svc) {
    log.warn({ reason: "missing svc" }, "s2s auth fail");
    return res
      .status(401)
      .json({ code: "UNAUTHORIZED", status: 401, message: "Missing caller" });
  }
  if (ALLOWED_CALLERS.length && !ALLOWED_CALLERS.includes(payload.svc)) {
    log.warn(
      {
        reason: "caller not allowed",
        svc: payload.svc,
        allowed: ALLOWED_CALLERS,
      },
      "s2s auth fail"
    );
    return res
      .status(403)
      .json({ code: "FORBIDDEN", status: 403, message: "Caller not allowed" });
  }
  if (!payload.exp || exp <= now) {
    log.warn({ reason: "expired", exp: payload.exp, now }, "s2s auth fail");
    return res
      .status(401)
      .json({ code: "UNAUTHORIZED", status: 401, message: "Token expired" });
  }
  if (nbf > now) {
    log.warn({ reason: "nbf > now", nbf: payload.nbf, now }, "s2s auth fail");
    return res
      .status(401)
      .json({
        code: "UNAUTHORIZED",
        status: 401,
        message: "Token not yet valid",
      });
  }
  if (iat && payload.exp && payload.exp - iat > MAX_TTL_SEC) {
    log.warn(
      {
        reason: "ttl too long",
        iat: payload.iat,
        exp: payload.exp,
        max: MAX_TTL_SEC,
      },
      "s2s auth fail"
    );
    return res
      .status(401)
      .json({
        code: "UNAUTHORIZED",
        status: 401,
        message: "Token TTL too long",
      });
  }

  // Success: stash claims
  (req as any).s2s = {
    sub: payload.sub,
    svc: payload.svc,
    iss: payload.iss,
    aud: payload.aud,
    iat: payload.iat,
    exp: payload.exp,
  };
  return next();
}
