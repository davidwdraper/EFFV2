import axios from "axios";
import jwt from "jsonwebtoken";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

// We call CORE, not Geo directly, to keep one ingress point.
// Uses the same S2S_* vars you already have in .env.dev.
const CORE_BASE_URL = requireEnv("GATEWAY_CORE_BASE_URL"); // e.g. http://127.0.0.1:4011
const S2S_JWT_SECRET = requireEnv("S2S_JWT_SECRET");
const S2S_JWT_ISSUER = requireEnv("S2S_JWT_ISSUER");
const S2S_JWT_AUDIENCE = requireEnv("S2S_JWT_AUDIENCE");

function mintS2S(ttlSec = 300): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: "s2s",
    iss: S2S_JWT_ISSUER,
    aud: S2S_JWT_AUDIENCE,
    iat: now,
    exp: now + ttlSec,
    scope: "geo:resolve",
    svc: "act",
  };
  return jwt.sign(payload, S2S_JWT_SECRET, { algorithm: "HS256" });
}

export type MailingAddress = {
  addr1?: string;
  addr2?: string;
  city?: string;
  state?: string;
  zip?: string;
};

export async function resolveMailingAddress(
  addr: MailingAddress
): Promise<{ lat: number; lng: number } | null> {
  const { addr1, city, state, zip } = addr || {};
  if (!addr1 || !city || !state || !zip) return null;

  const token = mintS2S(300);
  const r = await axios.post(
    `${CORE_BASE_URL}/api/geo/resolve`,
    { address: `${addr1}, ${city}, ${state} ${zip}` },
    {
      timeout: 2000,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    }
  );

  if (
    r.status >= 200 &&
    r.status < 300 &&
    r.data &&
    typeof r.data.lat === "number" &&
    typeof r.data.lng === "number"
  ) {
    return { lat: r.data.lat, lng: r.data.lng };
  }
  // Non-2xx or missing fields — treat as no result
  return null;
}
