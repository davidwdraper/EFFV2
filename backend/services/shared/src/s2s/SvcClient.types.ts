// backend/services/shared/src/s2s/SvcClient.types.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - LDDs:
 *   - LDD-03 (envBootstrap & SvcClient)
 *   - LDD-12 (SvcClient & S2S Contract Architecture)
 *   - LDD-19 (S2S Protocol)
 *   - LDD-33 (Security & Hardening)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047 (DtoBag & Views)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire format)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *
 * Purpose:
 * - Shared types and contracts for SvcClient.
 * - Keeps the main SvcClient class file below god-file size and single-concern.
 */

import type { DtoBag } from "../dto/DtoBag";

export interface WireBagJson {
  items: unknown[];
  meta?: Record<string, unknown>;
}

/**
 * Result of resolving a target via svcconfig.
 *
 * This is intentionally abstracted away from svcconfig's concrete DTO shape.
 */
export interface SvcTarget {
  baseUrl: string; // e.g. "https://svc-env-dev.internal:8443"
  slug: string; // target slug ("env-service", "svcconfig", "auth", etc.)
  version: number; // major API version (1, 2, ...)
  isAuthorized: boolean; // whether the current caller may call this target
  reasonIfNotAuthorized?: string;
}

/**
 * svcconfig resolver abstraction.
 *
 * Implementations:
 * - Call svcconfig directly (using a plain HTTP client).
 * - Apply call-graph policy to determine isAuthorized.
 * - Special-case svcconfig itself to avoid recursion through SvcClient.
 */
export interface ISvcconfigResolver {
  resolveTarget(env: string, slug: string, version: number): Promise<SvcTarget>;
}

/**
 * KMS/JWT token factory abstraction (placeholder).
 *
 * Current behavior:
 * - Optional dependency: when not supplied, SvcClient omits the Authorization header.
 *
 * Future behavior:
 * - Will become mandatory once verifyS2S is fully enforced across workers.
 */
export interface IKmsTokenFactory {
  mintToken(input: {
    env: string;
    callerSlug: string;
    targetSlug: string;
    targetVersion: number;
  }): Promise<string>;
}

/**
 * Provides a requestId when one is not explicitly supplied.
 * Typically wired to the per-request context or a UUID generator.
 */
export type RequestIdProvider = () => string;

export interface SvcClientCallParams {
  env: string;
  slug: string; // target service slug
  version: number;
  dtoType: string;
  op: string;
  method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
  bag?: DtoBag<any>;
  pathSuffix?: string; // optional override for `<dtoType>/<op>`
  requestId?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Raw-body S2S call parameters (ADR-0066).
 *
 * Intended primarily for the gateway edge, where the JSON payload must be
 * treated as opaque and forwarded unchanged.
 *
 * For gateway:
 * - `fullPath` is the *entire* inbound path (starting with `/api/...`).
 * - SvcClient.callRaw() will simply swap the host/port via svcconfig and
 *   reuse this path as-is, avoiding any URL gymnastics.
 */
export interface SvcClientRawCallParams {
  env: string;
  slug: string; // target service slug
  version: number; // API major version (1, 2, ...)
  method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
  /**
   * Full inbound path including `/api`.
   * Example: `/api/auth/v1/auth/create`
   *
   * Gateway passes this directly; SvcClient only changes the origin
   * (scheme/host/port) based on svcconfig.
   */
  fullPath: string;
  body?: unknown; // unmodified JSON or string from caller
  requestId?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Raw response envelope for callRaw().
 *
 * NOTE:
 * - Does NOT interpret JSON.
 * - Callers decide how (and whether) to parse `bodyText`.
 */
export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
}

/**
 * Minimal logger interface used by SvcClient.
 * Implementations are expected to be backed by the shared logger util.
 */
export interface ISvcClientLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}
