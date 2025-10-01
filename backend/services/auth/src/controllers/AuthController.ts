// backend/services/auth/src/controllers/AuthController.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs: ADR-0004
 *
 * Purpose:
 * - Minimal auth endpoints with uniform envelopes via SvcReceiver.
 * - No security/minting yet; returns deterministic mock payloads.
 */

import type { Request, Response } from "express";
import { SvcReceiver } from "@nv/shared/svc/SvcReceiver";

type CreateBody = { email?: string; password?: string; displayName?: string };
type SignonBody = { email?: string; password?: string };
type ChangePasswordBody = {
  email?: string;
  oldPassword?: string;
  newPassword?: string;
};

export class AuthController {
  private readonly rx = new SvcReceiver("auth");

  public async create(req: Request, res: Response): Promise<void> {
    return this.rx.receive(
      req as any,
      res as any,
      async ({ body, requestId }) => {
        const b = (body || {}) as CreateBody;
        const mockJwt = "mock.jwt.token.create";
        return {
          status: 201,
          body: {
            userId: `u_${Buffer.from(
              (b.email || "user") + "_" + Date.now()
            ).toString("base64url")}`,
            email: b.email ?? null,
            displayName: b.displayName ?? null,
            token: mockJwt,
            note: "Minting not implemented yet.",
            requestId,
          },
        };
      }
    );
  }

  public async signon(req: Request, res: Response): Promise<void> {
    return this.rx.receive(
      req as any,
      res as any,
      async ({ body, requestId }) => {
        const b = (body || {}) as SignonBody;
        const ok = Boolean(b.email && b.password);
        const mockJwt = ok ? "mock.jwt.token.signon" : undefined;
        return {
          status: ok ? 200 : 400,
          body: ok
            ? {
                token: mockJwt,
                email: b.email,
                note: "Minting not implemented yet.",
                requestId,
              }
            : { error: "email and password required", requestId },
        };
      }
    );
  }

  public async changePassword(req: Request, res: Response): Promise<void> {
    return this.rx.receive(
      req as any,
      res as any,
      async ({ body, requestId }) => {
        const b = (body || {}) as ChangePasswordBody;
        const ok = Boolean(b.email && b.oldPassword && b.newPassword);
        return {
          status: ok ? 200 : 400,
          body: ok
            ? { changed: true, email: b.email, requestId }
            : {
                changed: false,
                error: "email, oldPassword, newPassword required",
                requestId,
              },
        };
      }
    );
  }
}
