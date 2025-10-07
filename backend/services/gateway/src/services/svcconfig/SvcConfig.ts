// backend/services/gateway/src/services/svcconfig/SvcConfig.ts
/**
 * Docs / SOP
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR0001: Gateway-Embedded SvcConfig (mirror)
 * - ADR0003: Gateway <-> SvcFacilitator (mirror publish/consume)
 * - ADR-0012: Gateway SvcConfig (contract + LKG fallback via LkgStore)
 *
 * Purpose
 * - Maintain a contract-validated in-memory mirror keyed by <slug>@<version>.
 * - Load from svcfacilitator when available; otherwise fall back to LKG JSON.
 * - Provide strict lookups for URL/port/record; no silent v1 fallback.
 *
 * Env (read)
 * - SVCFACILITATOR_BASE_URL        e.g., http://127.0.0.1:4015
 * - SVCFACILITATOR_CONFIG_PATH     default: /api/svcfacilitator/v1/svcconfig
 * - GATEWAY_SVCCONFIG_LKG_PATH     optional JSON path for LKG snapshot
 */

import assert from "assert";
import { setTimeout as sleep } from "timers/promises";
import { getLogger } from "@nv/shared/util/logger.provider";
import {
  ServiceConfigRecord,
  type ServiceConfigRecordJSON,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";
import { GatewaySvcConfigLkgStore, type Mirror } from "./LkgStore";
import { SvcFacilitatorMirrorPusher } from "./SvcFacilitatorMirrorPusher";
import type { UrlResolver } from "@nv/shared";

export class SvcConfig {
  private readonly log = getLogger().bind({
    slug: "gateway",
    version: 1,
    url: "/svcconfig",
  });

  private readonly entries = new Map<string, ServiceConfigRecordJSON>();
  private readonly lkg = new GatewaySvcConfigLkgStore();

  constructor() {}

  // ------------------------------ Load / Refresh -----------------------------

  /**
   * Load/refresh the mirror from svcfacilitator.
   * - Tries facilitator with bounded retry.
   * - On failure, tries LKG JSON (if present).
   * - Persists a fresh LKG snapshot when facilitator succeeds.
   */
  public async load(): Promise<void> {
    this.entries.clear();

    const base = (process.env.SVCFACILITATOR_BASE_URL || "").trim();
    const pathSuffix = (
      process.env.SVCFACILITATOR_CONFIG_PATH ||
      "/api/svcfacilitator/v1/svcconfig"
    ).trim();

    // If facilitator base is missing, attempt LKG fallback (no hard exit here).
    if (!base) {
      this.log.warn("SVCFACILITATOR_BASE_URL missing; attempting LKG fallback");
      this.loadFromLkgOrThrow();
      return;
    }

    const url = this.join(base, pathSuffix);

    const maxAttempts = 5;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
        } as any);

        if (!resp.ok) {
          throw new Error(
            `HTTP ${resp.status} while fetching svcconfig from facilitator`
          );
        }

        const payload = (await resp.json()) as unknown;

        // Accept either:
        //  A) array of records: [{slug, version, baseUrl, enabled, ...}]
        //  B) envelope { ok, data: [...] } or { records: [...] }
        //  C) mirror object { mirror: { "slug@version": {...} } }
        let normalized: Mirror = {};

        if (Array.isArray(payload)) {
          normalized = this.fromArray(payload);
        } else if (payload && typeof payload === "object") {
          const maybeMirror = (payload as any).mirror;
          const maybeData = (payload as any).data ?? (payload as any).records;
          if (maybeMirror && typeof maybeMirror === "object") {
            normalized = this.fromMirrorObject(maybeMirror);
          } else if (Array.isArray(maybeData)) {
            normalized = this.fromArray(maybeData);
          } else {
            throw new Error("Unexpected facilitator payload shape");
          }
        } else {
          throw new Error("Unexpected facilitator payload type");
        }

        this.ingest(normalized);
        this.validateAll();

        // Best-effort LKG save
        this.lkg.saveMirror(normalized, { source: "facilitator" });

        this.log.info(
          `facilitator_load_success - entries=${this.entries.size}`
        );
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          this.log.warn(
            `facilitator_fetch_failed attempt=${attempt}/${maxAttempts} err=${String(
              err
            )}`
          );
          await sleep(250 * attempt);
          continue;
        }
      }
    }

    // Facilitator load failed, try LKG fallback
    this.log.warn(
      `facilitator_load_exhausted - attempting LKG fallback - err=${String(
        lastErr
      )}`
    );
    this.loadFromLkgOrThrow();
  }

  /**
   * Load only if empty; safe to call repeatedly by boot code.
   */
  public async ensureLoaded(): Promise<void> {
    if (this.entries.size > 0) return;
    await this.load();
  }

  // ------------------------------ Lookups -----------------------------------

  /** Contract-clean record for <slug>@<version>. Throws if missing or disabled. */
  public getRecord(slug: string, version: number): ServiceConfigRecordJSON {
    const key = svcKey(slug, version);
    const rec = this.entries.get(key);
    if (!rec) throw new Error(`[svcconfig] Unknown service: ${key}`);
    if (!rec.enabled) throw new Error(`[svcconfig] Service disabled: ${key}`);
    return rec;
  }

  /** Return base URL for <slug>@<version>. Throws if not found or disabled. */
  public getUrlFromSlug(slug: string, version: number): string {
    return this.getRecord(slug, version).baseUrl;
  }

  /** Return port parsed from base URL for <slug>@<version>. */
  public getPortFromSlug(slug: string, version: number): number {
    const rec = this.getRecord(slug, version);
    try {
      const u = new URL(rec.baseUrl);
      if (u.port) return Number(u.port);
      return u.protocol === "https:" ? 443 : 80;
    } catch {
      throw new Error(
        `[svcconfig] Invalid base URL for ${slug}@${version}: ${rec.baseUrl}`
      );
    }
  }

  // Diagnostics / helpers expected elsewhere
  public has(slug: string, version: number): boolean {
    return this.entries.has(svcKey(slug, version));
  }
  public debugKeys(): string[] {
    return Array.from(this.entries.keys());
  }
  /** New: simple counters for ready checks & diags */
  public count(): number {
    return this.entries.size;
  }
  public keys(): string[] {
    return Array.from(this.entries.keys());
  }
  /** Optional: raw snapshot for debug */
  public snapshot(): ServiceConfigRecordJSON[] {
    return Array.from(this.entries.values());
  }

  // ------------------------------ Internals ---------------------------------

  private ingest(mirror: Mirror): void {
    this.entries.clear();
    for (const [k, v] of Object.entries(mirror)) {
      const rec = new ServiceConfigRecord(v).toJSON();
      // defensive: ensure key matches content
      if (k !== svcKey(rec.slug, rec.version)) {
        throw new Error(`mirror key mismatch for '${k}'`);
      }
      this.entries.set(k, rec);
    }
  }

  private fromMirrorObject(obj: Record<string, unknown>): Mirror {
    const out: Mirror = {};
    for (const [k, v] of Object.entries(obj)) {
      const rec = new ServiceConfigRecord(v).toJSON();
      const key = svcKey(rec.slug, rec.version);
      if (k !== key) {
        throw new Error(`mirror key '${k}' does not match payload '${key}'`);
      }
      out[key] = rec;
    }
    return out;
  }

  private fromArray(arr: unknown[]): Mirror {
    const out: Mirror = {};
    for (const raw of arr) {
      const rec = new ServiceConfigRecord(raw).toJSON();
      out[svcKey(rec.slug, rec.version)] = rec;
    }
    return out;
  }

  private validateAll(): void {
    if (this.entries.size === 0) {
      throw new Error("mirror is empty after facilitator/LKG load");
    }
    for (const [key, e] of this.entries) {
      assert(
        e.slug && typeof e.slug === "string",
        `[svcconfig] bad slug for ${key}`
      );
      assert(Number.isFinite(e.version), `[svcconfig] bad version for ${key}`);
      assert(
        /^https?:\/\//.test(e.baseUrl),
        `[svcconfig] bad baseUrl for ${key}`
      );
      assert(
        e.enabled === true || e.enabled === false,
        `[svcconfig] enabled not boolean: ${key}`
      );
    }
  }

  private join(base: string, p: string): string {
    const a = base.replace(/\/+$/, "");
    const b = p.startsWith("/") ? p : `/${p}`;
    return `${a}${b}`;
  }

  private loadFromLkgOrThrow(): void {
    const snap = this.lkg.tryLoadMirror();
    if (!snap) {
      this.log.error("no_facilitator_no_lkg - cannot bootstrap svcconfig");
      throw new Error("svcconfig bootstrap failed (no facilitator and no LKG)");
    }
    this.ingest(snap);
    this.validateAll();
    this.log.info(`lkg_load_success - entries=${this.entries.size}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Singleton (exported here to keep imports simple & avoid extra barrels)
// ────────────────────────────────────────────────────────────────────────────

let _instance: SvcConfig | null = null;

/** Return the SvcConfig singleton (wires mirror pusher lazily on first access). */
export function getSvcConfig(): SvcConfig {
  if (_instance) return _instance;

  _instance = new SvcConfig();

  // Optional pusher wiring (non-breaking if SvcConfig later gains a setter)
  const resolver: UrlResolver = (slug, version) => {
    if (version == null) {
      throw new Error(
        `[svcconfig] Missing version for slug="${slug}". Expected /api/<slug>/v<major>/...`
      );
    }
    return _instance!.getUrlFromSlug(slug, version);
  };

  const pusher = new SvcFacilitatorMirrorPusher(resolver);
  const instAny = _instance as unknown as {
    setMirrorPusher?: (p: SvcFacilitatorMirrorPusher) => void;
  };
  if (typeof instAny.setMirrorPusher === "function") {
    instAny.setMirrorPusher(pusher);
  }

  return _instance;
}
