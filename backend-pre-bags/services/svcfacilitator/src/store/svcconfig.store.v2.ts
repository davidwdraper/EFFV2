// backend/services/svcfacilitator/src/store/svcconfig.store.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0002: svcfacilitator minimal (facilitator is source of truth)
 *
 * Purpose:
 * - In-memory source of truth for service base URLs keyed by slug@v<major>.
 * - Boot-time load from a simple source (env or JSON file). DB hook comes later.
 *
 * Contract (map shape):
 *   {
 *     "services": {
 *       "user": { "v1": { "baseUrl": "http://127.0.0.1:4020" } },
 *       "auth": { "v1": { "baseUrl": "http://127.0.0.1:4010" } }
 *     }
 *   }
 *
 * Load precedence:
 *   1) SVCCONFIG_JSON (env, whole JSON blob as above)
 *   2) ./svcconfig.local.json (service folder)
 *
 * Env (optional):
 *   - SVCCONFIG_JSON: inline JSON string for quick dev bring-up
 */

import fs from "fs";
import path from "path";

export type SvcConfigMap = {
  services?: {
    [slug: string]: {
      [vkey: string]: { baseUrl?: string };
    };
  };
};

export class SvcConfigStore {
  private static _map: SvcConfigMap = { services: {} };

  /** Initialize once at boot. Safe to call multiple times (idempotent). */
  static init(): void {
    // 1) Try env first
    const raw = (process.env.SVCCONFIG_JSON || "").trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SvcConfigMap;
        this._map = validate(parsed);
        return;
      } catch (e) {
        // fall through to file if env is bad
        console.error("[svcfacilitator] SVCCONFIG_JSON parse error:", e);
      }
    }

    // 2) Try local file
    const localFile = path.join(process.cwd(), "svcconfig.local.json");
    if (fs.existsSync(localFile)) {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(localFile, "utf8")
        ) as SvcConfigMap;
        this._map = validate(parsed);
        return;
      } catch (e) {
        console.error("[svcfacilitator] svcconfig.local.json parse error:", e);
      }
    }

    // Default empty map; callers will get 404 on unknown slugs.
    this._map = { services: {} };
  }

  /** Replace the whole map (e.g., after pulling from DB). */
  static set(map: SvcConfigMap): void {
    this._map = validate(map);
  }

  /** Return a snapshot of the current map. */
  static getMap(): SvcConfigMap {
    // shallow clone to avoid accidental mutation
    const m = this._map;
    return { services: { ...(m.services || {}) } };
  }

  /** Read baseUrl for a given slug and major version. */
  static getBaseUrl(slug: string, version: number): string | undefined {
    const vkey = `v${version}`;
    return this._map.services?.[slug]?.[vkey]?.baseUrl?.trim() || undefined;
  }
}

// ── helpers ─────────────────────────────────────────────────────────────

function validate(map: SvcConfigMap): SvcConfigMap {
  if (!map || typeof map !== "object") {
    throw new Error("SvcConfigStore: invalid map (not an object)");
  }
  if (map.services && typeof map.services !== "object") {
    throw new Error("SvcConfigStore: invalid services (not an object)");
  }
  // Light-touch validation; deep validation can be added later.
  return map;
}
