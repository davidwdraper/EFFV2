// backend/services/gateway/src/proxy/health/healthResolveTarget.ts
/**
 * NowVibin (NV)
 * File: backend/services/gateway/src/proxy/health/healthResolveTarget.ts
 *
 * Docs / ADR:
 * - ADR-0033 (+ addendum): internalOnly services not mirrored to gateway
 * - ADR-0012: Gateway SvcConfig (contract + LKG fallback)
 * - SOP: health-first; gateway never exposes internal-only routes except health
 *
 * Purpose:
 * - For GET /api/<slug>/v<ver>/health[/token] when the target is missing from the
 *   gateway mirror (internalOnly), fetch facilitator's **svcconfig** using SvcClient,
 *   parse it with the **ServiceConfigRecord** contract, and return { baseUrl, port }.
 *
 * Contract:
 * - We only accept the established svcconfig shapes supported by the gateway loader:
 *   A) mirror object:        { mirror: { "<slug>@<ver>": ServiceConfigRecordJSON, ... } }
 *   B) envelope arrays:      { data: ServiceConfigRecordJSON[] } or { records: [...] }
 *   C) bare array:           ServiceConfigRecordJSON[]
 * - Each record is validated via ServiceConfigRecord; no ad-hoc heuristics.
 *
 * Env (required, no fallbacks):
 * - SVCFACILITATOR_BASE_URL              e.g., http://127.0.0.1:4015
 * Env (reused; same default as elsewhere in gateway):
 * - SVCFACILITATOR_CONFIG_PATH           default: /api/svcfacilitator/v1/svcconfig
 */

import { getLogger } from "@nv/shared/logger/Logger";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import { SvcClient } from "@nv/shared/svc/SvcClient";
import type { UrlResolver } from "@nv/shared";
import {
  ServiceConfigRecord,
  type ServiceConfigRecordJSON,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";

const log = getLogger().bind({
  slug: "gateway",
  version: 1,
  url: "/proxy/health/resolveTarget",
  component: "healthResolveTarget",
});

function requireNonEmptyEnv(name: string): string {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`${name} missing`);
  return v;
}

/** Derive the outbound API prefix from the facilitator config path (e.g., "/api"). */
function derivePrefixFromConfigPath(): string {
  const configPath = (
    process.env.SVCFACILITATOR_CONFIG_PATH || "/api/svcfacilitator/v1/svcconfig"
  ).trim();
  if (!configPath.startsWith("/")) {
    throw new Error("SVCFACILITATOR_CONFIG_PATH must start with '/'");
  }
  const anchor = "/svcfacilitator/";
  const idx = configPath.indexOf(anchor);
  if (idx <= 0) {
    throw new Error(
      "SVCFACILITATOR_CONFIG_PATH must contain '/svcfacilitator/' (e.g., /api/svcfacilitator/v1/svcconfig)"
    );
  }
  return configPath.slice(0, idx).replace(/\/+$/, "");
}

/**
 * Resolver returns "<origin><prefix>/svcfacilitator/v<ver>" so SvcClient.call({ path })
 * can use short tails like "/svcconfig".
 */
function facilitatorResolver(): UrlResolver {
  const base = requireNonEmptyEnv("SVCFACILITATOR_BASE_URL").replace(
    /\/+$/,
    ""
  );
  const prefix = derivePrefixFromConfigPath(); // e.g., "/api"
  return (slug: string, version?: number) => {
    if (slug !== "svcfacilitator") {
      throw new Error(
        `healthResolveTarget resolver only supports 'svcfacilitator', got '${slug}'`
      );
    }
    if (!version)
      throw new Error("version required for svcfacilitator resolve");
    return `${base}${prefix}/svcfacilitator/v${version}`;
  };
}

let _client: SvcClient | null = null;
function getFacilitatorClient(): SvcClient {
  if (_client) return _client;
  _client = new SvcClient(facilitatorResolver());
  return _client;
}

function inferPortFromBaseUrl(u: string): number {
  const url = new URL(u);
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

function isHealthSubpath(subpath: string): boolean {
  // Accept "/health" or "/health/<token>" (single token), optional trailing "/"
  const norm = subpath.replace(/\/+$/, "");
  return /^\/health(?:\/[A-Za-z0-9_-]+)?$/.test(norm);
}

/** Parse svcconfig payloads using the canonical contract; pick exactly <slug>@<version>. */
function selectRecordFromPayload(
  payload: unknown,
  slug: string,
  version: number
): ServiceConfigRecordJSON | null {
  const key = svcKey(slug, version);

  // C) bare array
  if (Array.isArray(payload)) {
    for (const raw of payload) {
      const rec = new ServiceConfigRecord(raw).toJSON();
      if (svcKey(rec.slug, rec.version) === key) return rec;
    }
    return null;
  }

  // A/B) object envelopes
  if (payload && typeof payload === "object") {
    const obj = payload as any;

    // A) mirror object
    if (obj.mirror && typeof obj.mirror === "object") {
      const raw = obj.mirror[key];
      if (!raw) return null;
      return new ServiceConfigRecord(raw).toJSON();
    }

    // B) arrays under "data" or "records"
    const arr = obj.data ?? obj.records;
    if (Array.isArray(arr)) {
      for (const raw of arr) {
        const rec = new ServiceConfigRecord(raw).toJSON();
        if (svcKey(rec.slug, rec.version) === key) return rec;
      }
      return null;
    }
  }

  return null;
}

export async function healthResolveTarget(
  requestPathWithQuery: string,
  method: string
): Promise<{ baseUrl: string; port: number } | null> {
  if (method.toUpperCase() !== "GET") return null;

  // Parse slug+version and ensure health route shape
  let slug: string,
    version: number,
    subpath = "/";
  try {
    const addr = UrlHelper.parseApiPath(requestPathWithQuery);
    slug = addr.slug;
    version = addr.version;
    subpath = addr.subpath || "/";
  } catch {
    return null;
  }
  if (!isHealthSubpath(subpath)) return null;

  // Call facilitator **svcconfig** endpoint using SvcClient (signed by default).
  // Resolver returns .../svcfacilitator/v1, so the tail is "/svcconfig".
  try {
    const client = getFacilitatorClient();
    const resp = await client.call({
      slug: "svcfacilitator",
      version: 1,
      method: "GET",
      path: "/svcconfig",
      headers: { accept: "application/json" },
      timeoutMs: 2000,
    });

    if (resp.status < 200 || resp.status >= 300) {
      log.warn("svcconfig_http_fail", { slug, version, status: resp.status });
      return null;
    }

    const body = (resp as any).body ?? (resp as any).data;
    const rec = selectRecordFromPayload(body, slug, version);
    if (!rec) {
      log.warn("svc_not_found_in_facilitator", { key: `${slug}@${version}` });
      return null;
    }

    // Validate invariants from contract
    if (!/^https?:\/\//.test(rec.baseUrl)) {
      log.warn("svc_invalid_baseurl_in_facilitator", {
        key: `${slug}@${version}`,
        baseUrl: rec.baseUrl,
      });
      return null;
    }

    const port = inferPortFromBaseUrl(rec.baseUrl);
    return { baseUrl: rec.baseUrl, port };
  } catch (err) {
    log.warn("resolve_error", { err: String(err) });
    return null;
  }
}
