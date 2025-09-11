// backend/services/shared/utils/s2s.ts
import crypto from "crypto";

function b64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function signInternalJwt(sub: string, svc: string, expSec = 300) {
  const secret = process.env.S2S_JWT_SECRET || "";
  const iss = process.env.S2S_JWT_ISSUER || "gateway-core";
  const aud = process.env.S2S_JWT_AUDIENCE || "internal-services";
  if (!secret) throw new Error("Missing S2S_JWT_SECRET");

  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub, iss, aud, iat: now, exp: now + expSec, svc };

  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const s = b64url(sig);

  return `${h}.${p}.${s}`;
}

/** Convenience for axios headers */
export function s2sAuthHeader(fromService: string) {
  return {
    Authorization: `Bearer ${signInternalJwt(fromService, fromService)}`,
  };
}
