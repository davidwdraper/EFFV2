// backend/services/jwks/src/controllers/JwksController.ts
/**
 * NowVibin (NV)
 * File: backend/services/jwks/src/controllers/JwksController.ts
 *
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0034 — JWKS Service via GCP KMS, discovered by SvcFacilitator (internalOnly=true)
 *
 * Purpose:
 * - Thin controller that serves the raw JWKS payload.
 * - Retrieves key material from the configured provider (via factory),
 *   validates via shared jwks.contract, and returns the JSON set.
 *
 * Invariants:
 * - **Single concern:** handle the /keys route (GET).
 * - No S2S auth or JWT validation required — this is public key material only.
 * - Fail-fast on provider or schema errors; never return partial data.
 * - Response must be `application/json` with RFC-7517 compliant `{ "keys": [...] }`.
 */

import type { Request, Response, NextFunction } from "express";
import { getLogger } from "@nv/shared/logger/Logger";
import { JwkSetSchema } from "@nv/shared/contracts/security/jwks.contract";
import { JwksProviderFactory } from "../provider/JwksProviderFactory";

export class JwksController {
  private readonly log = getLogger().bind({
    service: "jwks",
    component: "JwksController",
  });

  /** GET /api/jwks/v1/keys — Return RFC 7517 JWK Set */
  keys() {
    return async (_req: Request, res: Response, next: NextFunction) => {
      const requestId = _req.headers["x-request-id"] ?? "unknown";
      const ctx = { requestId, route: "GET /keys" };
      this.log.info(ctx, "jwks_keys_enter");

      try {
        const provider = JwksProviderFactory.create();
        const jwkSet = await provider.getJwks();
        const parsed = JwkSetSchema.parse(jwkSet); // validate structure

        this.log.info(
          { ...ctx, keyCount: parsed.keys.length },
          "jwks_keys_success"
        );
        res.status(200).type("application/json").send(parsed);
      } catch (err) {
        const e =
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : { message: String(err) };
        this.log.error({ ...ctx, err: e }, "jwks_keys_failed");
        return next(err);
      }
    };
  }
}
