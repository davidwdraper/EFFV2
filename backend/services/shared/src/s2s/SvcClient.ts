// backend/services/shared/src/s2s/SvcClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-XXXX (SvcClient — single S2S door, slugKey-based routing)
 *
 * Purpose:
 * - Mock (but structurally correct) Service-to-Service client.
 * - All S2S calls — including env-service — pass through this class.
 * - For now, base URLs are hardcoded for a small set of slugKeys (e.g., "env-service@1").
 *
 * Invariants:
 * - No JWT minting yet (KMS integration pending).
 * - No DTOs here; wire-level JSON only.
 * - No .env parsing; mock URLs are defined in-code.
 */

import { URL } from "url";

export type SvcClientConfig = {
  callerSlug: string;
  callerVersion: number;
};

export type SvcClientCallOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  bodyJson?: unknown;
  headers?: Record<string, string>;
  requestId?: string;
  timeoutMs?: number;
};

export type SvcClientResponse<T = unknown> = {
  status: number;
  headers: Record<string, string>;
  data: T;
};

export class SvcClient {
  private readonly callerSlug: string;
  private readonly callerVersion: number;

  constructor(cfg: SvcClientConfig) {
    this.callerSlug = cfg.callerSlug;
    this.callerVersion = cfg.callerVersion;
  }

  /**
   * Core S2S call.
   *
   * @param slugKey - Target service key "<slug>@<version>", e.g. "env-service@1".
   * @param options - Call options (path, method, headers, body, etc.).
   */
  public async call<T = unknown>(
    slugKey: string,
    options: SvcClientCallOptions
  ): Promise<SvcClientResponse<T>> {
    const {
      method = "GET",
      path,
      query,
      bodyJson,
      headers,
      requestId,
    } = options;

    if (!slugKey.includes("@")) {
      throw new Error(
        `SVC_CLIENT_INVALID_SLUGKEY: expected "<slug>@<version>", got "${slugKey}". ` +
          "Ops: ensure callers pass slugKey like 'env-service@1'."
      );
    }

    const [slug, verStr] = slugKey.split("@");
    const version = Number(verStr);
    if (!slug || !Number.isFinite(version)) {
      throw new Error(
        `SVC_CLIENT_INVALID_SLUGKEY: cannot parse slug/version from "${slugKey}". ` +
          "Ops: slugKey must be '<slug>@<majorVersion>'."
      );
    }

    const baseUrl = this.resolveBaseUrl(slugKey, slug, version);
    const url = this.buildUrl(baseUrl, path, query);

    const rid = requestId ?? this.generateRequestId(slug, version);

    const stdHeaders: Record<string, string> = {
      "x-service-name": this.callerSlug,
      "x-api-version": String(this.callerVersion),
      "x-request-id": rid,
      // TODO: add Authorization header once KMS-based JWT minting is implemented.
    };

    const body = bodyJson !== undefined ? JSON.stringify(bodyJson) : undefined;
    if (body && !stdHeaders["content-type"]) {
      stdHeaders["content-type"] = "application/json";
    }

    const mergedHeaders: Record<string, string> = {
      ...stdHeaders,
      ...(headers ?? {}),
    };

    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        method,
        headers: mergedHeaders,
        body,
      });
    } catch (err) {
      throw new Error(
        `SVC_CLIENT_NETWORK_ERROR: Failed to call "${slugKey}" at ${url.toString()}. ` +
          "Ops: verify network connectivity, service deployment, and mock base URL configuration. " +
          `Detail: ${(err as Error)?.message ?? String(err)}`
      );
    }

    const data = (await this.parseJsonSafe(resp)) as T;
    const headerObj: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      headerObj[key.toLowerCase()] = value;
    });

    return {
      status: resp.status,
      headers: headerObj,
      data,
    };
  }

  /**
   * Resolve the base URL for a given slugKey.
   *
   * MOCK implementation:
   * - Uses an in-file mapping of slugKey → base URL.
   * - Unknown slugKeys throw with an Ops message.
   *
   * Later, this logic will be replaced with a call to svcconfig.
   */
  private resolveBaseUrl(
    slugKey: string,
    slug: string,
    version: number
  ): string {
    // Hard-coded mock map; adjust as needed for local/dev topology.
    const MOCK_BASE_URLS: Record<string, string> = {
      // Example: env-service v1 running locally on 4010
      "env-service@1": "http://127.0.0.1:4015",
      // Add more services here as they come online:
      "xxx@1": "http://127.0.0.1:4016",
    };

    const url = MOCK_BASE_URLS[slugKey];
    if (!url) {
      throw new Error(
        `******** SVC_CLIENT_MOCK_UNKNOWN_TARGET: No mock base URL mapping for slugKey "${slugKey}". ` +
          "Ops: until svcconfig is implemented, only a small set of slugKeys are supported by SvcClient. " +
          `Requested slug="${slug}", version=${version}. ` +
          "Add an entry to MOCK_BASE_URLS in SvcClient to enable this target."
      );
    }

    return url;
  }

  private buildUrl(
    baseUrl: string,
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ): URL {
    if (!path.startsWith("/")) {
      throw new Error(
        `SVC_CLIENT_INVALID_PATH: Expected absolute path starting with '/', got "${path}". ` +
          "Ops: fix the calling code to pass a fully-qualified path."
      );
    }

    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch (err) {
      throw new Error(
        `SVC_CLIENT_INVALID_BASEURL: Failed to parse base URL "${baseUrl}". ` +
          "Ops: correct the mock base URL mapping in SvcClient. " +
          `Detail: ${(err as Error)?.message ?? String(err)}`
      );
    }

    url.pathname = path;

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  private async parseJsonSafe(resp: Response): Promise<unknown> {
    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      const text = await resp.text().catch(() => "");
      return {
        _nonJson: true,
        text,
      };
    }

    try {
      return await resp.json();
    } catch (err) {
      throw new Error(
        `SVC_CLIENT_JSON_PARSE_ERROR: Failed to parse JSON response from target service. ` +
          "Ops: verify that the target endpoint returns valid JSON. " +
          `Detail: ${(err as Error)?.message ?? String(err)}`
      );
    }
  }

  private generateRequestId(slug: string, version: number): string {
    const now = Date.now().toString(36);
    const rand = Math.floor(Math.random() * 1_000_000).toString(36);
    return `${slug}-${version}-${now}-${rand}`;
  }
}
