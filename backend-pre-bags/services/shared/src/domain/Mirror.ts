// backend/services/shared/src/domain/Mirror.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007, ADR-0020 (Mirror container), ADR-0032 (Policy gate)
 *
 * Purpose:
 * - Simple keyed container: Map<slug@version, ServiceConfig>.
 * - Responsibilities: set/replace/get/size + serialize to wire Record.
 *
 * Notes:
 * - Domain owns the entity; wire types live in contracts.
 * - No Zod here; Zod only at edges.
 */

import { ServiceConfig } from "./ServiceConfig";
import type { ServiceConfigJSON as WireServiceConfigJSON } from "../contracts/serviceConfig.wire";

export class Mirror {
  private readonly map = new Map<string, ServiceConfig>();

  static buildEmpty(): Mirror {
    return new Mirror();
  }

  static fromArray(items: ServiceConfig[]): Mirror {
    const m = new Mirror();
    for (const cfg of items) m.set(cfg);
    return m;
  }

  /**
   * Replace the entire mirror contents with the provided items.
   * Returns this for fluency.
   */
  replaceAll(items: ServiceConfig[]): Mirror {
    this.map.clear();
    for (const cfg of items) this.set(cfg);
    return this;
  }

  set(cfg: ServiceConfig): void {
    this.map.set(cfg.key(), cfg);
  }

  get(key: string): ServiceConfig | undefined {
    return this.map.get(key);
  }

  getBySlugVersion(slug: string, version: number): ServiceConfig | undefined {
    return this.map.get(`${slug}@${version}`);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  size(): number {
    return this.map.size;
  }

  keys(): string[] {
    return Array.from(this.map.keys());
  }

  /**
   * Stable wire shape: Record<key, ServiceConfigJSON>
   * Consumers are free to parse/validate with Zod at edges.
   */
  toObject(): Record<string, WireServiceConfigJSON> {
    const out: Record<string, WireServiceConfigJSON> = {};
    for (const [k, v] of this.map.entries()) out[k] = v.toJSON();
    return out;
  }
}
