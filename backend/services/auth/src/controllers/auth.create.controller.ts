// backend/services/auth/src/controllers/auth.create.controller.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0005 (Gateway→Auth→User Signup Plumbing)
 *
 * Purpose:
 * - Client-facing signup entrypoint.
 * - Thin controller: validate → (call User later) → return.
 *
 * Notes:
 * - For stabilization, we ACK 200. Wiring to User can be added next.
 */

import type { RequestHandler } from "express";
import { ControllerBase } from "@nv/shared/base/ControllerBase";

function getSvcName(): string {
  return process.env.SVC_NAME?.trim() || "auth";
}

export class AuthCreateController extends ControllerBase {
  constructor() {
    super({ service: getSvcName() });
  }

  /** Mount this on PUT /create */
  public create(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;
      const body = (ctx.body ?? {}) as Partial<{
        email: string;
        password: string;
      }>;

      const email = (body.email || "").trim();
      const password = (body.password || "").trim();

      if (!email)
        return this.fail(
          400,
          "invalid_request",
          "email is required",
          requestId
        );
      if (!password)
        return this.fail(
          400,
          "invalid_request",
          "password is required",
          requestId
        );

      // TODO: Call User service with { user:{email}, hashedPassword } once proxy is fixed.
      // const hashedPassword = `mock-hash::${password}`;

      return {
        status: 200,
        body: {
          ok: true,
          service: this.service,
          requestId,
          data: {
            status: "created",
            detail: "auth.create ack — user call deferred during stabilization",
            email,
          },
        },
      };
    });
  }
}
