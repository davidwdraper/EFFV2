// backend/services/svcfacilitator/src/controllers/MirrorController.ts
/**
 * Purpose:
 * - Accept a pushed mirror from gateway and replace our in-memory copy.
 */
import type { Request, Response } from "express";
import { SvcReceiver } from "@nv/shared";
import { mirrorStore } from "../services/mirrorStore";

export class MirrorController {
  private readonly rx = new SvcReceiver("svcfacilitator");

  public async mirrorLoad(req: Request, res: Response): Promise<void> {
    await this.rx.receive(
      {
        method: req.method,
        url: req.originalUrl ?? req.url,
        headers: req.headers as Record<string, unknown>,
        params: req.params,
        query: req.query as Record<string, unknown>,
        body: req.body,
      },
      {
        status: (code) => {
          res.status(code);
          return res;
        },
        setHeader: (k, v) => res.setHeader(k, v),
        json: (payload) => res.json(payload),
      },
      async ({ requestId, body }) => {
        const mirror = (body as any)?.mirror;
        if (!mirror || typeof mirror !== "object") {
          throw new Error(
            "invalid_payload: expected { mirror: Record<string, ServiceConfigRecord> }"
          );
        }
        mirrorStore.setMirror(mirror);
        return {
          status: 200,
          body: {
            accepted: true,
            requestId,
            services: Object.keys(mirror).length,
          },
        };
      }
    );
  }
}
