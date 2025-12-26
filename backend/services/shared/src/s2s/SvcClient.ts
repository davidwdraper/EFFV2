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
 *   - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
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
 * - Explicit-only mocking: tests must inject an ISvcClientTransport; there is
 *   no implicit behavior based on env flags in this class.
 *
 * Test propagation:
 * - If an inbound request was marked as a test run (via requestScope ALS),
 *   SvcClient auto-propagates x-nv-test-* headers across S2S hops so downstream
 *   services can downgrade expected-negative-test ERRORs to WARN.
 */

import {
  type ISvcClientLogger,
  type ISvcconfigResolver,
  type IKmsTokenFactory,
  type ISvcClientTransport,
  type RawResponse,
  type RequestIdProvider,
  type SvcClientCallParams,
  type SvcClientRawCallParams,
  type WireBagJson,
  type SvcTarget,
} from "./SvcClient.types";

import { getS2SPropagationHeaders } from "../http/requestScope";

/**
 * Default fetch-based transport with timeout.
 * This is the production transport unless a different transport is injected.
 */
class FetchSvcClientTransport implements ISvcClientTransport {
  public async execute(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    requestId: string;
    targetSlug: string;
    logPrefix: string;
  }): Promise<RawResponse> {
    const controller = new AbortController();
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutMs = request.timeoutMs ?? 30_000;

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
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

/**
 * Loud, intentionally useless transport.
 *
 * Purpose:
 * - Used when S2S_MOCKS=true but no deterministic test transport is provided.
 * - Prevents "tests passing" by silently returning placeholder responses.
 */
class BlockedSvcClientTransport implements ISvcClientTransport {
  private readonly reason: string;

  constructor(reason: string) {
    this.reason = reason;
  }

  public async execute(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    requestId: string;
    targetSlug: string;
    logPrefix: string;
  }): Promise<RawResponse> {
    throw new Error(
      `S2S_MOCKS_BLOCKED: Outbound S2S call was blocked by rails. ` +
        `Reason="${this.reason}". ` +
        `target="${request.targetSlug}", method="${request.method}", url="${request.url}", requestId="${request.requestId}". ` +
        "Ops: If this is a unit/handler test, inject a deterministic ISvcClientTransport that returns explicit canned responses."
    );
  }
}

export class SvcClient {
  private readonly callerSlug: string;
  private readonly callerVersion: number;

  private readonly logger: ISvcClientLogger;
  private readonly svcconfigResolver: ISvcconfigResolver;
  private readonly requestIdProvider: RequestIdProvider;
  private readonly tokenFactory?: IKmsTokenFactory;
  private readonly transport: ISvcClientTransport;

  constructor(options: {
    callerSlug: string;
    callerVersion: number;
    logger: ISvcClientLogger;
    svcconfigResolver: ISvcconfigResolver;
    requestIdProvider: RequestIdProvider;
    tokenFactory?: IKmsTokenFactory; // optional until S2S auth is wired
    /**
     * Optional transport injection (tests may supply a deterministic transport).
     * If omitted, defaults to fetch-based transport with timeout.
     */
    transport?: ISvcClientTransport;
    /**
     * Convenience rail: if provided, SvcClient will use a loud blocked transport.
     * This exists to prevent silent placeholder behavior when S2S_MOCKS=true.
     */
    blockS2SReason?: string;
  }) {
    this.callerSlug = options.callerSlug;
    this.callerVersion = options.callerVersion;
    this.logger = options.logger;
    this.svcconfigResolver = options.svcconfigResolver;
    this.requestIdProvider = options.requestIdProvider;
    this.tokenFactory = options.tokenFactory;

    if (options.transport) {
      this.transport = options.transport;
    } else if (options.blockS2SReason) {
      this.transport = new BlockedSvcClientTransport(options.blockS2SReason);
    } else {
      this.transport = new FetchSvcClientTransport();
    }
  }

  // ───────────────── DTO-BASED PATH (WORKERS) ─────────────────

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
        `SvcClient unauthorized call: caller="${this.callerSlug}" → target="${this.callerSlug}@v${this.callerVersion}" → "${target.slug}@v${target.version}" in env="${params.env}". Reason: ${reason}`
      );
    }

    const pathSuffix = this.buildCrudSuffix(params);

    const url = this.buildUrl(target.baseUrl, {
      slug: params.slug,
      version: params.version,
      pathSuffix,
      dtoType: params.dtoType,
      op: params.op,
    });

    // Auto-propagate test markers (and requestId) across S2S hops.
    // Important: we explicitly overwrite x-request-id with the effective requestId
    // so caller-supplied requestId always wins.
    const propagated = getS2SPropagationHeaders();

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...propagated,
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

    this.logger.debug("SvcClient.call.outbound_body", {
      requestId,
      targetSlug: target.slug,
      dtoType: params.dtoType,
      op: params.op,
      method: params.method,
      bodySnippet: body ? body.slice(0, 512) : "<empty>",
    });

    const { status, bodyText } = await this.transport.execute({
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

      throw new Error(
        `SvcClient: Non-success response from target="${target.slug}" (status=${status}). See logs for Problem+JSON payload.`
      );
    }

    this.logger.info("SvcClient.call.success", {
      requestId,
      targetSlug: target.slug,
      status,
    });

    return (parsed ?? {}) as WireBagJson;
  }

  // ───────────────── RAW PATH (GATEWAY EDGE) ─────────────────

  public async callRaw(params: SvcClientRawCallParams): Promise<RawResponse> {
    const requestId = params.requestId ?? this.requestIdProvider();
    const fullPath = params.fullPath;

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

    // Gateway contract: treat inbound path as opaque and identical.
    // No normalization, no reconstruction, no best-effort fixes.
    if (!fullPath.startsWith("/")) {
      this.logger.error("SvcClient.callRaw.fullPathNotAbsolute", {
        requestId,
        targetSlug: params.slug,
        targetVersion: params.version,
        fullPathSnippet: fullPath.slice(0, 256),
      });

      throw new Error(
        `SvcClient.callRaw requires 'fullPath' to start with "/". ` +
          `Caller="${this.callerSlug}" passed an invalid fullPath="${fullPath}".`
      );
    }

    if (!fullPath.startsWith("/api/")) {
      this.logger.error("SvcClient.callRaw.fullPathNotApi", {
        requestId,
        targetSlug: params.slug,
        targetVersion: params.version,
        fullPathSnippet: fullPath.slice(0, 256),
      });

      throw new Error(
        `SvcClient.callRaw requires 'fullPath' to include the inbound "/api/..." prefix (gateway passthrough contract). ` +
          `Caller="${this.callerSlug}" passed fullPath="${fullPath}".`
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
    const url = `${baseTrimmed}${fullPath}`;

    const propagated = getS2SPropagationHeaders();

    const headers: Record<string, string> = {
      ...propagated,
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

    // Never log raw header values (gateway may proxy secrets).
    this.logger.debug("SvcClient.callRaw.outbound_headers", {
      requestId,
      targetSlug: target.slug,
      headerKeys: Object.keys(headers),
    });

    const response = await this.transport.execute({
      url,
      method: params.method,
      headers,
      body,
      timeoutMs: params.timeoutMs,
      logPrefix: "SvcClient.callRaw",
      targetSlug: target.slug,
      requestId,
    });

    if (response.status < 200 || response.status >= 300) {
      this.logger.warn("SvcClient.callRaw.non2xx", {
        requestId,
        targetSlug: target.slug,
        status: response.status,
      });
    } else {
      this.logger.info("SvcClient.callRaw.success", {
        requestId,
        targetSlug: target.slug,
        status: response.status,
      });
    }

    return response;
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
   * Derive the CRUD path id.
   *
   * Invariant:
   * - There is only one canonical id: `_id` (rails-owned, idempotent).
   * - This helper never invents an id; it only finds one supplied explicitly
   *   or present in the singleton DTO body within the bag.
   *
   * Notes:
   * - We use the *wire body* shape (DtoBag.toBody()) rather than DTO internals.
   */
  private deriveCrudId(params: SvcClientCallParams): string | undefined {
    const explicit = (params.id ?? "").trim();
    if (explicit) return explicit;

    const bag = params.bag;
    if (!bag) return undefined;

    let raw: unknown;
    try {
      raw = bag.toBody() as unknown;
    } catch {
      return undefined;
    }

    // Supported shapes from buildDtoBody():
    // - { items: [...] }
    // - [...]
    // - { ...dto }
    const tryGetId = (obj: unknown): string | undefined => {
      if (!obj || typeof obj !== "object") return undefined;
      const v = (obj as any)._id;
      if (typeof v !== "string") return undefined;
      const s = v.trim();
      return s ? s : undefined;
    };

    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      if ("items" in (raw as Record<string, unknown>)) {
        const items = (raw as any).items;
        if (Array.isArray(items) && items.length === 1) {
          return tryGetId(items[0]);
        }
        return undefined;
      }

      // Singleton DTO object
      return tryGetId(raw);
    }

    if (Array.isArray(raw) && raw.length === 1) {
      return tryGetId(raw[0]);
    }

    return undefined;
  }

  private buildCrudSuffix(params: SvcClientCallParams): string {
    if (params.pathSuffix && params.pathSuffix.trim().length > 0) {
      const trimmed = params.pathSuffix.trim();
      return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    }

    const method = params.method.toUpperCase();
    const op = (params.op ?? "").toLowerCase();
    const dtoType = (params.dtoType ?? "").trim();

    if (!dtoType) {
      throw new Error(
        `SvcClient.buildCrudSuffix: dtoType is required for DTO-based S2S calls (slug="${params.slug}", op="${params.op}", method="${params.method}").`
      );
    }

    const encType = encodeURIComponent(dtoType);

    if (method === "PUT" && op === "create") return `/${encType}/create`;

    if (method === "PATCH" && op === "update") {
      const id = this.deriveCrudId(params);
      if (!id) {
        throw new Error(
          `SvcClient.buildCrudSuffix: PATCH update requires '_id' on the singleton DTO (or an explicit id) for dtoType="${dtoType}".`
        );
      }
      return `/${encType}/update/${encodeURIComponent(id)}`;
    }

    if (method === "GET" && op === "read") {
      const id = this.deriveCrudId(params);
      if (!id) {
        throw new Error(
          `SvcClient.buildCrudSuffix: GET read requires '_id' on the singleton DTO (or an explicit id) for dtoType="${dtoType}".`
        );
      }
      return `/${encType}/read/${encodeURIComponent(id)}`;
    }

    if (method === "DELETE" && op === "delete") {
      const id = this.deriveCrudId(params);
      if (!id) {
        throw new Error(
          `SvcClient.buildCrudSuffix: DELETE delete requires '_id' on the singleton DTO (or an explicit id) for dtoType="${dtoType}".`
        );
      }
      return `/${encType}/delete/${encodeURIComponent(id)}`;
    }

    if (method === "GET" && op === "list") return `/${encType}/list`;

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

    const normalizedSuffix = suffix.replace(/^\/+/, "");
    return `${trimmedBase}/api/${encodeURIComponent(params.slug)}/v${
      params.version
    }/${normalizedSuffix}`;
  }

  private buildDtoBody(params: SvcClientCallParams): string | undefined {
    const method = params.method.toUpperCase();
    const op = (params.op ?? "").toLowerCase();

    if (method === "GET" || method === "HEAD") return undefined;
    if (method === "DELETE" && op === "delete") return undefined;

    if (!params.bag) {
      throw new Error(
        `SvcClient.call: DTO-based call with method="${method}" and op="${params.op}" requires a DtoBag; none was provided.`
      );
    }

    const raw = params.bag.toBody() as unknown;

    let envelope: WireBagJson;

    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      "items" in (raw as Record<string, unknown>)
    ) {
      envelope = raw as WireBagJson;
    } else if (Array.isArray(raw)) {
      envelope = { items: raw } as WireBagJson;
    } else if (raw && typeof raw === "object") {
      envelope = { items: [raw] } as WireBagJson;
    } else {
      throw new Error(
        "SvcClient.call: DtoBag.toBody() returned an unsupported shape for DTO-based S2S call."
      );
    }

    return JSON.stringify(envelope);
  }
}

// ───────────────────────────────────────────
// Public type re-exports (for consumers like envBootstrap/appClient)
// ───────────────────────────────────────────

export type {
  ISvcClientLogger,
  ISvcconfigResolver,
  IKmsTokenFactory,
  ISvcClientTransport,
  RawResponse,
  RequestIdProvider,
  SvcClientCallParams,
  SvcClientRawCallParams,
  WireBagJson,
  SvcTarget,
} from "./SvcClient.types";
