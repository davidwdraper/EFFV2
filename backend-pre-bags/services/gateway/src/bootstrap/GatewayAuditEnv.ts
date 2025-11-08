// backend/services/gateway/src/bootstrap/GatewayAuditEnv.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Typed, fail-fast env loader for gateway audit wiring.
 * - Centralizes guards so callers (app.ts) stay orchestration-only.
 *
 * Env (normalized — no "slug@version"):
 * - GATEWAY_AUDIT_WAL_DIR     (absolute path, required)
 * - AUDIT_SLUG                (e.g., "audit", required; lowercase slug)
 * - AUDIT_SLUG_VERSION        (e.g., "1", required; integer >= 1)
 * - GATEWAY_AUDIT_REPLAY_ON_BOOT ("true" | "false", default: true)
 */

import * as path from "node:path";
import EnvLoader from "@nv/shared/env/EnvLoader";

const SLUG_RE = /^[a-z][a-z0-9-]*$/;

export class GatewayAuditEnv {
  static read(): {
    WAL_DIR: string;
    AUDIT_SLUG: string;
    AUDIT_SLUG_VERSION: number;
    REPLAY_ON_BOOT: boolean;
  } {
    // Require absolute WAL dir (shared helper enforces existence/format)
    const walDir = EnvLoader.reqAbsPath("GATEWAY_AUDIT_WAL_DIR");
    if (!path.isAbsolute(walDir)) {
      throw new Error(
        `ENV: GATEWAY_AUDIT_WAL_DIR must be absolute (got: "${walDir}")`
      );
    }

    // Slug (normalized form, no "@<version>")
    const slug = (process.env.AUDIT_SLUG ?? "").trim();
    if (!slug) throw new Error("ENV: AUDIT_SLUG is required");
    if (!SLUG_RE.test(slug)) {
      throw new Error(
        `ENV: AUDIT_SLUG must match ${SLUG_RE.source} (got "${slug}")`
      );
    }

    // Version (separate variable; integer >= 1)
    const verRaw = (process.env.AUDIT_SLUG_VERSION ?? "").toString().trim();
    if (!verRaw) throw new Error("ENV: AUDIT_SLUG_VERSION is required");
    const ver = Number(verRaw);
    if (!Number.isInteger(ver) || ver < 1) {
      throw new Error(
        `ENV: AUDIT_SLUG_VERSION must be an integer >= 1 (got "${verRaw}")`
      );
    }

    // Replay flag (default true; empty = true)
    const replayRaw = (process.env.GATEWAY_AUDIT_REPLAY_ON_BOOT ?? "true")
      .toString()
      .trim();
    const replay =
      replayRaw === "" ? true : replayRaw.toLowerCase() !== "false";

    return {
      WAL_DIR: walDir,
      AUDIT_SLUG: slug,
      AUDIT_SLUG_VERSION: ver,
      REPLAY_ON_BOOT: replay,
    };
  }
}
