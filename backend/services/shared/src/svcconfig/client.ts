// backend/services/shared/src/svcconfig/client.ts
/**
 * NowVibin — Shared
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md
 * - ADRs:
 *   - docs/adr/0029-versioned-slug-routing-and-svcconfig.md
 *   - docs/adr/0033-centralized-env-loading-and-deferred-config.md
 *   - docs/adr/0034-centralized-discovery-dual-port-internal-jwks.md
 *
 * Purpose:
 * - Gateway: holds full in-memory mirror (canonical contract).
 * - Other services: resolve slugs via gateway internal (no full map).
 *
 * Notes:
 * - Authority currently emits a lean record (no policy/etag/configRevision).
 *   We transform it into the canonical gateway contract on ingest.
 * - No import-time env reads; read at call time.
 */

import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { z } from "zod";
import {
  SvcConfigSchema,
  type SvcConfig,
  type RoutePolicy,
  UserAssertionMode,
} from "../contracts/svcconfig.contract";
import { s2sAuthHeader } from "../utils/s2s/s2sAuthHeader";
import { logger } from "../utils/logger";

// ──────────────────────────────────────────────────────────────────────────────
// Types & schemas

// Matches what the authority returns today.
const AuthorityItemSchema = z.object({
  slug: z.string().min(1),
  version: z.number().int().min(1), // numeric in DB
  enabled: z.boolean(),
  allowProxy: z.boolean(),
  baseUrl: z.string().url(),
  outboundApiPrefix: z.string().min(1).default("/api"),
  healthPath: z.string().min(1).default("/health/live"),
  exposeHealth: z.boolean().default(true),
  protectedGetPrefixes: z.array(z.string()).default([]),
  publicPrefixes: z.array(z.string()).default([]),
  updatedAt: z.string().min(1).optional(), // ISO
  updatedBy: z.string().min(1).optional(),
  notes: z.string().optional(),
});

type AuthorityItem = z.infer<typeof AuthorityItemSchema>;

// ──────────────────────────────────────────────────────────────────────────────
// Snapshot state (gateway only)

export type SvcconfigSnapshot = {
  version: string; // monotonic counter as string
  updatedAt: number; // epoch ms
  services: Record<string, SvcConfig>; // keyed by slug (lowercase)
};

let SNAPSHOT: SvcconfigSnapshot | null = null;
let versionCounter = 0;
let inflight: Promise<void> | null = null;

// ──────────────────────────────────────────────────────────────────────────────
// Small utils

function need(name: string): string {
  const v = process.env[name];
  if (!v || !String(v).trim())
    throw new Error(`Missing required env var: ${name}`);
  return String(v).trim();
}
function maybe(name: string): string | undefined {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : undefined;
}
function join(base: string, seg: string): string {
  const b = base.replace(/\/+$/, "");
  const s = seg.startsWith("/") ? seg : `/${seg}`;
  return `${b}${s}`;
}
function versionLabel(v: number): string {
  if (!Number.isInteger(v) || v < 1) throw new Error(`Invalid version: ${v}`);
  return `V${v}`;
}
function normalizePrefix(prefix: string, apiPrefix: string): string {
  const a = apiPrefix.endsWith("/") ? apiPrefix.slice(0, -1) : apiPrefix;
  return prefix.startsWith("/") ? `${a}${prefix}` : `${a}/${prefix}`;
}

// Build a minimal, deterministic RoutePolicy from authority prefixes.
function synthesizePolicy(ai: AuthorityItem): RoutePolicy {
  const U = UserAssertionMode.enum;
  const rules = [];

  // Health (if exposed), GET-only and public.
  if (ai.exposeHealth) {
    rules.push({
      method: "GET",
      path: ai.healthPath,
      public: true,
      userAssertion: U.optional,
    });
  }

  // Public prefixes -> GET public
  for (const p of ai.publicPrefixes) {
    rules.push({
      method: "GET",
      path: normalizePrefix(p, ai.outboundApiPrefix),
      public: true,
      userAssertion: U.optional,
    });
  }

  // Protected GET prefixes -> GET protected
  for (const p of ai.protectedGetPrefixes) {
    rules.push({
      method: "GET",
      path: normalizePrefix(p, ai.outboundApiPrefix),
      public: false,
      userAssertion: U.required,
    });
  }

  return {
    revision: 1,
    defaults: {
      public: false,
      userAssertion: U.required,
    },
    rules,
  };
}

// Synthesize a stable etag from key fields (not cryptographic; just versioned).
function synthesizeEtag(ai: AuthorityItem): string {
  // slug|v|updatedAt|enabled|allowProxy
  const parts = [
    ai.slug.toLowerCase(),
    String(ai.version),
    ai.updatedAt ?? "na",
    ai.enabled ? "1" : "0",
    ai.allowProxy ? "1" : "0",
  ];
  return parts.join("|");
}

// Transform authority item -> canonical gateway SvcConfig
function toGatewayConfig(ai: AuthorityItem): SvcConfig {
  const base: SvcConfig = {
    slug: ai.slug.toLowerCase(),
    version: ai.version, // numeric in DB
    baseUrl: ai.baseUrl,
    outboundApiPrefix: ai.outboundApiPrefix || "/api",
    enabled: ai.enabled,
    allowProxy: ai.allowProxy,

    // Canonical fields required by the gateway contract:
    configRevision: 1, // greenfield default until authority supplies it
    policy: synthesizePolicy(ai),
    etag: synthesizeEtag(ai),

    updatedAt: ai.updatedAt ?? new Date().toISOString(),
  };

  // Validate against canonical contract (throws if we missed something)
  const parsed = SvcConfigSchema.parse(base);
  return parsed;
}

function repopulate(items: SvcConfig[]) {
  const services: Record<string, SvcConfig> = {};
  for (const it of items) services[it.slug.toLowerCase()] = it;
  versionCounter++;
  SNAPSHOT = {
    version: String(versionCounter),
    updatedAt: Date.now(),
    services,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Authority fetch (gateway only)

async function fetchAuthorityListTransformed(): Promise<SvcConfig[]> {
  const BASE =
    maybe("SVCCONFIG_AUTHORITY_BASE_URL") ?? need("SVCCONFIG_BASE_URL");
  const LIST = need("SVCCONFIG_LIST_PATH");
  const url = join(BASE, LIST);

  const r = await axios.get(url, {
    timeout: Number(process.env.SVCCONFIG_TIMEOUT_MS || 3000),
    headers: { ...s2sAuthHeader("svcconfig") },
    validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`svcconfig list failed: HTTP ${r.status}`);
  }

  const rawItems = Array.isArray(r.data?.items) ? r.data.items : [];
  const accepted: SvcConfig[] = [];
  const errors: any[] = [];
  let sampleRaw: any | undefined;

  for (const it of rawItems) {
    const aiP = AuthorityItemSchema.safeParse(it);
    if (!aiP.success) {
      errors.push(aiP.error?.issues?.[0]);
      if (!sampleRaw) {
        sampleRaw = Object.fromEntries(
          Object.entries(it || {}).map(([k, v]) => [k, typeof v])
        );
      }
      continue;
    }
    try {
      accepted.push(toGatewayConfig(aiP.data));
    } catch (e) {
      errors.push((e as Error).message);
      if (!sampleRaw) {
        const v = aiP.data;
        sampleRaw = Object.fromEntries(
          Object.entries(v).map(([k, val]) => [k, typeof val])
        );
      }
    }
  }

  logger.debug(
    {
      base: BASE,
      path: LIST,
      received: rawItems.length,
      accepted: accepted.length,
      sampleErr: errors[0],
      sampleRawTypes: sampleRaw,
    },
    "[svcconfigClient] authority parse/transform stats"
  );

  if (accepted.length === 0)
    throw new Error("svcconfig list contained 0 valid items");
  return accepted;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API — Gateway: full mirror

export async function startAuthorityMirror(): Promise<void> {
  if (inflight) return inflight; // idempotent
  inflight = (async () => {
    try {
      const items = await fetchAuthorityListTransformed();
      repopulate(items);
      logger.info(
        { count: Object.keys(SNAPSHOT!.services).length },
        "[svcconfigClient] snapshot populated from authority"
      );
    } catch (err) {
      logger.warn(
        { err: String(err) },
        "[svcconfigClient] authority fetch failed"
      );
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Back-compat alias for older callers
export const startSvcconfigMirror = startAuthorityMirror;

// Current snapshot (may be null before first successful fetch)
export function getSvcconfigSnapshot(): SvcconfigSnapshot | null {
  return SNAPSHOT;
}

export const svcconfigMirror = {
  current(): SvcconfigSnapshot | null {
    return SNAPSHOT;
  },
  baseUrlOf(slug: string): string | undefined {
    const s = SNAPSHOT?.services?.[String(slug || "").toLowerCase()];
    return s?.baseUrl;
  },
  get(slug: string): SvcConfig | undefined {
    return SNAPSHOT?.services?.[String(slug || "").toLowerCase()];
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// LKG helpers (gateway only)

export async function loadLKGSnapshot(lkgPathAbs: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(lkgPathAbs, "utf8");
    const json = JSON.parse(raw);
    const items = Object.values(json?.services ?? {});
    const parsed: SvcConfig[] = [];
    for (const it of items) {
      const p = SvcConfigSchema.safeParse(it);
      if (p.success)
        parsed.push({ ...p.data, slug: p.data.slug.toLowerCase() });
    }
    if (parsed.length === 0) throw new Error("LKG contained 0 valid items");
    repopulate(parsed);
    logger.info({ lkgPathAbs }, "[svcconfigClient] snapshot loaded from LKG");
    return true;
  } catch (err) {
    logger.warn(
      { lkgPathAbs, err: String(err) },
      "[svcconfigClient] LKG load failed"
    );
    return false;
  }
}

export async function saveLKGSnapshotIfFresh(
  lkgPathAbs: string
): Promise<void> {
  if (!SNAPSHOT) return;
  try {
    await fs.mkdir(path.dirname(lkgPathAbs), { recursive: true });
    await fs.writeFile(lkgPathAbs, JSON.stringify(SNAPSHOT, null, 2), "utf8");
  } catch (err) {
    logger.warn(
      { lkgPathAbs, err: String(err) },
      "[svcconfigClient] LKG save failed (non-fatal)"
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API — Leaf services: gateway-backed resolver (skinny; no full map)

export async function startGatewayBackedResolver(): Promise<void> {
  // no-op; resolution is lazy per call in httpClientBySlug
}

export async function resolveViaGateway(
  slug: string,
  version?: string
): Promise<SvcConfig> {
  const base = need("GATEWAY_INTERNAL_BASE_URL"); // e.g., http://127.0.0.1:4001
  const target = join(
    base,
    `/internal/svcconfig/resolve/${encodeURIComponent(slug)}${
      version ? `/${encodeURIComponent(versionLabel(Number(version)))}` : ""
    }`
  );
  const r = await axios.get(target, {
    timeout: Number(process.env.SVCCONFIG_TIMEOUT_MS || 3000),
    headers: { ...s2sAuthHeader("gateway") },
    validateStatus: () => true,
  });
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`gateway resolve failed: HTTP ${r.status}`);
  }
  const parsed = SvcConfigSchema.safeParse(r.data);
  if (!parsed.success)
    throw new Error("gateway resolve returned invalid SvcConfig");
  return { ...parsed.data, slug: parsed.data.slug.toLowerCase() };
}
