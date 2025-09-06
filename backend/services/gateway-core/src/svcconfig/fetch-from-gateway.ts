// backend/services/gateway-core/src/svcconfig/fetch-from-gateway.ts
import axios from "axios";
import fsp from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { ServiceConfig } from "@shared/contracts/svcconfig.contract";

// ─────────────────────────────────────────────────────────────────────────────
// Env (fail fast — core must not run with missing env)
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing required env: ${name}`);
  return String(v).trim();
}

const GATEWAY_BASE_URL = requireEnv("GATEWAY_BASE_URL"); // e.g., http://127.0.0.1:4000
const SVCCONFIG_INTERNAL_PATH = requireEnv("SVCCONFIG_INTERNAL_PATH"); // /__internal/svcconfig/services
const S2S_JWT_SECRET = requireEnv("S2S_JWT_SECRET");
const S2S_JWT_ISSUER = requireEnv("S2S_JWT_ISSUER"); // "gateway-core"
const S2S_JWT_AUDIENCE = requireEnv("S2S_JWT_AUDIENCE"); // "internal-services"

const LKG_PATH =
  process.env.SVCCONFIG_LKG_PATH ||
  path.resolve(__dirname, "../../.lkg/svcconfig.json");

export type SvcconfigSnapshot = {
  version: string; // ETag payload "v:<version>"
  updatedAt: number;
  services: Record<string, ServiceConfig>;
};

// ─────────────────────────────────────────────────────────────────────────────
// S2S: mint token with svc="gateway-core"
export function mintS2S(ttlSec = 300): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: "s2s",
      iss: S2S_JWT_ISSUER,
      aud: S2S_JWT_AUDIENCE,
      iat: now,
      exp: now + ttlSec,
      jti: randomUUID(),
      svc: "gateway-core",
    },
    S2S_JWT_SECRET,
    { algorithm: "HS256", noTimestamp: true }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
function joinUrl(base: string, suffix: string): string {
  const b = base.replace(/\/+$/, "");
  const s = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${b}${s}`;
}

export type FetchResult =
  | { kind: "ok"; snapshot: SvcconfigSnapshot; etag: string }
  | { kind: "not-modified"; etag: string | null }
  | { kind: "error"; status?: number; message: string };

// GET full dump (preferred)
export async function fetchFull(
  etag: string | null = null
): Promise<FetchResult> {
  try {
    const url = joinUrl(GATEWAY_BASE_URL, SVCCONFIG_INTERNAL_PATH);
    const token = mintS2S(300);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (etag) headers["If-None-Match"] = etag;

    const r = await axios.get(url, {
      timeout: 3000,
      validateStatus: () => true,
      headers,
    });

    if (r.status === 304) {
      // Not modified; ETag may or may not be echoed back
      const newEtag = (r.headers?.etag as string) || etag || null;
      return { kind: "not-modified", etag: newEtag };
    }

    if (r.status >= 200 && r.status < 300) {
      // Expect { ok, version, updatedAt, services }
      const data = r.data as any;
      if (
        data &&
        typeof data.version === "string" &&
        typeof data.updatedAt === "number" &&
        data.services &&
        typeof data.services === "object"
      ) {
        const snapshot: SvcconfigSnapshot = {
          version: data.version,
          updatedAt: data.updatedAt,
          services: data.services as Record<string, ServiceConfig>,
        };
        const newEtag =
          (r.headers?.etag as string) || `"v:${snapshot.version}"`;
        return { kind: "ok", snapshot, etag: newEtag };
      }
      return {
        kind: "error",
        status: r.status,
        message: "Invalid payload shape",
      };
    }

    return { kind: "error", status: r.status, message: `HTTP ${r.status}` };
  } catch (err: any) {
    return { kind: "error", message: err?.message || "network error" };
  }
}

// Optional: GET single slug (not used in boot, but handy for targeted refresh)
export async function fetchBySlug(
  slug: string,
  etag: string | null = null
): Promise<FetchResult> {
  try {
    const base = joinUrl(GATEWAY_BASE_URL, SVCCONFIG_INTERNAL_PATH);
    const url = joinUrl(base, `/` + encodeURIComponent(slug));
    const token = mintS2S(300);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (etag) headers["If-None-Match"] = etag;

    const r = await axios.get(url, {
      timeout: 3000,
      validateStatus: () => true,
      headers,
    });

    if (r.status === 304) {
      const newEtag = (r.headers?.etag as string) || etag || null;
      return { kind: "not-modified", etag: newEtag };
    }

    if (r.status >= 200 && r.status < 300) {
      const data = r.data as any;
      if (
        data &&
        typeof data.version === "string" &&
        typeof data.updatedAt === "number" &&
        data.service &&
        typeof data.service === "object"
      ) {
        const snapshot: SvcconfigSnapshot = {
          version: data.version,
          updatedAt: data.updatedAt,
          services: { [slug.toLowerCase()]: data.service as ServiceConfig },
        };
        const newEtag =
          (r.headers?.etag as string) || `"v:${snapshot.version}"`;
        return { kind: "ok", snapshot, etag: newEtag };
      }
      return {
        kind: "error",
        status: r.status,
        message: "Invalid payload shape",
      };
    }

    return { kind: "error", status: r.status, message: `HTTP ${r.status}` };
  } catch (err: any) {
    return { kind: "error", message: err?.message || "network error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LKG helpers (core can run from LKG if gateway is down)
export async function writeLKG(snapshot: SvcconfigSnapshot): Promise<void> {
  const dir = path.dirname(LKG_PATH);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    LKG_PATH,
    JSON.stringify({ v: 1, snapshot }, null, 2),
    "utf8"
  );
}

export async function readLKG(): Promise<SvcconfigSnapshot | null> {
  try {
    const raw = await fsp.readFile(LKG_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      v: number;
      snapshot: SvcconfigSnapshot;
    };
    if (parsed?.snapshot && typeof parsed.snapshot.version === "string") {
      return parsed.snapshot;
    }
    return null;
  } catch {
    return null;
  }
}
