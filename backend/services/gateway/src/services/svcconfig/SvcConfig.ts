// backend/services/gateway/src/services/svcconfig/SvcConfig.ts
/**
 * SvcConfig: loads and mirrors service-configs with LKG fallback.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  requireEnv,
  requireNumber,
  DbClient,
  createDbClientFromEnv,
} from "@nv/shared";
import type { ServiceConfigRecord } from "@nv/shared/contracts/ServiceConfig";
import type { SvcMirror, ServiceKey } from "./types";

export class SvcConfig {
  private readonly db: DbClient;
  private mirror: SvcMirror = {};
  private readonly lkgPath: string;
  private readonly pollMs: number;
  private usePolling = false;

  constructor(dbClient?: DbClient) {
    // Allow DI in tests; default to a client built from env (prefix-aware).
    // Looks for SVCCONFIG_DB_DRIVER/URI/NAME first, then generic DB_* then MONGO_*.
    this.db = dbClient ?? createDbClientFromEnv({ prefix: "SVCCONFIG" });

    this.lkgPath =
      process.env.SVCCONFIG_LKG_PATH?.trim() ||
      "backend/services/gateway/var/svcconfig.lkg.json";

    const pollStr = process.env.SVCCONFIG_POLL_MS?.trim() || "5000";
    this.pollMs = requireNumber("SVCCONFIG_POLL_MS", pollStr);
  }

  public async load(): Promise<void> {
    try {
      await this.refreshFromDb("boot");
      await this.startRealtimeUpdates();
    } catch (err) {
      this.log(
        50,
        "[svcconfig] DB load failed on boot; attempting .LKG fallback",
        { err: String(err) }
      );
      this.loadFromLkgOrDie();
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

  public getMirror(): Readonly<SvcMirror> {
    return Object.freeze({ ...this.mirror });
  }

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

    // ── New: info log of all slugs and URLs ────────────────────────────────
    const summary = Object.values(this.mirror).map((r) => ({
      slug: r.slug,
      version: r.version,
      baseUrl: r.baseUrl,
    }));
    this.log(30, `[svcconfig] mirror refreshed from DB (${reason})`, {
      services: Object.keys(this.mirror).length,
      routes: summary,
    });
  }

  private async startRealtimeUpdates(): Promise<void> {
    try {
      const coll: any = await this.db.getCollection<ServiceConfigRecord>(
        process.env.SVCCONFIG_COLLECTION?.trim() || "service_configs"
      );
      const stream = coll.watch([], { fullDocument: "updateLookup" });
      stream.on("change", () => {
        this.refreshFromDb("change").catch((err) =>
          this.log(40, "[svcconfig] refresh after change failed", {
            err: String(err),
          })
        );
      });
      stream.on("error", async (err: unknown) => {
        this.log(40, "[svcconfig] change stream error; switching to polling", {
          err: String(err),
        });
        await this.tryStartPolling();
      });
      this.log(20, "[svcconfig] change stream watching");
    } catch (err) {
      this.log(
        40,
        "[svcconfig] change streams not available; enabling polling",
        { err: String(err) }
      );
      await this.tryStartPolling();
    }
  }

  private async tryStartPolling(): Promise<void> {
    if (this.usePolling) return;
    this.usePolling = true;
    this.log(20, `[svcconfig] polling every ${this.pollMs}ms`);
    const tick = async () => {
      try {
        await this.refreshFromDb("poll");
      } catch (err) {
        this.log(
          40,
          "[svcconfig] polling refresh failed (keeping current mirror)",
          { err: String(err) }
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
      this.log(40, "[svcconfig] failed to write LKG", {
        err: String(err),
        lkgPath: this.lkgPath,
      });
    }
  }

  private loadFromLkgOrDie(): void {
    try {
      const raw = readFileSync(this.lkgPath, "utf8");
      this.mirror = JSON.parse(raw) as SvcMirror;
      this.log(30, "[svcconfig] loaded mirror from LKG", {
        services: Object.keys(this.mirror).length,
        lkgPath: this.lkgPath,
      });
    } catch (err) {
      this.log(50, "[svcconfig] no DB and no LKG; refusing to start", {
        err: String(err),
        lkgPath: this.lkgPath,
      });
      process.exit(1);
    }
  }

  private log(
    level: 20 | 30 | 40 | 50,
    msg: string,
    extra?: Record<string, unknown>
  ): void {
    console.log(
      JSON.stringify({ level, service: "gateway", msg, ...(extra || {}) })
    );
  }
}
