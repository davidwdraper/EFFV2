// backend/services/auth/src/controllers/auth.create.controller.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - ADR-0005 Gateway→Auth→User Signup Plumbing
 * - ADR-0027 S2S Contract: flat request + header; canonical envelope response
 *
 * Purpose:
 * - Client-facing signup. Thin: validate → mock-hash → S2S user.create → envelope out.
 */

import type { RequestHandler } from "express";
import { ControllerBase } from "@nv/shared/base/controller/ControllerBase";
import { getSvcClient } from "@nv/shared/svc/client";

function svcName(): string {
  return process.env.SVC_NAME?.trim() || "auth";
}

// Swap to shared contract when you promote it:
//   import { UserCreateV1Contract } from "@nv/shared/contracts/user/user.create.v1.contract";
//   const USER_CREATE_CONTRACT = UserCreateV1Contract.getContractId();
const USER_CREATE_CONTRACT = "user/create@v1";

export class AuthCreateController extends ControllerBase {
  constructor() {
    super({ service: svcName() });
  }

  /** Mount on PUT /create */
  public create(): RequestHandler {
    return this.handle(async (ctx) => {
      const requestId = ctx.requestId;
      const body = (ctx.body ?? {}) as Partial<{
        email: string;
        password: string;
      }>;

      const email = (body.email || "").trim();
      const password = (body.password || "").trim();

      if (!email) return this.fail(400, "invalid_request", "email is required");
      if (!password)
        return this.fail(400, "invalid_request", "password is required");

      // Mock hash for now (greenfield note: replace with real KMS/hasher later)
      const hashedPassword = `mock-hash::${password}`;

      // S2S → User.create (flat body + contract header). Expect canonical envelope back.
      const svcClient = getSvcClient();
      const userResp = await svcClient.call<{
        ok: boolean;
        service: string;
        data: { status: number; body?: any } | any;
      }>({
        slug: "user",
        version: 1,
        path: "/create",
        method: "PUT",
        headers: {
          "X-NV-Contract": USER_CREATE_CONTRACT,
          // S2S allowlist: your User S2S guard checks x-service-name
          "x-service-name": this.service,
        },
        body: {
          user: { email }, // minimal user DTO; shared contract will own shape later
          hashedPassword, // opaque to transport
        },
      });

      // Normalize downstream envelope variance while User is still stabilizing
      const statusCode =
        (userResp?.data as any)?.status ??
        (typeof (userResp as any)?.status === "number"
          ? (userResp as any).status
          : 202);

      const userBody = (userResp?.data as any)?.body ??
        (userResp?.data as any) ?? {
          accepted: 1,
          note: "user service ack (stub)",
        };

      return {
        status: 200,
        body: {
          ok: true,
          service: this.service,
          requestId,
          data: {
            status: statusCode,
            body: {
              user: userBody?.user ?? { email }, // echo minimal user
              userService: "user",
            },
          },
        },
      };
    });
  }
}
