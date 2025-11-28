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
 *   - ADR-0066 (Gateway Raw-Payload Passthrough for S2S Calls)
 *
 * Purpose:
 * - Canonical S2S HTTP client for all NV services.
 * - Provides two paths:
 *   - DTO-based (call): worker ↔ worker, DtoBag-only.
 *   - Raw-based (callRaw): gateway edge passthrough, opaque JSON.
 *
 * Notes:
 * - Transport-only: never inspects DTO internals.
 * - JWT/mTLS hooks live behind IKmsTokenFactory.
 */

import {
  type ISvcClientLogger,
  type ISvcconfigResolver,
  type IKmsTokenFactory,
  type RawResponse,
  type RequestIdProvider,
  type SvcClientCallParams,
  type SvcClientRawCallParams,
  type WireBagJson,
} from "./SvcClient.types";

export class SvcClient {
  private readonly callerSlug: string;
  private readonly callerVersion: number;

  private readonly logger: ISvcClientLogger;
  private readonly svcconfigResolver: ISvcconfigResolver;
  private readonly requestIdProvider: RequestIdProvider;
  private readonly tokenFactory?: IKmsTokenFactory;

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

  // ───────────────── DTO-BASED PATH (WORKERS) ─────────────────

  /**
   * Execute a DTO-based service-to-service call and return the wire bag JSON envelope.
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

    const url = this.buildUrl(target.baseUrl, {
      slug: params.slug,
      version: params.version,
      dtoType: params.dtoType,
      op: params.op,
      pathSuffix: params.pathSuffix,
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-service-name": this.callerSlug,
      "x-api-version": String(this.callerVersion),
      ...(params.extraHeaders ?? {}),
    };

    await this.attachTokenIfConfigured({
      env: params.env,
      targetSlug: target.slug,
      targetVersion: target.version,
      headers,
    });

    const body = this.buildDtoBody(params);

    const { status, bodyText } = await this.fetchWithTimeout({
      url,
      method: params.method,
      headers,
      body,
      timeoutMs: params.timeoutMs,
      logPrefix: "SvcClient.call",
      targetSlug: target.slug,
      requestId,
    });

    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      this.logger.error("SvcClient.call.response.jsonError", {
        requestId,
        targetSlug: target.slug,
        status,
        bodySnippet: bodyText.slice(0, 512),
      });
      throw new Error(
        `SvcClient: Failed to parse JSON from target="${target.slug}" (status=${status}).`
      );
    }

    if (status < 200 || status >= 300) {
      this.logger.warn("SvcClient.call.non2xx", {
        requestId,
        targetSlug: target.slug,
        status,
        body: parsed,
      });

      // We assume Problem+JSON, but we don't enforce schema here.
      throw new Error(
        `SvcClient: Non-success response from target="${target.slug}" (status=${status}). See logs for Problem+JSON payload.`
      );
    }

    this.logger.info("SvcClient.call.success", {
      requestId,
      targetSlug: target.slug,
      status,
    });

    const wire = (parsed ?? {}) as WireBagJson;
    return wire;
  }

  // ───────────────── RAW PATH (GATEWAY EDGE) ─────────────────

  /**
   * Raw-body S2S call (ADR-0066).
   *
   * Intended mainly for the gateway edge, where:
   * - The JSON payload is treated as opaque.
   * - We still want svcconfig-based resolution, call-graph enforcement,
   *   and canonical S2S headers.
   *
   * Behavior:
   * - Never parses JSON.
   * - Never throws based on HTTP status (only network/timeout/errors).
   * - Returns { status, headers, bodyText }; callers decide how to handle it.
   */
  public async callRaw(params: SvcClientRawCallParams): Promise<RawResponse> {
    const requestId = params.requestId ?? this.requestIdProvider();

    this.logger.debug("SvcClient.callRaw.begin", {
      requestId,
      callerSlug: this.callerSlug,
      callerVersion: this.callerVersion,
      env: params.env,
      targetSlug: params.slug,
      targetVersion: params.version,
      method: params.method,
      pathSuffix: params.pathSuffix,
    });

    const target = await this.svcconfigResolver.resolveTarget(
      params.env,
      params.slug,
      params.version
    );

    if (!target.isAuthorized) {
      const reason = target.reasonIfNotAuthorized ?? "No reason provided";
      this.logger.warn("SvcClient.callRaw.unauthorized", {
        requestId,
        env: params.env,
        callerSlug: this.callerSlug,
        targetSlug: target.slug,
        targetVersion: target.version,
        reason,
      });

      throw new Error(
        `SvcClient unauthorized call (raw): caller="${this.callerSlug}" → target="${target.slug}@v${target.version}" in env="${params.env}". Reason: ${reason}`
      );
    }

    const url = this.buildUrl(target.baseUrl, {
      slug: params.slug,
      version: params.version,
      pathSuffix: params.pathSuffix,
    });

    const headers: Record<string, string> = {
      "x-request-id": requestId,
      "x-service-name": this.callerSlug,
      "x-api-version": String(this.callerVersion),
      ...(params.extraHeaders ?? {}),
    };

    const body =
      params.method === "GET" || params.body === undefined
        ? undefined
        : typeof params.body === "string"
        ? params.body
        : JSON.stringify(params.body);

    if (body && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }

    await this.attachTokenIfConfigured({
      env: params.env,
      targetSlug: target.slug,
      targetVersion: target.version,
      headers,
    });

    const {
      status,
      bodyText,
      headers: responseHeaders,
    } = await this.fetchWithTimeout({
      url,
      method: params.method,
      headers,
      body,
      timeoutMs: params.timeoutMs,
      logPrefix: "SvcClient.callRaw",
      targetSlug: target.slug,
      requestId,
    });

    if (status < 200 || status >= 300) {
      this.logger.warn("SvcClient.callRaw.non2xx", {
        requestId,
        targetSlug: target.slug,
        status,
      });
    } else {
      this.logger.info("SvcClient.callRaw.success", {
        requestId,
        targetSlug: target.slug,
        status,
      });
    }

    return {
      status,
      headers: responseHeaders,
      bodyText,
    };
  }

  // ───────────────── COMPAT STUB ─────────────────

  /**
   * Temporary adapter for older code that expects a `callBySlug(...)` API.
   *
   * NOTE:
   * - This is *intentionally* not implemented yet.
   * - PromptsClient currently depends on the existence of this method at
   *   type level; calling it will fail-fast until prompts routes are wired
   *   properly using DTO-first SvcClient.call().
   *
   * DO NOT build new code against this signature. New S2S calls must use
   * SvcClient.call() or SvcClient.callRaw().
   */
  public async callBySlug(
    slug: string,
    version: string,
    route: string,
    _message: unknown,
    _options?: Record<string, unknown>
  ): Promise<unknown> {
    this.logger.error("SvcClient.callBySlug.unimplemented", {
      slug,
      version,
      route,
      hint: "callBySlug is a compatibility stub. Wire a DTO-based prompts route and switch PromptsClient over to SvcClient.call().",
    });

    throw new Error(
      `SvcClient.callBySlug is not implemented. Caller="${this.callerSlug}" attempted to call slug="${slug}" route="${route}". ` +
        "Use DTO-based SvcClient.call() once prompts/svcconfig rails are in place."
    );
  }

  // ───────────────── INTERNAL HELPERS ─────────────────

  private async attachTokenIfConfigured(opts: {
    env: string;
    targetSlug: string;
    targetVersion: number;
    headers: Record<string, string>;
  }): Promise<void> {
    if (!this.tokenFactory) return;

    const token = await this.tokenFactory.mintToken({
      env: opts.env,
      callerSlug: this.callerSlug,
      targetSlug: opts.targetSlug,
      targetVersion: opts.targetVersion,
    });

    opts.headers["authorization"] = `Bearer ${token}`;
  }

  /**
   * Build the target URL based on the baseUrl and the route convention.
   *
   * Convention (SOP/LDD):
   *   http(s)://host:port/api/<slug>/v<version>/<dtoType>/<op>
   *
   * Callers may override the suffix via `pathSuffix` for specialized endpoints.
   */
  private buildUrl(
    baseUrl: string,
    params: {
      slug: string;
      version: number;
      dtoType?: string;
      op?: string;
      pathSuffix?: string;
    }
  ): string {
    const trimmedBase = baseUrl.replace(/\/+$/, "");

    let suffix = params.pathSuffix;
    if (!suffix) {
      const dtoType = params.dtoType ?? "";
      const op = params.op ?? "";
      suffix = `${encodeURIComponent(dtoType)}/${encodeURIComponent(op)}`;
    }

    const normalizedSuffix = suffix.replace(/^\/+/, "");
    return `${trimmedBase}/api/${encodeURIComponent(params.slug)}/v${
      params.version
    }/${normalizedSuffix}`;
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
  private buildDtoBody(params: SvcClientCallParams): string | undefined {
    if (params.method === "GET") return undefined;
    if (!params.bag) return undefined;
    const json = params.bag.toJson();
    return JSON.stringify(json);
  }

  private async fetchWithTimeout(opts: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    logPrefix: string;
    targetSlug: string;
    requestId: string;
  }): Promise<{
    status: number;
    bodyText: string;
    headers: Record<string, string>;
  }> {
    const controller = new AbortController();
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutMs = opts.timeoutMs ?? 30_000;

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await fetch(opts.url, {
        method: opts.method,
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
      });

      const bodyText = await response.text();
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      return { status: response.status, bodyText, headers: responseHeaders };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
}
