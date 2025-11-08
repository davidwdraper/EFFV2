// backend/shared/src/svc/types.ts
/**
 * Purpose:
 * - Minimal contracts for S2S calls and receivers (shared across services).
 */

export type SvcMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type UrlResolver = (
  slug: string,
  version?: number
) => string | Promise<string>;

export interface SvcCallOptions {
  slug: string;
  version?: number; // default: 1
  path: string; // e.g. "/mirror/load" or "/v1/users"
  method?: SvcMethod; // default: "GET"
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown; // JSON-serializable
  timeoutMs?: number; // default: 5000
  requestId?: string; // optional; auto-generated if missing
}

export interface SvcResponse<T = unknown> {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  data?: T;
  error?: { code: string; message: string };
  requestId: string;
}

// Minimal HTTP-like shapes so we don’t force Express typings in shared
export interface HttpLikeRequest {
  method?: string;
  url?: string;
  headers: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface HttpLikeResponse {
  status(code: number): this;
  setHeader(name: string, value: string): void;
  json(payload: unknown): void;
}
