// backend/services/shared/src/s2s/SvcClient.types.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *
 * Purpose:
 * - Central type contracts for SvcClient (DTO + Raw paths).
 *
 * Invariants:
 * - DTO path uses DtoBag-only wire envelopes.
 * - Raw path treats fullPath as opaque and identical to the inbound URL path
 *   (including /api prefix and querystring), with only host/port swapped.
 */

export type SvcTarget = {
  slug: string;
  version: number;
  baseUrl: string; // e.g. http://localhost:4015
  isAuthorized: boolean;
  reasonIfNotAuthorized?: string;
};

export type RawResponse = {
  status: number;
  bodyText: string;
  headers: Record<string, string>;
};

export type RequestIdProvider = () => string;

export type ISvcClientLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

export type ISvcconfigResolver = {
  resolveTarget: (
    env: string,
    slug: string,
    version: number
  ) => Promise<SvcTarget>;
};

export type IKmsTokenFactory = {
  mintToken: (params: {
    env: string;
    callerSlug: string;
    targetSlug: string;
    targetVersion: number;
  }) => Promise<string>;
};

export type ISvcClientTransport = {
  execute: (request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    requestId: string;
    targetSlug: string;
    logPrefix: string;
  }) => Promise<RawResponse>;
};

export type WireBagJson = { items: unknown[]; meta?: unknown };

export type SvcClientCallParams = {
  env: string;
  slug: string;
  version: number;
  dtoType: string;
  op: string;
  method: string;
  requestId?: string;
  timeoutMs?: number;
  /**
   * DTO wire bag envelope (DtoBag) — required for non-GETs except delete.
   * The actual DtoBag class lives outside shared/s2s types to avoid circular deps;
   * callers provide an object supporting toBody().
   */
  bag?: { toBody: () => unknown };
  /**
   * Optional explicit id (for read/update/delete); if omitted, SvcClient will attempt
   * to derive _id from the singleton DTO inside the bag.
   */
  id?: string;
  /**
   * Optional manual override for path suffix (advanced callers only).
   */
  pathSuffix?: string;
  /**
   * Extra headers for the outbound request (e.g., correlation or edge metadata).
   */
  extraHeaders?: Record<string, string>;
};

export type SvcClientRawCallParams = {
  env: string;
  slug: string;
  version: number;
  method: string;
  /**
   * Opaque inbound full path including `/api/...` and querystring.
   * Must start with `/api/`.
   */
  fullPath: string;
  requestId?: string;
  timeoutMs?: number;
  /**
   * Raw JSON/body pass-through. For non-GET, if not a string, it will be JSON.stringify()'d.
   */
  body?: unknown;
  /**
   * Extra headers to include on outbound request (after propagation headers).
   * Gateway uses this for stripped/normalized client headers.
   */
  extraHeaders?: Record<string, string>;
};
