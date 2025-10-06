// backend/services/gateway/src/services/svcconfig/LkgStore.ts
/**
 * Docs:
 * - SOP: Gateway keeps a Last-Known-Good (LKG) svcconfig mirror to survive facilitator outages.
 * - ADR-0012: Gateway SvcConfig (contract + LKG fallback)
 *
 * Purpose:
 * - Gateway-specific LKG store with explicit env resolution, path logging, and safe R/W.
 *
 * Env precedence (service-local overrides root; final override is ENV_FILE-based loader):
 * - 1) GATEWAY_SVCCONFIG_LKG_PATH
 * - 2) SVCCONFIG_LKG_PATH
 *
 * Snapshot shape:
 * {
 *   "savedAt": "<ISO>",
 *   "meta": { ... optional },
 *   "mirror": {
 *     "<slug>@<version>": { ...ServiceConfigRecordJSON }
 *   }
 * }
 */

import fs from "fs";
import path from "path";
import os from "os";
import { getLogger } from "@nv/shared/util/logger.provider";
import { EnvLoader } from "@nv/shared/env/EnvLoader";
import type { ServiceConfigRecordJSON } from "@nv/shared/contracts/svcconfig.contract";
import {
  ServiceConfigRecord,
  svcKey,
} from "@nv/shared/contracts/svcconfig.contract";

export type Mirror = Record<string, ServiceConfigRecordJSON>;

const log = getLogger().bind({
  slug: "gateway",
  version: 1,
  url: "/svcconfig/lkg",
});

// ────────────────────────────────────────────────────────────────────────────
// Mirror normalization / validation
// ────────────────────────────────────────────────────────────────────────────

function normalizeMirror(input: unknown): Mirror {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("mirror: expected object");
  }
  const out: Mirror = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const rec = new ServiceConfigRecord(v).toJSON();
    const key = svcKey(rec.slug, rec.version);
    if (k !== key) {
      throw new Error(
        `mirror key mismatch: file has "${k}" but payload is "${key}"`
      );
    }
    out[key] = rec;
  }
  return out;
}

function validateMirror(m: Mirror): void {
  for (const [k, rec] of Object.entries(m)) {
    if (!/^https?:\/\//.test(rec.baseUrl)) {
      throw new Error(`mirror invalid baseUrl for ${k}`);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Path resolution & filesystem helpers
// ────────────────────────────────────────────────────────────────────────────

function resolveLkgPath(): { envKey: string; absolutePath: string } {
  // Precedence: gateway-specific → shared
  const keys = ["GATEWAY_SVCCONFIG_LKG_PATH", "SVCCONFIG_LKG_PATH"] as const;
  let chosenKey: string | null = null;
  let raw: string | null = null;

  for (const k of keys) {
    const v = (process.env[k] || "").trim();
    if (v) {
      chosenKey = k;
      raw = v;
      break;
    }
  }

  if (!chosenKey || !raw) {
    const detail = {
      tried: keys,
      present: keys.map((k) => Boolean(process.env[k])),
    };
    throw new Error(
      `LKG path env not set (expected one of ${keys.join(
        ", "
      )}) - detail=${JSON.stringify(detail)}`
    );
  }

  const base = (EnvLoader as any).findRepoRoot?.() ?? process.cwd();
  const absolutePath = path.isAbsolute(raw) ? raw : path.join(base, raw);

  return { envKey: chosenKey, absolutePath };
}

function ensureFileExists(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    const payload = JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        meta: { host: os.hostname() },
        mirror: {},
      },
      null,
      2
    );
    const tmp = path.join(
      dir,
      `.gateway-lkg.${Date.now()}.${process.pid}.${Math.random()
        .toString(36)
        .slice(2)}.tmp`
    );
    fs.writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, filePath);
    try {
      const dfd = fs.openSync(dir, "r");
      fs.fsyncSync(dfd);
      fs.closeSync(dfd);
    } catch {
      /* best-effort */
    }
    log.debug(
      `GWY630 lkg_created ${JSON.stringify({
        path: filePath,
        reason: "auto_seed_empty",
      })}`
    );
  }
}

function readJson(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`LKG parse error: ${String(e)} (${filePath})`);
  }
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.gateway-lkg.${Date.now()}.${process.pid}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`
  );
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(tmp, filePath);
  try {
    const dfd = fs.openSync(dir, "r");
    fs.fsyncSync(dfd);
    fs.closeSync(dfd);
  } catch {
    /* best-effort */
  }
}

// ────────────────────────────────────────────────────────────────────────────
// GatewaySvcConfigLkgStore (self-contained; no base class dependency)
// ────────────────────────────────────────────────────────────────────────────

export class GatewaySvcConfigLkgStore {
  private readonly pathInfo: { envKey: string; absolutePath: string };

  constructor(opts?: { path?: string }) {
    if (opts?.path) {
      const absolutePath = path.isAbsolute(opts.path)
        ? opts.path
        : path.join(
            (EnvLoader as any).findRepoRoot?.() ?? process.cwd(),
            opts.path
          );
      this.pathInfo = { envKey: "<inline_path>", absolutePath };
    } else {
      this.pathInfo = resolveLkgPath();
    }

    log.debug(
      `GWY600 lkg_path_resolved ${JSON.stringify({
        envKey: this.pathInfo.envKey,
        path: this.pathInfo.absolutePath,
      })}`
    );

    // Ensure directory+file exist (empty envelope) so reads never crash.
    try {
      ensureFileExists(this.pathInfo.absolutePath);
      const st = fs.statSync(this.pathInfo.absolutePath);
      log.debug(
        `GWY610 lkg_ready ${JSON.stringify({
          path: this.pathInfo.absolutePath,
          mtime: st.mtime.toISOString(),
        })}`
      );
    } catch (e) {
      log.error(
        `GWY620 lkg_init_fail ${JSON.stringify({
          path: this.pathInfo.absolutePath,
          error: String(e),
        })}`
      );
      // Don't throw here; callers can still attempt to load and fail-fast later.
    }
  }

  public tryLoadMirror(): Mirror | null {
    try {
      const obj = readJson(this.pathInfo.absolutePath) as any;
      const normalized = normalizeMirror(obj?.mirror);
      validateMirror(normalized);
      const count = Object.keys(normalized).length;
      log.debug(
        `GWY640 lkg_load_ok ${JSON.stringify({
          path: this.pathInfo.absolutePath,
          count,
        })}`
      );
      return normalized;
    } catch (e) {
      log.warn(
        `GWY621 lkg_load_fail ${JSON.stringify({
          path: this.pathInfo.absolutePath,
          error: String(e),
        })}`
      );
      return null;
    }
  }

  public loadMirror(): Mirror {
    const m = this.tryLoadMirror();
    if (!m) {
      throw new Error(
        `LKG missing or invalid at ${this.pathInfo.absolutePath} (env=${this.pathInfo.envKey})`
      );
    }
    return m;
  }

  public saveMirror(mirror: Mirror, meta?: Record<string, unknown>): void {
    const payload = {
      savedAt: new Date().toISOString(),
      meta: { host: os.hostname(), ...(meta ?? {}) },
      mirror,
    };
    try {
      writeJsonAtomic(this.pathInfo.absolutePath, payload);
      log.debug(
        `GWY630 lkg_write_ok ${JSON.stringify({
          path: this.pathInfo.absolutePath,
          count: Object.keys(mirror).length,
        })}`
      );
    } catch (e) {
      log.warn(
        `GWY631 lkg_write_fail ${JSON.stringify({
          path: this.pathInfo.absolutePath,
          error: String(e),
        })}`
      );
    }
  }

  // Useful for diagnostics if needed.
  public getResolvedPath(): string {
    return this.pathInfo.absolutePath;
  }
  public getEnvKey(): string {
    return this.pathInfo.envKey;
  }
}
