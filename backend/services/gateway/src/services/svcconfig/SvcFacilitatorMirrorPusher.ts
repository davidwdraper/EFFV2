// backend/services/gateway/src/services/svcconfig/SvcFacilitatorMirrorPusher.ts
/**
 * Docs:
 * - ADR0003 gateway pushes mirror to svcfacilitator
 *
 * Purpose:
 * - Concrete mirror pusher that calls svcfacilitator /mirror/load via SvcClient.
 */
import { SvcClient, type UrlResolver } from "@nv/shared";
import type { SvcMirror } from "./types";
import type { IMirrorPusher, RefreshReason } from "./IMirrorPusher";

export class SvcFacilitatorMirrorPusher implements IMirrorPusher {
  private readonly client: SvcClient;
  private readonly slug: string;

  constructor(resolveUrl: UrlResolver, opts?: { slug?: string }) {
    this.client = new SvcClient(resolveUrl);
    this.slug = opts?.slug ?? "svcfacilitator";
  }

  async push(
    mirror: Readonly<SvcMirror>,
    reason: RefreshReason
  ): Promise<boolean> {
    const res = await this.client.call({
      slug: this.slug,
      method: "POST",
      path: "/mirror/load",
      body: { mirror, reason, from: "gateway" },
      timeoutMs: 3000,
    });

    console.log(
      JSON.stringify({
        level: res.ok ? 30 : res.status === 0 ? 40 : 30,
        service: "gateway",
        msg: "[mirror] push svcfacilitator",
        ok: res.ok,
        status: res.status,
        requestId: res.requestId,
        reason,
        services: Object.keys(mirror).length,
      })
    );

    return !!res.ok;
  }
}
