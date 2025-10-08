// backend/services/shared/src/http/UrlHelper.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Parse API URLs of the form: /api/<slug>/v<#>/<subpath>[?query]
 * - Reconstruct downstream routes while preserving version + query.
 * - Build strict, outbound URLs from a base URL by **replacing the port**
 *   after performing full sanity checks (no env-specific fallbacks).
 * - Provide a shared utility to extract {slug, version} from either an absolute URL
 *   or an API path — so core logic isn’t duplicated across proxy/SvcClient.
 *
 * Notes:
 * - Version is **required** on all inbound URLs, including health.
 * - Subpath normalized to start with "/" (defaults to "/").
 * - Outbound URL builder enforces http/https, non-empty host, and routable hostnames
 *   (rejects 0.0.0.0 and ::).
 */

export interface ApiAddress {
  slug: string;
  version: number; // required on all inbound URLs
  subpath: string; // always starts with "/"
  query?: string; // raw query (no leading "?")
}

export class UrlHelper {
  /** Prevent instantiation: static utility only. */
  private constructor() {}
  /** Regex compiled once for efficiency. */
  private static readonly RE_API = /^\/api\/([^\/]+)\/v(\d+)(?:(\/.*))?$/;

  // ────────────────────────── public API ──────────────────────────

  /** Parse a path (with optional query), e.g. "/api/auth/v1/login?x=1". */
  static parseApiPath(pathWithQuery: string): ApiAddress {
    const [path, query] = this.splitOnce(pathWithQuery, "?");
    const m = this.RE_API.exec(path);
    if (!m)
      throw new Error(
        `UrlHelper.parseApiPath: invalid API path (version required): ${pathWithQuery}`
      );

    const slug = m[1];
    const verRaw = m[2];
    const subpath = m[3] || "/";

    const version = Number(verRaw);
    if (!Number.isFinite(version) || version <= 0) {
      throw new Error(`UrlHelper.parseApiPath: invalid version: ${verRaw}`);
    }

    return { slug, version, subpath, query };
  }

  /**
   * Extract { slug, version } from either:
   *  - an **absolute URL** like "https://gw.local:4000/api/auth/v1/create?x=1", or
   *  - an **API path** like "/api/auth/v1/create?x=1".
   *
   * Version is required; throws on invalid inputs.
   */
  static getSlugAndVersion(inputUrlOrPath: string): {
    slug: string;
    version: number;
  } {
    const pathWithQuery = this.pathWithQueryFromInput(
      inputUrlOrPath,
      "UrlHelper.getSlugAndVersion"
    );
    const addr = this.parseApiPath(pathWithQuery);
    return { slug: addr.slug, version: addr.version };
  }

  /** Build a downstream route preserving version and query (version required). */
  static buildServiceRoute(addr: ApiAddress): string {
    if (!addr.version || !Number.isFinite(addr.version)) {
      throw new Error("UrlHelper.buildServiceRoute: version is required");
    }
    const vseg = `/v${addr.version}`;
    const sub = addr.subpath.startsWith("/")
      ? addr.subpath
      : `/${addr.subpath}`;
    const q = addr.query ? `?${addr.query}` : "";
    return `/api/${addr.slug}${vseg}${sub}${q}`;
  }

  /**
   * Build a **strict** outbound URL by taking a full base URL and **replacing the port**.
   * - Enforces http/https protocol.
   * - Requires a routable hostname (rejects 0.0.0.0 and ::).
   * - Validates newPort ∈ [1, 65535].
   * - Returns a fully-qualified absolute URL string.
   *
   * Examples:
   *  buildOutboundUrl("http://auth.local:4010", 8443) → "http://auth.local:8443/"
   *  buildOutboundUrl("https://auth.stage.nowvibin.com", 443) → "https://auth.stage.nowvibin.com:443/"
   */
  static buildOutboundUrl(baseUrl: string, newPort: number | string): string {
    const u = this.safeParseAbsoluteHttpUrl(
      baseUrl,
      "UrlHelper.buildOutboundUrl(baseUrl)"
    );
    const port = this.coercePort(
      newPort,
      "UrlHelper.buildOutboundUrl(newPort)"
    );
    u.port = String(port);
    return u.toString();
  }

  /**
   * Build a **strict** outbound REQUEST URL by replacing the port **and**
   * applying a request path+query (e.g., the original API path that’s being proxied).
   *
   * `requestPathWithQuery` may be "/api/slug/v1/route?x=1" or any path with optional query.
   * The base URL’s origin (scheme+host+port) is kept; its original path is discarded.
   */
  static buildOutboundRequestUrl(
    baseUrl: string,
    newPort: number | string,
    requestPathWithQuery: string
  ): string {
    const u = this.safeParseAbsoluteHttpUrl(
      baseUrl,
      "UrlHelper.buildOutboundRequestUrl(baseUrl)"
    );
    const port = this.coercePort(
      newPort,
      "UrlHelper.buildOutboundRequestUrl(newPort)"
    );
    u.port = String(port);

    const [path, query] = this.splitOnce(requestPathWithQuery || "/", "?");
    // Normalize path to start with "/"
    u.pathname = path.startsWith("/") ? path : `/${path}`;
    u.search = query ? `?${query}` : "";

    return u.toString();
  }

  // ────────────────────────── internals / guards ────────────────────────────

  /** Accept either an absolute URL or an API path and return "path?query" for parsing. */
  private static pathWithQueryFromInput(input: string, who: string): string {
    if (!input || typeof input !== "string") {
      throw new Error(`${who}: input must be a non-empty string`);
    }
    if (input.startsWith("/")) {
      // Looks like a path already
      return input;
    }
    // Try absolute URL
    try {
      const u = new URL(input);
      return `${u.pathname}${u.search}`;
    } catch {
      // Not a path; not a URL
      throw new Error(
        `${who}: expected absolute URL or API path (got: ${input})`
      );
    }
  }

  private static safeParseAbsoluteHttpUrl(input: string, who: string): URL {
    let u: URL;
    try {
      u = new URL(input);
    } catch {
      throw new Error(`${who}: invalid absolute URL: ${input}`);
    }

    const proto = u.protocol.toLowerCase();
    if (proto !== "http:" && proto !== "https:") {
      throw new Error(
        `${who}: unsupported protocol (expected http/https): ${u.protocol}`
      );
    }

    if (!u.hostname) {
      throw new Error(`${who}: missing hostname`);
    }

    const hostLower = u.hostname.toLowerCase();
    if (hostLower === "0.0.0.0" || hostLower === "::") {
      throw new Error(`${who}: unroutable host (${u.hostname})`);
    }

    // URL is otherwise sane; path may be anything (we overwrite in request variant).
    return u;
  }

  private static coercePort(p: number | string, who: string): number {
    let n: number;
    if (typeof p === "string") {
      const t = p.trim();
      if (t.length === 0) throw new Error(`${who}: empty port`);
      n = Number(t);
    } else {
      n = p;
    }
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(`${who}: invalid port (must be 1..65535): ${p}`);
    }
    return n;
  }

  /** Internal helper: split a string once on the first occurrence of `sep`. */
  private static splitOnce(
    s: string,
    sep: string
  ): [string, string | undefined] {
    const i = s.indexOf(sep);
    return i === -1 ? [s, undefined] : [s.slice(0, i), s.slice(i + sep.length)];
  }
}
