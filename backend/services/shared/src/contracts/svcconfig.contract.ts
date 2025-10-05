// backend/services/shared/src/contracts/svcconfig.contract.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0007 (SvcConfig Contract — fixed shapes & keys, OO form)
 *
 * Purpose:
 * - Canonical OO contract for service-config (svcconfig) records and mirrors.
 * - Mirrors the stored Mongo document shape you provided (no `port` field).
 *
 * Behavioral notes:
 * - Mirror/caches keyed by "<slug>@<version>" (lowercase slug).
 * - If `exposeHealth === false`, gateway SHOULD 405 health endpoints before proxy.
 * - `etag` is an opaque correlation token; gateway injects/forwards it end-to-end.
 * - Outside production, baseUrl MUST include an explicit port to avoid drift (fail-fast).
 */

import { BaseContract } from "./base.contract";

export type ServiceConfigRecordJSON = {
  slug: string; // lowercase, [a-z][a-z0-9-]*
  version: number; // int >= 1
  enabled: boolean;
  allowProxy: boolean;
  baseUrl: string; // e.g., "http://127.0.0.1:4010"
  outboundApiPrefix: string; // e.g., "/api"
  configRevision: number; // int >= 1
  etag: string; // URL-safe opaque token
  exposeHealth: boolean;
  updatedAt: string; // ISO-8601 (normalized)
  updatedBy: string; // REQUIRED operator/user id
  notes?: string;
};

export type ServiceConfigMirror = Record<string, ServiceConfigRecordJSON>; // key "<slug>@<version>"

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const API_PREFIX_RE = /^\/[A-Za-z0-9/-]*$/; // must start with "/"
const ETAG_RE = /^[A-Za-z0-9_\-=.]+$/; // base64url-ish / URL-safe

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function assertUrl(u: string, field = "baseUrl"): void {
  try {
    // eslint-disable-next-line no-new
    new URL(u);
  } catch {
    throw new Error(`${field}: invalid URL`);
  }
}

function normalizeUpdatedAt(input: unknown): string {
  // Accepts ISO string, Date, or Mongo {$date: "..."}; returns ISO string.
  if (typeof input === "string") {
    const d = new Date(input);
    if (Number.isNaN(d.getTime()))
      throw new Error("updatedAt: invalid date string");
    return d.toISOString();
  }
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime()))
      throw new Error("updatedAt: invalid Date");
    return input.toISOString();
  }
  if (input && typeof input === "object" && "$date" in (input as any)) {
    const v = (input as any)["$date"];
    if (typeof v !== "string")
      throw new Error("updatedAt.$date: expected string");
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new Error("updatedAt.$date: invalid");
    return d.toISOString();
  }
  throw new Error("updatedAt: expected ISO string, Date, or {$date:string}");
}

function requireApiPrefix(prefix: string): void {
  if (!API_PREFIX_RE.test(prefix))
    throw new Error("outboundApiPrefix: invalid path prefix");
  if (prefix.length > 1 && prefix.endsWith("/")) {
    throw new Error("outboundApiPrefix: must not end with '/' (use '/api')");
  }
}

function isProduction(): boolean {
  return (
    (process.env.MODE ?? process.env.NODE_ENV ?? "dev")
      .toString()
      .toLowerCase() === "production"
  );
}

export class ServiceConfigRecord extends BaseContract<ServiceConfigRecordJSON> {
  public readonly slug: string;
  public readonly version: number;
  public readonly enabled: boolean;
  public readonly allowProxy: boolean;
  public readonly baseUrl: string;
  public readonly outboundApiPrefix: string;
  public readonly configRevision: number;
  public readonly etag: string;
  public readonly exposeHealth: boolean;
  public readonly updatedAt: string; // ISO
  public readonly updatedBy: string;
  public readonly notes?: string;

  private _port?: number; // memoized computed port

  /** Construct from an unknown payload; throws on any invalid field. */
  constructor(input: unknown) {
    super();
    const obj = ServiceConfigRecord.ensurePlainObject(input, "svcconfig");

    // slug
    const slug = ServiceConfigRecord.takeString(obj, "slug", {
      required: true,
      trim: true,
      lower: true,
    })!;
    ServiceConfigRecord.requirePattern(
      slug,
      SLUG_RE,
      "slug",
      "lowercase letters, digits, hyphens"
    );

    // version
    const versionRaw = obj["version"];
    if (!isInt(versionRaw) || (versionRaw as number) < 1) {
      throw new Error("version: must be an integer >= 1");
    }
    const version = versionRaw as number;

    // enabled / allowProxy / exposeHealth
    for (const f of ["enabled", "allowProxy", "exposeHealth"] as const) {
      if (typeof obj[f] !== "boolean")
        throw new Error(`${f}: expected boolean`);
    }

    // baseUrl
    const baseUrl = ServiceConfigRecord.takeString(obj, "baseUrl")!;
    assertUrl(baseUrl, "baseUrl");

    // Outside production, require an explicit port to avoid accidental 80/443 assumptions
    if (!isProduction()) {
      const u = new URL(baseUrl);
      if (!u.port) {
        throw new Error("baseUrl: explicit port required outside production");
      }
    }

    // outboundApiPrefix
    const outboundApiPrefix = ServiceConfigRecord.takeString(
      obj,
      "outboundApiPrefix"
    )!;
    requireApiPrefix(outboundApiPrefix);

    // configRevision
    const configRevision = obj["configRevision"];
    if (!isInt(configRevision) || (configRevision as number) < 1) {
      throw new Error("configRevision: must be an integer >= 1");
    }

    // etag
    const etag = ServiceConfigRecord.takeString(obj, "etag", {
      required: true,
      trim: true,
    })!;
    if (!ETAG_RE.test(etag)) throw new Error("etag: invalid characters");

    // updatedAt
    const updatedAt = normalizeUpdatedAt(obj["updatedAt"]);

    // updatedBy (REQUIRED)
    const updatedBy = ServiceConfigRecord.takeString(obj, "updatedBy", {
      required: true,
      trim: true,
    })!;
    if (updatedBy.length === 0) throw new Error("updatedBy: must not be empty");

    // notes (optional)
    const notes = obj["notes"];
    if (notes != null && typeof notes !== "string") {
      throw new Error("notes: expected string");
    }

    // Assign
    this.slug = slug;
    this.version = version;
    this.enabled = obj["enabled"] as boolean;
    this.allowProxy = obj["allowProxy"] as boolean;
    this.baseUrl = baseUrl;
    this.outboundApiPrefix = outboundApiPrefix;
    this.configRevision = configRevision as number;
    this.etag = etag;
    this.exposeHealth = obj["exposeHealth"] as boolean;
    this.updatedAt = updatedAt;
    this.updatedBy = updatedBy;
    this.notes = notes as string | undefined;
  }

  /** Canonical mirror key "<slug>@<version>" */
  public key(): string {
    return svcKey(this.slug, this.version);
  }

  /** ISO string → Date helper (safe) */
  public updatedDate(): Date {
    return new Date(this.updatedAt);
  }

  /** Computed port (memoized). Falls back to 80/443 if URL omits port (prod only). */
  public get port(): number {
    if (this._port !== undefined) return this._port;
    const u = new URL(this.baseUrl);
    const p = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (!Number.isFinite(p) || p < 1 || p > 65535) {
      throw new Error(
        `baseUrl: could not resolve a valid port from '${this.baseUrl}'`
      );
    }
    this._port = p;
    return p;
  }

  /** Health exposure helper used by gateway routing logic. */
  public healthExposed(): boolean {
    return this.enabled && this.exposeHealth === true;
  }

  /** JSON-ready representation (stable order). */
  public toJSON(): ServiceConfigRecordJSON {
    const out: ServiceConfigRecordJSON = {
      slug: this.slug,
      version: this.version,
      enabled: this.enabled,
      allowProxy: this.allowProxy,
      baseUrl: this.baseUrl,
      outboundApiPrefix: this.outboundApiPrefix,
      configRevision: this.configRevision,
      etag: this.etag,
      exposeHealth: this.exposeHealth,
      updatedAt: this.updatedAt,
      updatedBy: this.updatedBy,
    };
    if (this.notes) out.notes = this.notes;
    return out;
  }

  // ── Static constructors / validators ───────────────────────────────────────

  /** Parse one record from unknown input. */
  public static parse(input: unknown): ServiceConfigRecord {
    return new ServiceConfigRecord(input);
  }

  /** Validate and normalize a mirror object; returns JSON-normalized copy. */
  public static parseMirror(input: unknown): ServiceConfigMirror {
    const rec = BaseContract.ensurePlainObject(input, "mirror");
    const out: ServiceConfigMirror = {};
    for (const [k, v] of Object.entries(rec)) {
      if (!MIRROR_KEY_RE.test(k)) {
        throw new Error(
          `mirror: invalid key '${k}' (expected '<slug>@<version>')`
        );
      }
      const parsed = new ServiceConfigRecord(v).toJSON();
      // Defensive: ensure key matches payload
      const expected = svcKey(parsed.slug, parsed.version);
      if (k !== expected) {
        throw new Error(
          `mirror: key '${k}' does not match payload '${expected}'`
        );
      }
      out[k] = parsed;
    }
    return out;
  }
}

const MIRROR_KEY_RE = /^[a-z][a-z0-9-]*@([1-9][0-9]*)$/;

/** Helper: canonical key */
export function svcKey(slug: string, version: number): string {
  return `${slug.toLowerCase()}@${version}`;
}

/** Helper: derive a port from a baseUrl (80/443 defaults if none present) */
export function inferPort(baseUrl: string): number {
  const u = new URL(baseUrl);
  if (u.port) return Number(u.port);
  if (u.protocol === "http:") return 80;
  if (u.protocol === "https:") return 443;
  throw new Error(`cannot infer port from baseUrl: ${baseUrl}`);
}

/** Helper: quick guard used by gateway to decide if health should be exposed */
export function healthExposed(
  rec: ServiceConfigRecord | ServiceConfigRecordJSON
): boolean {
  const r =
    rec instanceof ServiceConfigRecord ? rec : new ServiceConfigRecord(rec);
  return r.healthExposed();
}
