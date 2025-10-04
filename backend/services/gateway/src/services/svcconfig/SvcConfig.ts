// backend/services/gateway/src/services/svcconfig/SvcConfig.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR0001 gateway svcconfig
 *   - ADR0003 gateway pushes mirror to svcfacilitator
 *
 * CHANGE SUMMARY:
 * - Add DI: setMirrorPusher()
 * - Push mirror after boot/LKG and after each DB refresh (poll/change).
 * - First push is mandatory: hard stop on failure.
 * - NEW: resolveFromApiPath() uses shared UrlHelper to parse /api/:slug/v#:tail
 * - NEW: getPortFromSlug() returns numeric port for a given slug@version
 *
 * Env:
 * - SVCCONFIG_LKG_PATH (optional; default: backend/services/gateway/var/svcconfig.lkg.json)
 * - SVCCONFIG_POLL_MS  (optional; default: 5000)
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { requireNumber, DbClient, createDbClientFromEnv } from "@nv/shared";
import type { ServiceConfigRecord } from "@nv/shared/contracts/ServiceConfig";
import type { SvcMirror, ServiceKey } from "./types";
import type { IMirrorPusher } from "./IMirrorPusher";
import { UrlHelper } from "@nv/shared/http/UrlHelper";
import { getLogger } from "@nv/shared/util/logger.provider";

export class SvcConfig {
  private readonly db: DbClient;
  private mirror: SvcMirror = {};
  private readonly lkgPath: string;
  private readonly pollMs: number;
  private usePolling = false;

  // NEW: pusher + first-push gate
  private mirrorPusher?: IMirrorPusher;
  private firstPushDone = false;

  // Bound logger for this background job (human one-liners)
  private readonly logBound = getLogger().bind({
    slug: "svcconfig",
    version: 1,
    url: "/svcconfig",
  });

  constructor(dbClient?: DbClient) {
    this.db = dbClient ?? createDbClientFromEnv({ prefix: "SVCCONFIG" });
    this.lkgPath =
      process.env.SVCCONFIG_LKG_PATH?.trim() ||
      "backend/services/gateway/var/svcconfig.lkg.json";
    const pollStr = process.env.SVCCONFIG_POLL_MS?.trim() || "5000";
    this.pollMs = requireNumber("SVCCONFIG_POLL_MS", pollStr);
  }

  /** DI: install a mirror pusher to notify downstreams. */
  public setMirrorPusher(p: IMirrorPusher): void {
    this.mirrorPusher = p;
  }

  /** Public: load mirror on boot, push to downstream, then start updates. */
  public async load(): Promise<void> {
    try {
      await this.refreshFromDb("boot"); // will push
      await this.startRealtimeUpdates();
    } catch (err) {
      this.error(
        "[svcconfig] DB load failed on boot; attempting .LKG fallback",
        {
          err: String(err),
        }
      );
      this.loadFromLkgOrDie(); // will push
      await this.tryStartPolling();
    }
  }

  public getUrlFromSlug(slug: string, version = 1): string {
    const key: ServiceKey = `${slug}@${version}`;
    const rec = this.mirror[key];
    if (!rec || !rec.enabled)
      throw new Error(`[svcconfig] Unknown or disabled service: ${key}`);
    return rec.baseUrl;
  }

  /**
   * NEW: Return the numeric TCP port for the service identified by slug@version.
   * - Parses the baseUrl; if the URL has an explicit port, return it.
   * - Otherwise, infer from protocol (https → 443, http → 80).
   */
  public getPortFromSlug(slug: string, version = 1): number {
    const baseUrl = this.getUrlFromSlug(slug, version);
    let u: URL;
    try {
      u = new URL(baseUrl);
    } catch {
      throw new Error(
        `[svcconfig] Invalid baseUrl for ${slug}@${version}: ${baseUrl}`
      );
    }
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  }

  public getMirror(): Readonly<SvcMirror> {
    return Object.freeze({ ...this.mirror });
  }

  /**
   * NEW: Resolve from an inbound API path (e.g., "/api/auth/v1/create?x=1").
   * - Parses slug/version/tail via shared UrlHelper.
   * - Looks up baseUrl from the in-memory mirror (source of truth).
   * - defaultVersion applies when the URL omits "/v#".
   */
  public resolveFromApiPath(
    pathWithQuery: string,
    defaultVersion = 1
  ): {
    slug: string;
    version: number;
    baseUrl: string;
    tail: string;
    query?: string;
  } {
    const addr = UrlHelper.parseApiPath(pathWithQuery);
    const version = addr.version ?? defaultVersion;
    const key: ServiceKey = `${addr.slug}@${version}`;
    const rec = this.mirror[key];
    if (!rec || !rec.enabled) {
      throw new Error(`[svcconfig] Unknown or disabled service: ${key}`);
    }
    // Normalize tail to always start with "/"
    const tail =
      addr.subpath && addr.subpath.startsWith("/")
        ? addr.subpath
        : `/${addr.subpath || ""}`;
    return {
      slug: addr.slug,
      version,
      baseUrl: rec.baseUrl,
      tail,
      query: addr.query,
    };
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private async refreshFromDb(
    reason: "boot" | "poll" | "change"
  ): Promise<void> {
    const coll: any = await this.db.getCollection<ServiceConfigRecord>(
      process.env.SVCCONFIG_COLLECTION?.trim() || "service_configs"
    );
    const docs: ServiceConfigRecord[] = await coll.find({}).toArray();

    const next: SvcMirror = {};
    for (const d of docs) {
      if (!d.slug || typeof d.version !== "number") continue;
      const key: ServiceKey = `${d.slug}@${d.version}`;
      next[key] = d;
    }
    this.mirror = next;
    this.writeLkg();

    const summary = Object.values(this.mirror).map((r) => ({
      slug: r.slug,
      version: r.version,
      baseUrl: r.baseUrl,
    }));

    await this.tryPush(reason); // push on every refresh
  }

  private async startRealtimeUpdates(): Promise<void> {
    try {
      const coll: any = await this.db.getCollection<ServiceConfigRecord>(
        process.env.SVCCONFIG_COLLECTION?.trim() || "service_configs"
      );
      const stream = coll.watch([], { fullDocument: "updateLookup" });
      stream.on("change", () => {
        this.refreshFromDb("change").catch((err) =>
          this.warn("[svcconfig] refresh after change failed", {
            err: String(err),
          })
        );
      });
      stream.on("error", async () => {
        this.info(
          "[svcconfig] change streams unavailable; switching to polling"
        );
        await this.tryStartPolling();
      });
      this.info("[svcconfig] change stream watching");
    } catch {
      this.info("[svcconfig] change streams not available; enabling polling");
      await this.tryStartPolling();
    }
  }

  private async tryStartPolling(): Promise<void> {
    if (this.usePolling) return;
    this.usePolling = true;
    this.info(`[svcconfig] polling every ${this.pollMs}ms`);
    const tick = async () => {
      try {
        await this.refreshFromDb("poll"); // will push
      } catch (err) {
        this.warn(
          "[svcconfig] polling refresh failed (keeping current mirror)",
          {
            err: String(err),
          }
        );
      } finally {
        setTimeout(tick, this.pollMs).unref();
      }
    };
    setTimeout(tick, this.pollMs).unref();
  }

  private writeLkg(): void {
    try {
      mkdirSync(dirname(this.lkgPath), { recursive: true });
      writeFileSync(this.lkgPath, JSON.stringify(this.mirror, null, 2), "utf8");
    } catch (err) {
      this.warn("[svcconfig] failed to write LKG", {
        err: String(err),
        lkgPath: this.lkgPath,
      });
    }
  }

  private loadFromLkgOrDie(): void {
    try {
      const raw = readFileSync(this.lkgPath, "utf8");
      this.mirror = JSON.parse(raw) as SvcMirror;
      this.info("[svcconfig] loaded mirror from LKG", {
        services: Object.keys(this.mirror).length,
        lkgPath: this.lkgPath,
      });
      void this.tryPush("boot"); // still enforce first-push
    } catch (err) {
      this.error("[svcconfig] no DB and no LKG; refusing to start", {
        err: String(err),
        lkgPath: this.lkgPath,
      });
      process.exit(1);
    }
  }

  private async tryPush(reason: "boot" | "poll" | "change"): Promise<void> {
    if (!this.mirrorPusher) return;
    const ok = await this.mirrorPusher.push(this.getMirror(), reason);
    if (!this.firstPushDone) {
      if (!ok) {
        this.error("[svcconfig] initial mirror push FAILED — hard stop");
        process.exit(1);
      }
      this.firstPushDone = true;
    }
  }

  // ── logging helpers (greenfield; no legacy numeric levels) ──────────────────

  private debug(msg: string, extra?: Record<string, unknown>): void {
    this.logBound.debug(formatTail(msg, extra));
  }
  private info(msg: string, extra?: Record<string, unknown>): void {
    this.logBound.info(formatTail(msg, extra));
  }
  private warn(msg: string, extra?: Record<string, unknown>): void {
    this.logBound.warn(formatTail(msg, extra));
  }
  private error(msg: string, extra?: Record<string, unknown>): void {
    this.logBound.error(formatTail(msg, extra));
  }
}

// format "<msg> - k=v k2=v2" when extra is provided
function formatTail(msg: string, extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) return msg;
  const tail = Object.entries(extra)
    .map(([k, v]) => `${k}=${stringify(v)}`)
    .join(" ");
  return `${msg} - ${tail}`;
}

function stringify(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
