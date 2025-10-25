// backend/services/shared/src/http/HandlerContext.ts
/**
 * NowVibin (NV)
 * Docs:
 * - ADR-0042 (HandlerContext Bus — KISS)
 *
 * Purpose:
 * - Minimal request-scoped bus: a key/value store shared across handlers.
 * - Built and seeded ONLY by ControllerBase; handlers read/write as needed.
 *
 * Notes:
 * - Keep keys disciplined to avoid collisions (e.g., "response.body", "error.code").
 * - No I/O, no logging here.
 */
export class HandlerContext {
  #store = new Map<string, unknown>();

  /** Get a value by key (typed) */
  public get<T>(key: string): T | undefined {
    return this.#store.get(key) as T | undefined;
  }

  /** Set/overwrite a value by key */
  public set<T>(key: string, value: T): void {
    this.#store.set(key, value);
  }

  /** Does a key exist? */
  public has(key: string): boolean {
    return this.#store.has(key);
  }

  /** Remove a key */
  public delete(key: string): void {
    this.#store.delete(key);
  }

  /** Debug snapshot (shallow copy) */
  public snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.#store.entries());
  }
}

/**
 * Conventional keys (recommended; not enforced). Keep these consistent across services.
 */
export const CtxKeys = Object.freeze({
  RequestId: "requestId",
  Headers: "headers",
  Params: "params",
  Query: "query",
  Body: "body",
  App: "app",

  // Controller response convention:
  ResStatus: "response.status", // number
  ResBody: "response.body", // unknown

  // Error convention (fail-fast short-circuit):
  ErrStatus: "error.status", // number
  ErrCode: "error.code", // string
  ErrDetail: "error.detail", // unknown
});
