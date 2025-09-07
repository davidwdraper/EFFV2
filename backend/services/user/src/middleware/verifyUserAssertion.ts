// backend/services/user/src/middleware/verifyUserAssertion.ts
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";

/**
 * Verifies an end-user assertion carried in X-NV-User-Assertion (or X-User-Assertion).
 * - Default behavior in dev: **non-enforcing** (passes through if header missing/invalid).
 * - Turn on enforcement by setting USER_ASSERTION_ENFORCE=true.
 *
 * Env:
 *   USER_ASSERTION_ENFORCE            → "true" to require the header (default: false)
 *   USER_ASSERTION_SECRET             → HS256 secret for verification
 *   USER_ASSERTION_AUDIENCE           → expected aud (optional; skipped if empty)
 *   USER_ASSERTION_ACCEPTED_ISSUERS   → comma list (default: "gateway")
 *   USER_ASSERTION_CLOCK_SKEW_SEC     → default 30
 */
export type VerifyOpts = { enforce?: boolean };

function truthy(v?: string) {
  return String(v ?? "").toLowerCase() === "true";
}

export function verifyUserAssertion(opts: VerifyOpts = {}): RequestHandler {
  const enforce =
    opts.enforce ?? truthy(process.env.USER_ASSERTION_ENFORCE || "false");

  const secret = process.env.USER_ASSERTION_SECRET || "";
  const audience = process.env.USER_ASSERTION_AUDIENCE || "";
  const clockSkew = Number(process.env.USER_ASSERTION_CLOCK_SKEW_SEC || 30);

  const acceptedIssuers = String(
    process.env.USER_ASSERTION_ACCEPTED_ISSUERS || "gateway"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  function problem(
    res: any,
    detail: string,
    status = 401,
    instance?: string | null
  ) {
    return res.status(status).json({
      type: "about:blank",
      title: status === 401 ? "Unauthorized" : "Forbidden",
      status,
      detail,
      instance: instance || null,
    });
  }

  return (req, res, next) => {
    const inst = (req as any).id || null;
    const hdr =
      req.headers["x-nv-user-assertion"] || req.headers["x-user-assertion"];
    const token = Array.isArray(hdr) ? hdr[0] : hdr;

    // No header provided
    if (!token) {
      if (!enforce) return next();
      return problem(res, "Missing X-NV-User-Assertion", 401, inst);
    }

    // If verifier not configured, treat as disabled unless enforcing
    if (!secret) {
      if (!enforce) return next();
      return problem(res, "User assertion verifier not configured", 500, inst);
    }

    const raw = token.startsWith("Bearer ")
      ? token.slice(7).trim()
      : String(token).trim();

    try {
      const decoded = jwt.verify(raw, secret, {
        algorithms: ["HS256"],
        audience: audience || undefined, // skip aud check if not set
        clockTolerance: clockSkew,
      }) as jwt.JwtPayload;

      const iss = String(decoded.iss || "");
      if (acceptedIssuers.length && !acceptedIssuers.includes(iss)) {
        if (!enforce) return next();
        return problem(res, `Invalid issuer: ${iss}`, 401, inst);
      }

      // Attach for downstream handlers
      (req as any).userAssertion = decoded;
      next();
    } catch (err: any) {
      if (!enforce) return next();
      return problem(
        res,
        `Invalid user assertion: ${err?.message || "verify failed"}`,
        401,
        inst
      );
    }
  };
}

export default verifyUserAssertion;
