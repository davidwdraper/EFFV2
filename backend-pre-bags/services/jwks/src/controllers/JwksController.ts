// backend/services/jwks/src/controllers/JwksController.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0017 — JWKS Service carve-out (policy/public route)
 * - ADR-0035 — JWKS via GCP KMS with TTL Cache
 *
 * Purpose:
 * - Thin controller that serves the raw JWKS payload.
 * - Retrieves key material via an injected IJwksProvider (DI), validates against the
 *   shared jwks.contract, and returns the JSON JWK Set with no NV envelope.
 *
 * Invariants:
 * - Single concern: handle GET /keys (public).
 * - No S2S auth/JWT validation — this is public key material only.
 * - Fail-fast on provider or schema errors; never return partial data.
 * - Response: application/json, exact RFC 7517 shape: { "keys": [...] }.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ControllerBase } from "@nv/shared/base/ControllerBase";
import type { IJwksProvider } from "../provider/IJwksProvider";
import { JwkSetSchema } from "@nv/shared/contracts/security/jwks.contract";

export class JwksController extends ControllerBase {
  constructor(private readonly provider: IJwksProvider) {
    super({ service: "jwks", context: { component: "JwksController" } });
  }

  /** GET /api/jwks/v1/keys — Return RFC 7517 JWK Set (raw, no NV envelope) */
  public keys(): RequestHandler {
    const log = this.bindLog({ route: "GET /keys" });

    return async (req: Request, res: Response, next: NextFunction) => {
      const requestId =
        (req.headers["x-request-id"] as string) ??
        (req.headers["x-correlation-id"] as string) ??
        (req.headers["request-id"] as string) ??
        "unknown";

      log.info({ requestId }, "jwks_keys_enter");

      try {
        // Fetch from injected provider (may be backed by JwksCache)
        const jwkSet = await this.provider.getJwks();

        // Validate outbound structure strictly to prevent drift
        const parsed = JwkSetSchema.parse(jwkSet);

        log.info({ requestId, keyCount: parsed.keys.length }, "jwks_keys_ok");

        // Return RAW JWK Set (NO NV envelope)
        res.status(200).type("application/json").send(parsed);
      } catch (err) {
        log.error({ requestId, err: String(err) }, "jwks_keys_error");
        next(err);
      }
    };
  }
}
