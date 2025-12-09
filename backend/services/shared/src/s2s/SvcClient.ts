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
 *   - ADR-0069 (Multi-Format Controllers & DTO Body Semantics)
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
  type SvcTarget,
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

    const pathSuffix = this.buildCrudSuffix(params);

    const url = this.buildUrl(target.baseUrl, {
      slug: params.slug,
      version: params.version,
      pathSuffix,
      // dtoType/op remain for legacy callers that might not pass pathSuffix,
      // but we always pass an explicit suffix for CRUD rails now.
      dtoType: params.dtoType,
      op: params.op,
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

    // Outbound body triage: prove exactly what we're putting on the wire.
    this.logger.debug("SvcClient.call.outbound_body", {
      requestId,
      targetSlug: target.slug,
      dtoType: params.dtoType,
      op: params.op,
      method: params.method,
      bodySnippet: body ? body.slice(0, 512) : "<empty>",
    });

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
   * - Requires `fullPath`: the exact inbound path including `/api` and any query string
   *   (e.g. `/api/auth/v1/auth/create?foo=bar`).
   * - Applies "same path, different port": only host/port are changed using svcconfig.
   * - Never parses JSON.
   * - Never throws based on HTTP status (only network/timeout/errors).
   * - Returns { status, headers, bodyText }; callers decide how to handle it.
   */
  public async callRaw(params: SvcClientRawCallParams): Promise<RawResponse> {
    const requestId = params.requestId ?? this.requestIdProvider();

    const fullPath = (params as any).fullPath as string | undefined;

    this.logger.debug("SvcClient.callRaw.begin", {
      requestId,
      callerSlug: this.callerSlug,
      callerVersion: this.callerVersion,
      env: params.env,
      targetSlug: params.slug,
      targetVersion: params.version,
      method: params.method,
      fullPath,
    });

    if (!fullPath || !fullPath.trim()) {
      this.logger.error("SvcClient.callRaw.missingFullPath", {
        requestId,
        targetSlug: params.slug,
        targetVersion: params.version,
      });

      throw new Error(
        `SvcClient.callRaw requires 'fullPath' (inbound URL path including /api). ` +
          `Caller="${this.callerSlug}" attempted raw call to "${params.slug}@v${params.version}" without fullPath.`
      );
    }

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

    const baseTrimmed = target.baseUrl.replace(/\/+$/, "");
    const normalizedFullPath = fullPath.startsWith("/")
      ? fullPath
      : `/${fullPath}`;
    const url = `${baseTrimmed}${normalizedFullPath}`;

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

    this.logger.debug("SvcClient.callRaw.outbound_headers", {
      requestId,
      targetSlug: target.slug,
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
   * Build the CRUD path suffix for typed routes.
   *
   * Rules (worker CRUD rails):
   * - PUT    create → /:dtoType/create
   * - PATCH  update → /:dtoType/update/:id
   * - GET    read   → /:dtoType/read/:id
   * - DELETE delete → /:dtoType/delete/:id
   * - GET    list   → /:dtoType/list
   *
   * If params.pathSuffix is provided, it wins (for non-CRUD/custom routes).
   * Otherwise we derive the suffix from method/op/dtoType/id.
   */
  private buildCrudSuffix(params: SvcClientCallParams): string {
    if (params.pathSuffix && params.pathSuffix.trim().length > 0) {
      // Caller is explicitly overriding the suffix; trust it.
      const trimmed = params.pathSuffix.trim();
      return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    }

    const method = params.method.toUpperCase();
    const op = (params.op ?? "").toLowerCase();
    const dtoType = (params.dtoType ?? "").trim();
    const id = (params as any).id as string | undefined;

    if (!dtoType) {
      throw new Error(
        `SvcClient.buildCrudSuffix: dtoType is required for DTO-based S2S calls (slug="${params.slug}", op="${params.op}", method="${params.method}").`
      );
    }

    const encType = encodeURIComponent(dtoType);
    const encId = id ? encodeURIComponent(id) : undefined;

    // CREATE: PUT /:dtoType/create
    if (method === "PUT" && op === "create") {
      return `/${encType}/create`;
    }

    // UPDATE: PATCH /:dtoType/update/:id
    if (method === "PATCH" && op === "update") {
      if (!encId) {
        throw new Error(
          `SvcClient.buildCrudSuffix: PATCH update requires 'id' for dtoType="${dtoType}".`
        );
      }
      return `/${encType}/update/${encId}`;
    }

    // READ: GET /:dtoType/read/:id
    if (method === "GET" && op === "read") {
      if (!encId) {
        throw new Error(
          `SvcClient.buildCrudSuffix: GET read requires 'id' for dtoType="${dtoType}".`
        );
      }
      return `/${encType}/read/${encId}`;
    }

    // DELETE: DELETE /:dtoType/delete/:id
    if (method === "DELETE" && op === "delete") {
      if (!encId) {
        throw new Error(
          `SvcClient.buildCrudSuffix: DELETE delete requires 'id' for dtoType="${dtoType}".`
        );
      }
      return `/${encType}/delete/${encId}`;
    }

    // LIST: GET /:dtoType/list
    if (method === "GET" && op === "list") {
      return `/${encType}/list`;
    }

    // Fallback: preserve legacy behavior for non-CRUD ops.
    const encOp = encodeURIComponent(params.op ?? "");
    return `/${encType}/${encOp}`;
  }

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

    // Allow callers to pass a suffix that starts with "/" or not.
    const normalizedSuffix = suffix.replace(/^\/+/, "");
    return `${trimmedBase}/api/${encodeURIComponent(params.slug)}/v${
      params.version
    }/${normalizedSuffix}`;
  }

  /**
   * Build the JSON request body from the provided DtoBag, if applicable.
   *
   * - For GET/HEAD requests: no body is sent, regardless of bag presence.
   * - For DELETE delete-by-id (canonical CRUD): no body is sent; id in path is sufficient.
   * - For other non-GET methods:
   *   - A DtoBag is required; we serialize it to the canonical wire bag envelope.
   *
   * The wire format is defined by ADR-0050 (Wire Bag Envelope).
   */
  private buildDtoBody(params: SvcClientCallParams): string | undefined {
    const method = params.method.toUpperCase();
    const op = (params.op ?? "").toLowerCase();

    // No body for safe/idempotent reads.
    if (method === "GET" || method === "HEAD") {
      return undefined;
    }

    // For canonical DELETE-by-id CRUD route, we do not send a body.
    if (method === "DELETE" && op === "delete") {
      return undefined;
    }

    if (!params.bag) {
      // Fail-fast for all other non-GET/HEAD methods that require a bag (create, update, etc).
      throw new Error(
        `SvcClient.call: DTO-based call with method="${method}" and op="${params.op}" requires a DtoBag; none was provided.`
      );
    }

    // Whatever the bag's notion of "body" is, normalize it into the canonical
    // wire bag envelope: { items: [...], meta?: {...} }.
    const raw = params.bag.toBody() as unknown;

    let envelope: WireBagJson;

    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      "items" in (raw as Record<string, unknown>)
    ) {
      // Already a wire bag envelope; trust it.
      envelope = raw as WireBagJson;
    } else if (Array.isArray(raw)) {
      // Treat as "items" array with no meta.
      envelope = { items: raw } as WireBagJson;
    } else if (raw && typeof raw === "object") {
      // Single DTO-like object; wrap it.
      envelope = { items: [raw] } as WireBagJson;
    } else {
      // Completely unexpected; better to fail loudly than send junk.
      throw new Error(
        "SvcClient.call: DtoBag.toBody() returned an unsupported shape for DTO-based S2S call."
      );
    }

    return JSON.stringify(envelope);
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

// ───────────────────────────────────────────
// Public type re-exports (for consumers like envBootstrap/appClient)
// ───────────────────────────────────────────

export type {
  ISvcClientLogger,
  ISvcconfigResolver,
  IKmsTokenFactory,
  RawResponse,
  RequestIdProvider,
  SvcClientCallParams,
  SvcClientRawCallParams,
  WireBagJson,
  SvcTarget,
} from "./SvcClient.types";
