// backend/services/shared/src/contracts/audit/audit.target.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - adr0022-shared-wal-and-db-base
 *
 * Purpose:
 * - Contract for the target endpoint/context an audited call is hitting.
 */

import { AuditContractBase } from "./audit.base.contract";

export interface AuditTargetJson {
  slug: string; // e.g., "user", "auth", "act", "gateway"
  version: number; // API major version (e.g., 1)
  route: string; // e.g., "/api/acts" or "/users/:id"
  method: string; // "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
}

export class AuditTargetContract extends AuditContractBase<AuditTargetJson> {
  public readonly slug: string;
  public readonly version: number;
  public readonly route: string;
  public readonly method: string;

  public constructor(json: AuditTargetJson) {
    super();
    if (!Number.isInteger(json.version) || json.version < 0) {
      throw new Error("version: expected nonnegative integer");
    }
    if (!json.slug || !json.route || !json.method) {
      throw new Error("slug/route/method: required");
    }
    this.slug = AuditContractBase.normalizeSlug(json.slug);
    this.version = json.version;
    this.route = AuditContractBase.normalizePath(json.route);
    this.method = AuditContractBase.normalizeMethod(json.method);
  }

  public static parse(
    input: unknown,
    ctx = "AuditTarget"
  ): AuditTargetContract {
    const obj = AuditContractBase.ensurePlainObject(input, ctx);
    const slug = AuditContractBase.takeString(obj, "slug", {
      required: true,
      trim: true,
      lower: true,
    })!;
    const route = AuditContractBase.takeString(obj, "route")!;
    const method = AuditContractBase.takeString(obj, "method")!;
    const v = obj["version"];
    if (!Number.isInteger(v) || (v as number) < 0) {
      throw new Error("version: expected nonnegative integer");
    }
    return new AuditTargetContract({
      slug,
      version: v as number,
      route,
      method,
    });
  }

  public toJSON(): AuditTargetJson {
    return {
      slug: this.slug,
      version: this.version,
      route: this.route,
      method: this.method,
    };
  }
}
