// backend/services/svcfacilitator/src/services/mirrorStore.ts
/**
 * Purpose:
 * - In-memory mirror storage for svcfacilitator (no DB).
 */
import type { ServiceConfigRecord } from "@nv/shared/contracts/ServiceConfig";

export type MirrorMap = Record<string, ServiceConfigRecord>;

class MirrorStore {
  private mirror: MirrorMap = {};

  setMirror(m: MirrorMap): void {
    this.mirror = { ...m };
  }

  getMirror(): Readonly<MirrorMap> {
    return Object.freeze({ ...this.mirror });
  }

  getUrlFromSlug(slug: string, version = 1): string {
    const key = `${slug}@${version}`;
    const rec = this.mirror[key];
    if (!rec || !rec.enabled)
      throw new Error(`unknown_or_disabled_service: ${key}`);
    return rec.baseUrl;
  }
}

export const mirrorStore = new MirrorStore();
