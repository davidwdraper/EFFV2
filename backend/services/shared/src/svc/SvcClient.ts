// backend/services/shared/src/svc/SvcClient.ts
/**
 * Docs:
 * - Extends SvcClientBase with the injected URL resolver + defaults.
 * - Keep this thin so other clients can subclass or swap behaviors later.
 */

import type { UrlResolver, SvcCallOptions, SvcResponse } from "./types";
import { SvcClientBase } from "./SvcClientBase";

export class SvcClient extends SvcClientBase {
  constructor(
    resolveUrl: UrlResolver,
    defaults: { timeoutMs?: number; headers?: Record<string, string> } = {}
  ) {
    super(resolveUrl, defaults, { service: "shared" });
  }

  public override async call<T = unknown>(
    opts: SvcCallOptions
  ): Promise<SvcResponse<T>> {
    return super.call<T>(opts);
  }
}
