// backend/services/auth/src/controllers/auth.base.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *   - ADR-0007 (Non-gateway S2S via svcfacilitator + TTL cache) — encapsulated inside shared SvcClient
 *   - ADR-0014 (Base Hierarchy: ServiceEntrypoint vs ServiceBase → ControllerBase)
 *
 * Purpose:
 * - Auth layer base controller.
 * - Extends shared ControllerBase (logger/env + ok/fail envelopes).
 * - Centralizes S2S calls to the User service for all auth actions.
 *
 * Notes:
 * - For ALL auth endpoints (create/signon/changepassword), the User service is called.
 * - Controllers have ZERO knowledge of svcfacilitator; shared SvcClient handles it.
 * - PATHS (aligned to User service):
 *     - Create user (CRUD):        PUT  /api/user/v1/create
 *     - Signon (non-CRUD):         POST /api/user/v1/signon
 *     - Change password (non-CRUD):POST /api/user/v1/changepassword
 *
 * Env (used):
 * - SVC_NAME        (recommended) service identity used in envelopes/headers
 * - S2S_TIMEOUT_MS  (optional) S2S HTTP timeout; default 5000 (applied in shared client)
 */

import { ControllerBase } from "@nv/shared/base/ControllerBase";
import type { SvcResponse } from "@nv/shared/svc/types";
import { getSvcClient } from "@nv/shared/svc/client"; // keep: no barrels/shims

// S2S target: always the User service for auth flows.
const S2S_SLUG = "user" as const;

export type AuthAction = "create" | "signon" | "changepassword";

export abstract class AuthControllerBase extends ControllerBase {
  protected constructor() {
    super({ service: (process.env.SVC_NAME ?? "").trim() || "auth" });
  }

  /** Shared SvcClient accessor (lazy singleton from shared; facilitator hidden). */
  protected get client() {
    return getSvcClient();
  }

  /**
   * Helper: Generic call to the User service under an arbitrary subpath.
   * Use this for CRUD-y calls like "create" (PUT /create).
   *
   * Example:
   *   await this.callUser("create", body, { method: "PUT", requestId });
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
    const path = `/api/${S2S_SLUG}/v${version}/${subpath.replace(/^\/+/, "")}`;

    return this.client.call<TRes>({
      slug: S2S_SLUG,
      version,
      path,
      method: (opts.method ?? "POST") as any,
      requestId: opts.requestId,
      headers: { accept: "application/json", ...(opts.headers ?? {}) },
      query: opts.query,
      body,
    }) as unknown as Promise<SvcResponse<TRes>>;
  }

  /**
   * Helper: Canonical User S2S paths for auth (non-CRUD) actions.
   *
   * Paths (fixed):
   *   - signon         → POST /api/user/v{version}/signon
   *   - changepassword → POST /api/user/v{version}/changepassword
   *
   * Note:
   *   - "create" is handled via callUser("create", …, { method: "PUT" })
   *     and NOT by this helper.
   */
  protected callUserAuth<TReq, TRes = unknown>(
    action: Extract<AuthAction, "signon" | "changepassword">,
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

    // Defaults for non-CRUD auth actions
    const defaults: Record<"signon" | "changepassword", "POST"> = {
      signon: "POST",
      changepassword: "POST",
    };
    const method = (opts.method ?? defaults[action]) as any;

    // No "/auth/" segment — paths are flat at the service root per SOP.
    const path = `/api/${S2S_SLUG}/v${version}/${action}`;

    return this.client.call<TRes>({
      slug: S2S_SLUG,
      version,
      path,
      method,
      requestId: opts.requestId,
      headers: { accept: "application/json", ...(opts.headers ?? {}) },
      query: opts.query,
      body,
    }) as unknown as Promise<SvcResponse<TRes>>;
  }
}
