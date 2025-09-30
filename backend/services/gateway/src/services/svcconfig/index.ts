// backend/services/gateway/src/services/svcconfig/index.ts
/**
 * Purpose:
 * - Build the SvcConfig singleton and inject mirror pusher.
 */
import { SvcConfig } from "./SvcConfig";
import { SvcFacilitatorMirrorPusher } from "./SvcFacilitatorMirrorPusher";
import type { UrlResolver } from "@nv/shared";

let _instance: SvcConfig | null = null;

export function getSvcConfig(): SvcConfig {
  if (_instance) return _instance;

  // 1) Create bare SvcConfig
  _instance = new SvcConfig();

  // 2) Build pusher with resolver that uses SvcConfig’s own mirror
  const resolver: UrlResolver = (slug, version) =>
    _instance!.getUrlFromSlug(slug, version);
  const pusher = new SvcFacilitatorMirrorPusher(resolver);
  _instance.setMirrorPusher(pusher);

  return _instance;
}

export type { ServiceConfigRecord } from "@nv/shared/contracts/ServiceConfig";
export * from "./types";
