// backend/services/shared/src/writer/AuditWriterFactory.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - High-level, **registry-driven** factory to instantiate `IAuditWriter`s.
 * - Decouples WAL from destination specifics and avoids switch/case drift.
 *
 * Design:
 * - Prefer a **registered name**; fallback to **dynamic module** when needed.
 * - Zero environment reads here; callers provide config explicitly.
 * - Optional allowlist guards dynamic imports.
 */

import type { IAuditWriter } from "./IAuditWriter";
import {
  createWriter,
  createWriterByName,
  createWriterFromModule,
  listRegisteredWriters,
} from "./WriterRegistry";

export type AuditWriterConfig<T = unknown> = {
  /**
   * Preferred: a registered writer name (e.g., "mock", "db", "http").
   * If provided, `module` is ignored.
   */
  name?: string;

  /**
   * Optional module specifier (path or package) for dynamic import.
   * Used only if `name` is not provided. Callers should gate this via allowlist.
   */
  module?: string;

  /**
   * Options forwarded to the writer’s factory/constructor.
   * The shape is writer-specific; this type is intentionally opaque.
   */
  options?: T;

  /**
   * Optional allowlist for dynamic modules. If provided and `module` is set,
   * the module MUST exactly match one of these entries.
   */
  allowModules?: readonly string[];
};

export class AuditWriterFactory {
  /**
   * Create an `IAuditWriter` using a registered name or dynamic module.
   * - If `config.name` is set → instantiate by name.
   * - Else if `config.module` is set → (optionally) validate against allowlist, then dynamic import.
   * - Else → throws with helpful diagnostics.
   */
  public static async create<T = unknown>(
    config: AuditWriterConfig<T>
  ): Promise<IAuditWriter> {
    if (!config || (config.name == null && config.module == null)) {
      const e = new Error(
        "AuditWriterFactory.create: either `name` or `module` must be provided"
      );
      (e as any).code = "WRITER_FACTORY_BAD_CONFIG";
      throw e;
    }

    if (config.name) {
      try {
        return createWriterByName<T>(config.name, config.options);
      } catch (err) {
        // Enrich error with discovery context
        const e = new Error(
          `AuditWriterFactory: unknown registered writer "${config.name}"`
        );
        (e as any).code = "WRITER_UNKNOWN";
        (e as any).known = listRegisteredWriters();
        (e as any).cause = err;
        throw e;
        // (caller may choose to fallback to module path if they set it as well)
      }
    }

    // Dynamic module path flow
    const mod = String(config.module ?? "");
    if (mod.length === 0) {
      const e = new Error(
        "AuditWriterFactory.create: empty module specifier; set `name` or a non-empty `module`"
      );
      (e as any).code = "WRITER_FACTORY_EMPTY_MODULE";
      throw e;
    }

    // Optional allowlist enforcement
    if (Array.isArray(config.allowModules) && config.allowModules.length > 0) {
      const ok = config.allowModules.includes(mod);
      if (!ok) {
        const e = new Error(
          `AuditWriterFactory: module "${mod}" not in allowlist`
        );
        (e as any).code = "WRITER_MODULE_NOT_ALLOWED";
        (e as any).allow = config.allowModules.slice();
        throw e;
      }
    }

    try {
      return await createWriterFromModule<T>(mod, config.options);
    } catch (err) {
      // Provide a compact diagnostic payload; avoid leaking full options if sensitive.
      const e = new Error(
        `AuditWriterFactory: failed to create writer from module "${mod}"`
      );
      (e as any).code = "WRITER_MODULE_INSTANTIATE_FAILED";
      (e as any).cause = err;
      throw e;
    }
  }

  /**
   * Convenience hybrid that tries a registered name first, then falls back to module import if provided.
   * Equivalent to:
   *   if (name in registry) return byName(name);
   *   else return fromModule(module);
   */
  public static async createHybrid<T = unknown>(
    nameOrModule: string,
    options?: T,
    allowModules?: readonly string[]
  ): Promise<IAuditWriter> {
    // Fast path: registered name
    const known = listRegisteredWriters();
    if (known.includes(nameOrModule)) {
      return createWriterByName<T>(nameOrModule, options);
    }

    // Guard optional dynamic import
    if (Array.isArray(allowModules) && allowModules.length > 0) {
      if (!allowModules.includes(nameOrModule)) {
        const e = new Error(
          `AuditWriterFactory: module "${nameOrModule}" not in allowlist`
        );
        (e as any).code = "WRITER_MODULE_NOT_ALLOWED";
        (e as any).allow = allowModules.slice();
        throw e;
      }
    }

    return createWriter<T>(nameOrModule, options);
  }
}
