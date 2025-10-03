// backend/services/auth/src/controllers/auth.base.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *   - ADR-0007 (Non-gateway S2S via svcfacilitator + TTL cache) — handled inside shared SvcClient
 *
 * Purpose:
 * - Auth layer base controller.
 * - Extends shared BaseController for envelope handling.
 * - Provides a shared SvcClient (resolution/TTL cache happens inside SvcClient).
 *
 * Notes:
 * - NO facilitator logic here; services/controllers know nothing about it.
 * - Gateway remains the exception (injects its own resolver) — untouched.
 * - For all auth endpoints (create, signon, changePassword), the User service is called.
 */

// S2S slug for the downstream User service.
// Defining it here keeps the call sites clear and avoids scattering literals.
const S2S_USER_SLUG = "user";

import { BaseController } from "@nv/shared/controllers/base.controller";
import { SvcClient } from "@nv/shared";
import type { SvcResponse } from "@nv/shared/svc/types";

function getSvcName(): string {
  const name = process.env.SVC_NAME;
  if (!name || !name.trim()) {
    throw new Error("SVC_NAME is required but not set");
  }
  return name.trim();
}

let _client: SvcClient | null = null;

/** Lazy singleton SvcClient for this service. */
function getSvcClient(): SvcClient {
  if (_client) return _client;

  _client = new SvcClient(undefined as any, {
    timeoutMs: Number(process.env.S2S_TIMEOUT_MS ?? "5000") || 5000,
    headers: {
      "x-service-name": getSvcName(),
      accept: "application/json",
    },
  });

  return _client;
}

export abstract class AuthControllerBase extends BaseController {
  protected constructor() {
    super(getSvcName());
  }

  /** Shared SvcClient accessor. */
  protected get client(): SvcClient {
    return getSvcClient();
  }

  /**
   * Helper: call the User service under /api/user/v{version}/{subpath}
   * Default method = POST, version = 1.
   * Returns the raw SvcResponse so callers can pass it through unchanged.
   */
  protected callUser<TReq, TRes = unknown>(
    subpath: string,
    body: TReq,
    opts: {
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      version?: number;
      requestId?: string;
      headers?: Record<string, string>;
      query?: Record<string, string | number | boolean | undefined>;
    } = {}
  ): Promise<SvcResponse<TRes>> {
    const version = opts.version ?? 1;
    const path = `/api/${S2S_USER_SLUG}/v${version}/${subpath.replace(
      /^\/+/,
      ""
    )}`;

    return this.client.call<TRes>({
      slug: S2S_USER_SLUG,
      version,
      path,
      method: (opts.method ?? "POST") as any,
      requestId: opts.requestId,
      headers: { ...(opts.headers ?? {}) },
      query: opts.query,
      body,
    }) as unknown as Promise<SvcResponse<TRes>>;
  }
}
