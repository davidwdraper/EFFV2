// backend/services/shared/src/domain/ServiceConfig.ts
/**
 * Docs:
 * - SOP: Reduced, Clean
 * - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 * - ADR-0020 (SvcConfig Mirror & Push Design)
 *
 * Purpose:
 * - Domain entity for a single service configuration at slug@version.
 * - Owns its route policies (edge + s2s). Single reason to change.
 *
 * Notes:
 * - No Zod here. Zod lives only at wire edges.
 * - No env reads. No I/O. Pure in-memory entity.
 */

import type { ServiceConfigJSON as WireServiceConfigJSON } from "@nv/shared/contracts/serviceConfig.wire";

export type SvcMethod = "GET" | "PUT" | "POST" | "PATCH" | "DELETE";

export interface EdgePolicy {
  type: "Edge";
  svcconfigId: string | { $oid: string };
  _id?: string | { $oid: string };
  slug: string;
  method: SvcMethod;
  path: string;
  bearerRequired: boolean;
  enabled: boolean;
  updatedAt: string;
  notes?: string;
  minAccessLevel?: number;
}

export interface S2SPolicy {
  type: "S2S";
  svcconfigId: string | { $oid: string };
  _id?: string | { $oid: string };
  slug: string;
  method: SvcMethod;
  path: string;
  enabled: boolean;
  updatedAt: string;
  notes?: string;
}

export interface ServiceConfigProps {
  _id: string;
  slug: string;
  version: number;
  enabled: boolean;
  internalOnly: boolean;
  baseUrl: string;
  outboundApiPrefix: string; // required by wire
  exposeHealth: boolean; // required by wire
  changedByUserId?: string;
  updatedAt: string;
  edgePolicies: EdgePolicy[];
  s2sPolicies: S2SPolicy[];
}

export class ServiceConfig {
  private readonly _id: string;
  private readonly slug: string;
  private readonly version: number;
  private readonly enabled: boolean;
  private readonly internalOnly: boolean;
  private readonly baseUrl: string;
  private readonly outboundApiPrefix: string;
  private readonly exposeHealth: boolean;
  private readonly changedByUserId?: string;
  private readonly updatedAt: string;

  private readonly edgePolicies: EdgePolicy[];
  private readonly s2sPolicies: S2SPolicy[];

  private constructor(props: ServiceConfigProps) {
    this._id = props._id;
    this.slug = props.slug;
    this.version = props.version;
    this.enabled = props.enabled;
    this.internalOnly = props.internalOnly;
    this.baseUrl = props.baseUrl;
    this.outboundApiPrefix = props.outboundApiPrefix;
    this.exposeHealth = props.exposeHealth;
    this.changedByUserId = props.changedByUserId;
    this.updatedAt = props.updatedAt;
    this.edgePolicies = [...props.edgePolicies];
    this.s2sPolicies = [...props.s2sPolicies];
  }

  static fromDb(
    doc: {
      _id: unknown;
      slug: unknown;
      version: unknown;
      enabled: unknown;
      internalOnly: unknown;
      baseUrl: unknown;
      outboundApiPrefix: unknown;
      exposeHealth: unknown;
      changedByUserId?: unknown;
      updatedAt: unknown;
    },
    policies: { edge: EdgePolicy[]; s2s: S2SPolicy[] }
  ): ServiceConfig {
    const id = asId(doc._id, "_id");
    const slug = asNonEmptyString(doc.slug, "slug");
    const version = asInt(doc.version, "version");
    const enabled = asBool(doc.enabled, "enabled");
    const internalOnly = asBool(doc.internalOnly, "internalOnly");
    const baseUrl = asNonEmptyString(doc.baseUrl, "baseUrl");
    const outboundApiPrefix = asNonEmptyString(
      doc.outboundApiPrefix,
      "outboundApiPrefix"
    );
    const exposeHealth = asBool(doc.exposeHealth, "exposeHealth");
    const updatedAt = asIsoString(doc.updatedAt, "updatedAt");
    const changedByUserId =
      doc.changedByUserId === undefined
        ? undefined
        : asNonEmptyString(doc.changedByUserId, "changedByUserId");

    if (!enabled)
      throw new Error(
        buildErr("enabled must be true for mirrored configs", {
          id,
          slug,
          version,
        })
      );
    if (version < 1)
      throw new Error(buildErr("version must be >= 1", { id, slug, version }));
    if (!Array.isArray(policies?.edge) || !Array.isArray(policies?.s2s)) {
      throw new Error(
        buildErr("policies.edge and policies.s2s must be arrays", {
          id,
          slug,
          version,
        })
      );
    }

    return new ServiceConfig({
      _id: id,
      slug,
      version,
      enabled,
      internalOnly,
      baseUrl,
      outboundApiPrefix,
      exposeHealth,
      changedByUserId,
      updatedAt,
      edgePolicies: policies.edge.filter((p) => p && p.enabled === true),
      s2sPolicies: policies.s2s.filter((p) => p && p.enabled === true),
    });
  }

  key(): string {
    return `${this.slug}@${this.version}`;
  }

  toJSON(): WireServiceConfigJSON {
    return {
      _id: this._id,
      slug: this.slug,
      version: this.version,
      enabled: true,
      internalOnly: this.internalOnly,
      baseUrl: this.baseUrl,
      outboundApiPrefix: this.outboundApiPrefix,
      exposeHealth: this.exposeHealth,
      changedByUserId: this.changedByUserId,
      updatedAt: this.updatedAt,
      policies: { edge: this.edgePolicies, s2s: this.s2sPolicies },
    };
  }
}

/* guards */
function asId(v: unknown, field: string): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const any = v as any;
    if (typeof any.$oid === "string") return any.$oid;
    if (typeof any.toHexString === "function") return any.toHexString();
  }
  throw new Error(
    buildErr(`field '${field}' must be string`, { got: String(v) })
  );
}
function asNonEmptyString(v: unknown, field: string): string {
  if (typeof v === "string" && v.trim().length > 0) return v;
  throw new Error(
    buildErr(`field '${field}' must be non-empty string`, { got: String(v) })
  );
}
function asInt(v: unknown, field: string): number {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  throw new Error(
    buildErr(`field '${field}' must be integer`, { got: String(v) })
  );
}
function asBool(v: unknown, field: string): boolean {
  if (typeof v === "boolean") return v;
  throw new Error(
    buildErr(`field '${field}' must be boolean`, { got: String(v) })
  );
}
function asIsoString(v: unknown, field: string): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.length > 0) return v;
  const d = new Date(v as any);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  throw new Error(
    buildErr(`field '${field}' must be Date or ISO string`, { got: String(v) })
  );
}
function buildErr(msg: string, ctx: Record<string, unknown>): string {
  const tail = Object.keys(ctx).length ? ` | ctx=${JSON.stringify(ctx)}` : "";
  return `ServiceConfig.fromDb violation: ${msg}${tail}`;
}
