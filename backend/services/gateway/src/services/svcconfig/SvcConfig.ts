// backend/services/gateway/src/services/svcconfig/SvcConfig.ts
/**
 * Docs / SOP
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR0001: Gateway-Embedded SvcConfig (mirror)
 * - ADR0003: Gateway <-> SvcFacilitator (mirror publish/consume)
 *
 * Purpose
 * - Maintain an in-memory mirror of service endpoints keyed by <slug>@<version>.
 * - Load strictly from the svcFacilitator (not per-service env).
 * - Provide strict lookups for URL/port; no silent v1 fallback.
 *
 * Boot Contract
 * - Require SVCFACILITATOR_BASE_URL
 * - GET {SVCFACILITATOR_BASE_URL}{SVCFACILITATOR_CONFIG_PATH}
 *     Default path: /api/svcfacilitator/v1/svcconfig
 *   Response must be an array of records: { slug, version, baseUrl, enabled }
 *
 * Routing Policy (current)
 * - All proxied routes are VERSIONED (incl. health): /api/<slug>/v<major>/...
 */

import assert from "assert";
import { setTimeout as sleep } from "timers/promises";
// If you already export this type from shared, feel free to swap this local copy.
export interface ServiceConfigRecord {
  slug: string;
  version: number;
  baseUrl: string;
  enabled: boolean;
}

export interface SvcEntry extends ServiceConfigRecord {}

export class SvcConfig {
  private readonly entries = new Map<string, SvcEntry>();

  constructor() {}

  // ------------------------------ Load / Refresh -----------------------------

  /**
   * Load/refresh the mirror from svcFacilitator.
   * Will retry a few times on transient startup races.
   */
  public async load(): Promise<void> {
    this.entries.clear();

    const base = (process.env.SVCFACILITATOR_BASE_URL || "").trim();
    if (!base) {
      // Hard stop per SOP — gateway can’t run without facilitator bootstrap
      // eslint-disable-next-line no-console
      console.error(
        "❌ [svcconfig] SVCFACILITATOR_BASE_URL is required but not set"
      );
      process.exit(1);
    }
    const path = (
      process.env.SVCFACILITATOR_CONFIG_PATH ||
      "/api/svcfacilitator/v1/svcconfig"
    ).trim();

    const url = this.join(base, path);

    // Simple, bounded retry to handle “facilitator not quite up yet”
    const maxAttempts = 5;
    let lastErr: unknown = undefined;

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

        const data = (await resp.json()) as unknown;

        // Expect either a direct array, or an envelope with { ok, data: [...] }
        const records: unknown = Array.isArray(data)
          ? data
          : (data as any)?.data ?? (data as any)?.records;

        if (!Array.isArray(records)) {
          throw new Error("Unexpected facilitator payload (no records array)");
        }

        let loaded = 0;
        for (const raw of records) {
          const rec = this.toSvcEntry(raw);
          if (!rec) continue;
          const key = this.key(rec.slug, rec.version);
          this.entries.set(key, rec);
          loaded++;
        }

        if (loaded === 0) {
          throw new Error("facilitator returned 0 usable records");
        }

        // All good
        this.validateAll();
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          // eslint-disable-next-line no-console
          console.warn(
            `[svcconfig] facilitator fetch failed (attempt ${attempt}/${maxAttempts}): ${String(
              err
            )}`
          );
          await sleep(250 * attempt); // backoff a bit
          continue;
        }
      }
    }

    // eslint-disable-next-line no-console
    console.error(
      `❌ [svcconfig] failed to load mirror from facilitator: ${String(
        lastErr
      )}`
    );
    process.exit(1);
  }

  // ------------------------------ Lookups -----------------------------------

  /** Return base URL for <slug>@<version>. Throws if not found or disabled. */
  public getUrlFromSlug(slug: string, version: number): string {
    const key = this.key(slug, version);
    const entry = this.entries.get(key);
    if (!entry)
      throw new Error(`[svcconfig] Unknown or disabled service: ${key}`);
    if (!entry.enabled) throw new Error(`[svcconfig] Service disabled: ${key}`);
    return entry.baseUrl;
  }

  /** Return port parsed from base URL for <slug>@<version>. */
  public getPortFromSlug(slug: string, version: number): number {
    const baseUrl = this.getUrlFromSlug(slug, version);
    try {
      const u = new URL(baseUrl);
      if (u.port) return Number(u.port);
      return u.protocol === "https:" ? 443 : 80;
    } catch {
      throw new Error(
        `[svcconfig] Invalid base URL for ${slug}@${version}: ${baseUrl}`
      );
    }
  }

  // Diagnostics
  public has(slug: string, version: number): boolean {
    return this.entries.has(this.key(slug, version));
  }
  public debugKeys(): string[] {
    return Array.from(this.entries.keys());
  }
  public snapshot(): SvcEntry[] {
    return Array.from(this.entries.values());
  }

  // ------------------------------ Internals ---------------------------------

  private key(slug: string, version: number): string {
    return `${slug}@${version}`;
  }

  private toSvcEntry(raw: any): SvcEntry | null {
    const slug = String(raw?.slug ?? "").trim();
    const version = Number(raw?.version);
    const baseUrl = String(raw?.baseUrl ?? "").trim();
    const enabled = Boolean(raw?.enabled);

    if (!slug || !Number.isFinite(version) || !/^https?:\/\//.test(baseUrl)) {
      return null;
    }
    return { slug, version, baseUrl, enabled };
  }

  private validateAll(): void {
    if (this.entries.size === 0) {
      throw new Error("mirror is empty after facilitator load");
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
      assert(e.enabled === true, `[svcconfig] service disabled: ${key}`);
    }
  }

  private join(base: string, path: string): string {
    const a = base.replace(/\/+$/, "");
    const b = path.startsWith("/") ? path : `/${path}`;
    return `${a}${b}`;
  }
}
