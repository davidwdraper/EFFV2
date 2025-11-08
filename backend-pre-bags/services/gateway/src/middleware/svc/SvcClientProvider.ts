// backend/services/gateway/src/middleware/svc/SvcClientProvider.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0027 — SvcClient/SvcReceiver S2S Contract (baseline, pre-auth)
 *
 * Purpose:
 * - Publish a single slug-aware SvcClient instance on app.locals.svcClient.
 * - Idempotent: constructs once, reuses thereafter.
 *
 * Notes:
 * - This is orchestration glue only. No URLs or envs here.
 * - The provided factory must return your real SvcClient which implements .call(opts).
 */

import type { Request, Response, NextFunction } from "express";

// Duck-typed to your shared/src/svc/types.ts SvcCallOptions/SvcResponse
type SvcCallOptions = {
  slug: string;
  version?: number;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  requestId?: string;
};

type SvcResponse<T = unknown> = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  data?: T;
  error?: { code: string; message: string };
  requestId: string;
};

export interface SvcClientLike {
  call<T = unknown>(opts: SvcCallOptions): Promise<SvcResponse<T>>;
}

export type SvcClientFactory = () => SvcClientLike;

export function svcClientProvider(build: SvcClientFactory) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const appAny: any = res.app;
    if (!appAny.locals) appAny.locals = {};
    if (!appAny.locals.svcClient) {
      appAny.locals.svcClient = build(); // construct once per process
    }
    next();
  };
}
