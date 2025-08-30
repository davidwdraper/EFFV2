import crypto from "crypto";

function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Mint a short-lived HS256 S2S JWT as gateway-core */
export function mintS2S(opts?: {
  svc?: string;
  sub?: string;
  ttlSec?: number;
}) {
  const svc = opts?.svc ?? "gateway-core";
  const sub = opts?.sub ?? "s2s";
  const secret = (process.env.S2S_JWT_SECRET || "").trim();
  const aud = (process.env.S2S_JWT_AUDIENCE || "").trim();
  const iss = (process.env.S2S_JWT_ISSUER || "gateway-core").trim();
  if (!secret || !aud)
    throw new Error("Missing S2S_JWT_SECRET or S2S_JWT_AUDIENCE");

  const max = Number(process.env.S2S_MAX_TTL_SEC || 120) || 120;
  const ttl = Math.min(opts?.ttlSec ?? max, max);
  const exp = Math.floor(Date.now() / 1000) + ttl;

  const header = b64url('{"alg":"HS256","typ":"JWT"}');
  const payload = b64url(JSON.stringify({ sub, iss, aud, exp, svc }));
  const sig = b64url(
    crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
}
