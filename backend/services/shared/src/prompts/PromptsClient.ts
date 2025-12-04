// backend/services/shared/src/prompt/PromptsClient.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0064 (Prompts Service, PromptsClient, Missing-Prompt Semantics)
 *
 * Purpose:
 * - Central client for all prompt/catalog lookups (system + UI).
 * - Provides parameterized rendering of template strings returned by the
 *   prompts service (via SvcClient).
 * - Handles missing prompts according to ADR-0064:
 *   - Log once at PROMPT level per (language, promptKey).
 *   - Negative-cache misses per (language, promptKey).
 *   - For NON-English languages:
 *       - If the requested language is missing, attempt English ("en").
 *       - If "en" exists, return the English text instead of the key.
 *       - If both are missing, fall back to the promptKey.
 *
 * Notes:
 * - Cache is in-memory, process-local:
 *   - Positive cache: (lang::key) → template.
 *   - Negative cache: Set of (lang::key) proven missing.
 * - Flush semantics and TTL/bulk-fetch are deferred to a later iteration.
 */

import type { IBoundLogger } from "../logger/Logger";

type Json = Record<string, unknown>;

type SvcClientLike = {
  callBySlug: (
    slug: string,
    version: string,
    route: string,
    message: unknown,
    options?: Record<string, unknown>
  ) => Promise<unknown>;
};

type PromptsClientDeps = {
  /** Bound logger with service/request context already attached where possible. */
  logger: IBoundLogger;

  /** The slug of the *current* service (for logging). */
  serviceSlug: string;

  /** Shared SvcClient for S2S calls. */
  svcClient: SvcClientLike;

  /**
   * Optional hook to obtain the current requestId for log correlation.
   * If not provided, caller may pass requestId via meta per call.
   */
  getRequestId?: () => string | undefined;

  /**
   * Prompts service slug + version; defaults align with ADR-0064.
   * Slug: "prompts"
   * Version: "v1"
   */
  promptsSlug?: string;
  promptsVersion?: string;
};

type RenderMeta = {
  /**
   * Internal error code, UI component id, or any other context.
   * This is logged on missing prompt events.
   */
  code?: string;
  [key: string]: unknown;
};

export class PromptsClient {
  private readonly logger: IBoundLogger;
  private readonly svcClient: SvcClientLike;
  private readonly serviceSlug: string;
  private readonly getRequestId?: () => string | undefined;

  private readonly promptsSlug: string;
  private readonly promptsVersion: string;

  // Positive cache: (lang::promptKey) → template string
  private readonly templates = new Map<string, string>();
  // Negative cache: (lang::promptKey) proven missing (logged once)
  private readonly missing = new Set<string>();

  constructor(deps: PromptsClientDeps) {
    this.logger = deps.logger;
    this.svcClient = deps.svcClient;
    this.serviceSlug = deps.serviceSlug;
    this.getRequestId = deps.getRequestId;
    this.promptsSlug = deps.promptsSlug ?? "prompt";
    this.promptsVersion = deps.promptsVersion ?? "v1";
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
    const template = await this.fetchTemplate(language, promptKey);

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
   * Fetch a single template from the prompts service.
   *
   * Assumptions for this first pass:
   * - Prompts service exposes a "read by key" style route that accepts
   *   promptKey + language and returns a DtoBag<PromptDto>.
   * - The DTO has a `template` field.
   *
   * If the route signature differs, adapt this method only.
   */
  private async fetchTemplate(
    language: string,
    promptKey: string
  ): Promise<string | null> {
    let response: unknown;

    try {
      response = await this.svcClient.callBySlug(
        this.promptsSlug,
        this.promptsVersion,
        "/api/prompt/v1/prompt/readByKey",
        {
          promptKey,
          language,
        }
      );
    } catch (err) {
      // Transport/service failure must *not* break the app; treat as missing.
      this.logger.error(
        {
          err: this.logger.serializeError(err),
          promptKey,
          language,
          serviceSlug: this.serviceSlug,
        },
        "PromptsClient: error calling prompts service."
      );
      return null;
    }

    return this.extractTemplateField(response);
  }

  /**
   * Extract the `template` field from a DtoBag-like response.
   * Expected shape: { items: [{ template: string, ... }] }
   */
  private extractTemplateField(response: unknown): string | null {
    if (!response || typeof response !== "object") return null;

    const obj = response as Json;
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
