// backend/services/shared/src/prompts/PromptsClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *
 * Purpose:
 * - Central client for all prompt/catalog lookups (system + UI).
 * - Fetches templates from the *prompt* service via canonical DTO-based SvcClient.call().
 * - Handles missing prompts per ADR-0064:
 *   - Log once at PROMPT level per (language, promptKey).
 *   - Negative-cache misses per (language, promptKey).
 *   - For NON-English languages:
 *       - If the requested language is missing, attempt English ("en").
 *       - If "en" exists, return the English text instead of the key.
 *       - If both are missing, fall back to the promptKey.
 *
 * Infra semantics (REQUIRED INFRA):
 * - If prompt infrastructure is unavailable (svcClient call fails / prompt service down / svcconfig missing),
 *   PromptsClient throws PromptsInfraError so the caller can hard-fail safely.
 *
 * Notes:
 * - Cache is in-memory, process-local:
 *   - Positive cache: (lang::key) → template.
 *   - Negative cache: Set of (lang::key) proven missing.
 * - Prompt record version:
 *   - For now, default to 1 unless overridden by meta.promptVersion.
 */

import type { IBoundLogger } from "../logger/Logger";
import { SvcClient, type WireBagJson } from "../s2s/SvcClient";

type Json = Record<string, unknown>;

type PromptsClientDeps = {
  /** Bound logger with service/request context already attached where possible. */
  logger: IBoundLogger;

  /** The slug of the *current* service (for logging). */
  serviceSlug: string;

  /** Canonical shared SvcClient for S2S calls. */
  svcClient: SvcClient;

  /**
   * REQUIRED: Provide the current env label (e.g., "dev", "stage", "prod").
   * We do not guess this and we do not default it.
   */
  getEnvLabel: () => string;

  /**
   * Optional hook to obtain the current requestId for log correlation.
   * If not provided, caller may pass requestId via meta per call.
   */
  getRequestId?: () => string | undefined;

  /**
   * Prompts service slug + API version.
   * Slug: "prompt"
   * Version: 1 (API major)
   */
  promptsSlug?: string;
  promptsApiVersion?: number;
};

export type RenderMeta = {
  /**
   * Internal error code, UI component id, or any other context.
   * This is logged on missing prompt events.
   */
  code?: string;

  /**
   * Optional prompt record version (NOT the service API version).
   * This maps to the `:version` param in:
   *   GET /api/prompt/v1/prompt/read/:language/:version/:promptKey
   */
  promptVersion?: number;

  [key: string]: unknown;
};

export type PromptsInfraFailureReason =
  | "PROMPTS_ENV_LABEL_MISSING"
  | "PROMPTS_SERVICE_UNAVAILABLE";

export class PromptsInfraError extends Error {
  public readonly reason: PromptsInfraFailureReason;
  public readonly promptKey: string;
  public readonly language: string;
  public readonly serviceSlug: string;

  constructor(params: {
    reason: PromptsInfraFailureReason;
    message: string;
    promptKey: string;
    language: string;
    serviceSlug: string;
  }) {
    super(params.message);
    this.name = "PromptsInfraError";
    this.reason = params.reason;
    this.promptKey = params.promptKey;
    this.language = params.language;
    this.serviceSlug = params.serviceSlug;
  }

  public static is(err: unknown): err is PromptsInfraError {
    return err instanceof PromptsInfraError;
  }
}

export class PromptsClient {
  private readonly logger: IBoundLogger;
  private readonly svcClient: SvcClient;
  private readonly serviceSlug: string;
  private readonly getRequestId?: () => string | undefined;
  private readonly getEnvLabel: () => string;

  private readonly promptsSlug: string;
  private readonly promptsApiVersion: number;

  // Positive cache: (lang::promptKey) → template string
  private readonly templates = new Map<string, string>();
  // Negative cache: (lang::promptKey) proven missing (logged once)
  private readonly missing = new Set<string>();

  constructor(deps: PromptsClientDeps) {
    this.logger = deps.logger;
    this.svcClient = deps.svcClient;
    this.serviceSlug = deps.serviceSlug;
    this.getRequestId = deps.getRequestId;
    this.getEnvLabel = deps.getEnvLabel;

    this.promptsSlug = deps.promptsSlug ?? "prompt";
    this.promptsApiVersion = deps.promptsApiVersion ?? 1;
  }

  /**
   * Render a localized prompt string for the given key and language.
   *
   * Behavior:
   * - Try requested language:
   *   - If found: interpolate and return.
   *   - If missing: log PROMPT once, then:
   *     - Try English ("en") as fallback.
   * - Try English:
   *   - If found: interpolate and return.
   *   - If missing: log PROMPT once (for "en"), then return promptKey.
   *
   * Infra behavior:
   * - If prompt infra is unavailable, throws PromptsInfraError.
   */
  public async render(
    language: string,
    promptKey: string,
    params?: Record<string, string | number>,
    meta: RenderMeta = {}
  ): Promise<string> {
    const template =
      (await this.getTemplateWithFallback(language, promptKey, meta)) ?? null;

    if (template === null) {
      // Both requested language and English missing: fall back to key.
      return promptKey;
    }

    return this.interpolate(template, params);
  }

  /**
   * Return the raw template if available, applying the same language+English
   * fallback semantics as render(), but without interpolation.
   *
   * Infra behavior:
   * - If prompt infra is unavailable, throws PromptsInfraError.
   */
  public async getTemplate(
    language: string,
    promptKey: string,
    meta: RenderMeta = {}
  ): Promise<string | null> {
    const template = await this.getTemplateWithFallback(
      language,
      promptKey,
      meta
    );
    return template ?? null;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────────

  private toCacheKey(language: string, promptKey: string): string {
    return `${language}::${promptKey}`;
  }

  /**
   * Try requested language first; if missing and language !== "en",
   * try English as a fallback.
   */
  private async getTemplateWithFallback(
    language: string,
    promptKey: string,
    meta: RenderMeta
  ): Promise<string | undefined> {
    // 1) Primary language
    const primary = await this.getOrFetchTemplate(language, promptKey, meta);
    if (primary !== null) return primary ?? undefined;

    // 2) Fallback to English if requested language is not English
    if (language !== "en") {
      const fallbackMeta: RenderMeta = {
        ...meta,
        fallbackForLanguage: language,
      };
      const enTemplate = await this.getOrFetchTemplate(
        "en",
        promptKey,
        fallbackMeta
      );
      return enTemplate ?? undefined;
    }

    // English itself missing
    return undefined;
  }

  /**
   * Core lookup for a specific (language, promptKey) pair.
   *
   * - Uses positive & negative caches.
   * - On first miss per (lang, key), logs PROMPT and negative-caches.
   * - Returns:
   *   - string  → template found
   *   - null    → definitively missing for this language
   *
   * Infra behavior:
   * - If fetch fails due to infra, fetchTemplate throws PromptsInfraError.
   */
  private async getOrFetchTemplate(
    language: string,
    promptKey: string,
    meta: RenderMeta
  ): Promise<string | null> {
    const cacheKey = this.toCacheKey(language, promptKey);

    // Positive cache
    const cached = this.templates.get(cacheKey);
    if (cached !== undefined) return cached;

    // Negative cache → already known missing, no log, no remote call
    if (this.missing.has(cacheKey)) return null;

    // Not cached yet → call prompts service
    const template = await this.fetchTemplate(language, promptKey, meta);

    if (template == null) {
      // First time we learn this (lang, key) is missing:
      this.logMissingPromptOnce(cacheKey, language, promptKey, meta);
      return null;
    }

    // Positive cache it
    this.templates.set(cacheKey, template);
    return template;
  }

  /**
   * Fetch a single template from the prompts service using canonical SvcClient.call().
   *
   * Missing-key semantics:
   * - Service returns 200 with items=[] → return null.
   *
   * Infra semantics (REQUIRED INFRA):
   * - Any SvcClient failure (svcconfig/transport/service down) → throw PromptsInfraError.
   */
  private async fetchTemplate(
    language: string,
    promptKey: string,
    meta: RenderMeta
  ): Promise<string | null> {
    const envLabel = (this.getEnvLabel?.() ?? "").trim();
    if (!envLabel) {
      throw new PromptsInfraError({
        reason: "PROMPTS_ENV_LABEL_MISSING",
        message:
          "PromptsClient: envLabel is required but was empty (getEnvLabel() returned '').",
        promptKey,
        language,
        serviceSlug: this.serviceSlug,
      });
    }

    const requestId = this.getRequestId ? this.getRequestId() : undefined;

    // Prompt record version (not API version)
    const recordVersion =
      typeof meta.promptVersion === "number" &&
      Number.isFinite(meta.promptVersion)
        ? Math.trunc(meta.promptVersion)
        : 1;

    const pathSuffix = `/prompt/read/${encodeURIComponent(
      language
    )}/${encodeURIComponent(String(recordVersion))}/${encodeURIComponent(
      promptKey
    )}`;

    let wire: WireBagJson;

    try {
      wire = await this.svcClient.call({
        env: envLabel,
        slug: this.promptsSlug,
        version: this.promptsApiVersion,
        dtoType: "prompt",
        op: "read",
        method: "GET",
        pathSuffix,
        requestId,
        // GET has no body; no bag.
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? "unknown");

      // Do NOT log stacks here; caller (ControllerJsonBase) logs once and hard-fails.
      throw new PromptsInfraError({
        reason: "PROMPTS_SERVICE_UNAVAILABLE",
        message: msg,
        promptKey,
        language,
        serviceSlug: this.serviceSlug,
      });
    }

    return this.extractTemplateField(wire);
  }

  /**
   * Extract the `template` field from the canonical wire bag.
   * Expected shape: { items: [{ template: string, ... }] }
   *
   * Missing-key behavior:
   * - items=[] (or no template) → null (treated as missing prompt).
   */
  private extractTemplateField(wire: WireBagJson | unknown): string | null {
    if (!wire || typeof wire !== "object") return null;

    const obj = wire as unknown as Json;
    const items = obj["items"];

    if (!Array.isArray(items) || items.length === 0) return null;

    const first = items[0];
    if (!first || typeof first !== "object") return null;

    const template = (first as Json)["template"];
    return typeof template === "string" && template.trim().length > 0
      ? template
      : null;
  }

  /**
   * Simple `{name}` interpolation for parameterized templates.
   * - Unknown placeholders remain `{name}`.
   * - Extra params are ignored.
   */
  private interpolate(
    template: string,
    params?: Record<string, string | number>
  ): string {
    if (!params || Object.keys(params).length === 0) return template;

    return template.replace(/\{([^}]+)\}/g, (match, key) => {
      const value = params[key];
      if (value === undefined || value === null) return match;
      return String(value);
    });
  }

  /**
   * FIRST-time missing prompt per (language, promptKey) → log PROMPT + add to
   * negative cache. Subsequent lookups for that (lang, key) do NOT log again.
   */
  private logMissingPromptOnce(
    cacheKey: string,
    language: string,
    promptKey: string,
    meta: RenderMeta
  ): void {
    // Mark negative-cache BEFORE logging to guard against re-entry.
    this.missing.add(cacheKey);

    const requestId = this.getRequestId ? this.getRequestId() : undefined;

    this.logger.prompt(
      {
        promptKey,
        language,
        serviceSlug: this.serviceSlug,
        requestId,
        ...meta,
      },
      "Missing prompt in catalog."
    );
  }
}
