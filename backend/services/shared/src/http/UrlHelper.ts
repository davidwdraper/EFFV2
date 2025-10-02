// backend/services/shared/src/http/UrlHelper.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 *
 * Purpose:
 * - Parse API URLs of the form: /api/<slug>/v<#>/<subpath>[?query]
 * - Reconstruct downstream routes while preserving version + query.
 *
 * Notes:
 * - Slug required; version optional (callers may default to v1).
 * - Subpath normalized to start with "/" (defaults to "/").
 */

export interface ApiAddress {
  slug: string;
  version?: number; // undefined means “not present in URL”
  subpath: string; // always starts with "/"
  query?: string; // raw query (no leading "?")
}

export class UrlHelper {
  /** Prevent instantiation: static utility only. */
  private constructor() {}
  /** Regex compiled once for efficiency. */
  private static readonly RE_API = /^\/api\/([^\/]+)(?:\/v(\d+))?(?:(\/.*))?$/;

  /** Parse a path (with optional query), e.g. "/api/auth/v1/login?x=1". */
  static parseApiPath(pathWithQuery: string): ApiAddress {
    const [path, query] = this.splitOnce(pathWithQuery, "?");
    const m = this.RE_API.exec(path);
    if (!m)
      throw new Error(
        `UrlHelper.parseApiPath: not an API path: ${pathWithQuery}`
      );

    const slug = m[1];
    const verRaw = m[2];
    const subpath = m[3] || "/";

    let version: number | undefined;
    if (verRaw !== undefined) {
      version = Number(verRaw);
      if (!Number.isFinite(version) || version <= 0) {
        throw new Error(`UrlHelper.parseApiPath: invalid version: ${verRaw}`);
      }
    }

    return { slug, version, subpath, query };
  }

  /** Build a downstream route preserving version (or applying a default) and query. */
  static buildServiceRoute(addr: ApiAddress, defaultVersion?: number): string {
    const version = addr.version ?? defaultVersion;
    const vseg = version ? `/v${version}` : "";
    const sub = addr.subpath.startsWith("/")
      ? addr.subpath
      : `/${addr.subpath}`;
    const q = addr.query ? `?${addr.query}` : "";
    return `/api/${addr.slug}${vseg}${sub}${q}`;
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
