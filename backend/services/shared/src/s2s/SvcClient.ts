// backend/services/shared/src/s2s/SvcClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - LDDs:
 *   - LDD-03 (envBootstrap & SvcClient)
 *   - LDD-12 (SvcClient & S2S Contract Architecture)
 *   - LDD-19 (S2S Protocol)
 *   - LDD-33 (Security & Hardening)
 * - ADRs:
 *   - ADR-0040 (DTO-Only Persistence)
 *   - ADR-0047 (DtoBag & Views)
 *   - ADR-0050 (Wire Bag Envelope — canonical wire format)
 *   - ADR-0057 (Shared SvcClient for S2S Calls)
 *
 * Purpose:
 * - Canonical S2S HTTP client for all NV services.
 * - Resolves targets via svcconfig, enforces call graph, and sends/receives
 *   DtoBag-based wire envelopes over HTTP.
 *
 * Notes:
 * - This class is transport-only: it never inspects DTO internals.
 * - KMS/JWT integration is pluggable via IKmsTokenFactory (placeholder for now).
 */

import type { DtoBag } from "../dto/DtoBag";

export interface WireBagJson {
  items: unknown[];
  meta?: Record<string, unknown>;
}

/**
 * Result of resolving a target via svcconfig.
 *
 * This is intentionally abstracted away from svcconfig's concrete DTO shape.
 */
export interface SvcTarget {
  baseUrl: string; // e.g. "https://svc-env-dev.internal:8443"
  slug: string; // target slug ("env-service", "svcconfig", "auth", etc.)
  version: number; // major API version (1, 2, ...)
  isAuthorized: boolean; // whether the current caller may call this target
  reasonIfNotAuthorized?: string;
}

/**
 * svcconfig resolver abstraction.
 *
 * Implementations:
 * - Call svcconfig directly (using a plain HTTP client).
 * - Apply call-graph policy to determine isAuthorized.
 * - Special-case svcconfig itself to avoid recursion through SvcClient.
 */
export interface ISvcconfigResolver {
  resolveTarget(env: string, slug: string, version: number): Promise<SvcTarget>;
}

/**
 * KMS/JWT token factory abstraction (placeholder).
 *
 * Current behavior:
 * - Optional dependency: when not supplied, SvcClient omits the Authorization header.
 *
 * Future behavior:
 * - Will become mandatory once verifyS2S is fully enforced across workers.
 */
export interface IKmsTokenFactory {
  mintToken(input: {
    env: string;
    callerSlug: string;
    targetSlug: string;
    targetVersion: number;
  }): Promise<string>;
}

/**
 * Provides a requestId when one is not explicitly supplied.
 * Typically wired to the per-request context or a UUID generator.
 */
export type RequestIdProvider = () => string;

export interface SvcClientCallParams {
  env: string;
  slug: string; // target service slug
  version: number;
  dtoType: string;
  op: string;
  method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE";
  bag?: DtoBag<any>;
  pathSuffix?: string; // optional override for `<dtoType>/<op>`
  requestId?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Minimal logger interface used by SvcClient.
 * Implementations are expected to be backed by the shared logger util.
 */
export interface ISvcClientLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Canonical S2S client.
 *
 * Responsibilities:
 * - Resolve target via svcconfig (through ISvcconfigResolver).
 * - Enforce call graph authorization (reject unauthorized calls).
 * - Build standard S2S headers (requestId, service name, version).
 * - Serialize DtoBag via .toJson() for the request body when appropriate.
 * - Execute the HTTP call and return the parsed wire bag JSON.
 */
export class SvcClient {
  private readonly callerSlug: string;
  private readonly callerVersion: number;

  constructor(options: {
    callerSlug: string;
    callerVersion: number;
    logger: ISvcClientLogger;
    svcconfigResolver: ISvcconfigResolver;
    requestIdProvider: RequestIdProvider;
    tokenFactory?: IKmsTokenFactory; // optional until S2S auth is wired
  }) {
    this.callerSlug = options.callerSlug;
    this.callerVersion = options.callerVersion;
    this.logger = options.logger;
    this.svcconfigResolver = options.svcconfigResolver;
    this.requestIdProvider = options.requestIdProvider;
    this.tokenFactory = options.tokenFactory;
  }

  private readonly logger: ISvcClientLogger;
  private readonly svcconfigResolver: ISvcconfigResolver;
  private readonly requestIdProvider: RequestIdProvider;
  private readonly tokenFactory?: IKmsTokenFactory;

  /**
   * Execute a service-to-service call and return the wire bag JSON envelope.
   *
   * Callers are responsible for mapping the returned JSON back into DTOs.
   */
  public async call(params: SvcClientCallParams): Promise<WireBagJson> {
    const requestId = params.requestId ?? this.requestIdProvider();

    this.logger.debug("SvcClient.call.begin", {
      requestId,
      callerSlug: this.callerSlug,
      callerVersion: this.callerVersion,
      env: params.env,
      targetSlug: params.slug,
      targetVersion: params.version,
      dtoType: params.dtoType,
      op: params.op,
      method: params.method,
    });

    const target = await this.svcconfigResolver.resolveTarget(
      params.env,
      params.slug,
      params.version
    );

    if (!target.isAuthorized) {
      const reason = target.reasonIfNotAuthorized ?? "No reason provided";
      this.logger.warn("SvcClient.call.unauthorized", {
        requestId,
        env: params.env,
        callerSlug: this.callerSlug,
        targetSlug: target.slug,
        targetVersion: target.version,
        reason,
      });

      throw new Error(
        `SvcClient unauthorized call: caller="${this.callerSlug}" → target="${target.slug}@v${target.version}" in env="${params.env}". Reason: ${reason}`
      );
    }

    const url = this.buildUrl(target.baseUrl, params);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-service-name": this.callerSlug,
      "x-api-version": String(this.callerVersion),
      ...(params.extraHeaders ?? {}),
    };

    if (this.tokenFactory) {
      const token = await this.tokenFactory.mintToken({
        env: params.env,
        callerSlug: this.callerSlug,
        targetSlug: target.slug,
        targetVersion: target.version,
      });

      // NOTE: KMS/JWT integration placeholder — see ADR-0057.
      headers["authorization"] = `Bearer ${token}`;
    }

    const body = this.buildBody(params);

    const controller = new AbortController();
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutMs = params.timeoutMs ?? 30_000;

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await fetch(url, {
        method: params.method,
        headers,
        body,
        signal: controller.signal,
      });

      const responseText = await response.text();
      let parsed: unknown;

      try {
        parsed = responseText ? JSON.parse(responseText) : undefined;
      } catch (err) {
        this.logger.error("SvcClient.call.response.jsonError", {
          requestId,
          targetSlug: target.slug,
          status: response.status,
          bodySnippet: responseText.slice(0, 512),
        });
        throw new Error(
          `SvcClient: Failed to parse JSON from target="${target.slug}" (status=${response.status}).`
        );
      }

      if (!response.ok) {
        this.logger.warn("SvcClient.call.non2xx", {
          requestId,
          targetSlug: target.slug,
          status: response.status,
          body: parsed,
        });

        // We assume Problem+JSON, but we don't enforce schema here.
        throw new Error(
          `SvcClient: Non-success response from target="${target.slug}" (status=${response.status}). See logs for Problem+JSON payload.`
        );
      }

      this.logger.info("SvcClient.call.success", {
        requestId,
        targetSlug: target.slug,
        status: response.status,
      });

      const wire = (parsed ?? {}) as WireBagJson;
      return wire;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Build the target URL based on the baseUrl and the route convention.
   *
   * Convention (SOP/LDD):
   *   http(s)://host:port/api/<slug>/v<version>/<dtoType>/<op>
   *
   * Callers may override the suffix via `pathSuffix` for specialized endpoints.
   */
  private buildUrl(baseUrl: string, params: SvcClientCallParams): string {
    const suffix =
      params.pathSuffix ??
      `${encodeURIComponent(params.dtoType)}/${encodeURIComponent(params.op)}`;

    const trimmedBase = baseUrl.replace(/\/+$/, "");
    return `${trimmedBase}/api/${encodeURIComponent(params.slug)}/v${
      params.version
    }/${suffix}`;
  }

  /**
   * Build the JSON request body from the provided DtoBag, if applicable.
   *
   * - For GET requests: no body is sent, regardless of bag presence.
   * - For non-GET requests:
   *   - If a bag is provided, we serialize bag.toJson().
   *   - If no bag is provided, we send no body.
   *
   * The wire format is defined by ADR-0050 (Wire Bag Envelope).
   */
  private buildBody(params: SvcClientCallParams): string | undefined {
    if (params.method === "GET") {
      return undefined;
    }

    if (!params.bag) {
      return undefined;
    }

    // We trust DtoBag.toJson() to emit the canonical wire envelope.
    const json = params.bag.toJson();
    return JSON.stringify(json);
  }
}
