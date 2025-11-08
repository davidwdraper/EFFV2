// backend/services/auth/src/controllers/auth.base.controller.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0004 (Auth Service Skeleton — no minting)
 *   - ADR-0007 (Non-gateway S2S via svcfacilitator + TTL cache) — via shared SvcClient
 *   - ADR-0014 (Base Hierarchy — ControllerBase extends ServiceBase)
 *
 * Purpose:
 * - Auth layer base controller.
 * - Extends shared ControllerBase (logger/env + ok/fail envelopes + handle()).
 * - Centralizes S2S calls to the User service for all auth actions.
 * - Provides a single normalization helper for upstream SvcResponse.
 */

import {
  ControllerBase,
  type HandlerResult,
} from "@nv/shared/base/ControllerBase";
import type { SvcResponse } from "@nv/shared/svc/types";
import { getSvcClient } from "@nv/shared/svc/client"; // no barrels/shims

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
   * Normalize any SvcResponse-like object to { status, body } for ControllerBase.handle().
   * - Accepts shapes like { status, body } or { status, data } or any.
   * - Falls back to 502 + the raw object if status/body missing.
   */
  protected fromUpstream<T = unknown>(
    upstream: SvcResponse<T> | unknown
  ): HandlerResult {
    const u = upstream as any;
    const status = typeof u?.status === "number" ? u.status : 502;
    const payload = u?.body ?? u?.data ?? u;
    return { status, body: payload };
  }

  /**
   * Generic call to the User service under an arbitrary subpath.
   * Use this for CRUD-y calls like "create" (PUT /create).
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
   * Canonical User S2S paths for auth (non-CRUD) actions:
   *   - signon         → POST /api/user/v{version}/signon
   *   - changepassword → POST /api/user/v{version}/changepassword
   * ("create" is handled via callUser("create", …, { method: "PUT" }))
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
    const method = (opts.method ?? "POST") as any;
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
