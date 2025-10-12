// backend/services/shared/src/wal/writer/WriterRegistry.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Dynamic, plugin-style registry/factory for IAuditWriter implementations.
 * - Supports:
 *    1) Pre-registered writers by name (no FS/loader cost)
 *    2) Safe dynamic imports by module path (opt-in)
 *
 * Notes:
 * - No environment reads here. Callers pass names/paths/options.
 * - Security: dynamic import is **opt-in** and should be allowlisted upstream.
 * - No barrels: writers are standalone modules; registration is explicit.
 */

import type { IAuditWriter } from "./IAuditWriter";

export type WriterFactoryFn<T = unknown> = (options?: T) => IAuditWriter;

type RegistryEntry = {
  /** Factory creator; options are typed by the writer module. */
  factory: WriterFactoryFn<any>;
  /** Optional metadata for observability. */
  meta?: Record<string, unknown>;
};

const registry = new Map<string, RegistryEntry>();

/**
 * Register a writer factory under a stable name.
 * Usually called from within the writer module (explicit import).
 */
export function registerWriter<T = unknown>(
  name: string,
  factory: WriterFactoryFn<T>,
  meta?: Record<string, unknown>
): void {
  if (!name || typeof name !== "string") {
    throw new Error("registerWriter: name must be a non-empty string");
  }
  if (registry.has(name)) {
    const e = new Error(`registerWriter: duplicate writer name "${name}"`);
    (e as any).code = "WRITER_DUPLICATE";
    throw e;
  }
  registry.set(name, { factory: factory as WriterFactoryFn<any>, meta });
}

/**
 * Create a writer by registered name (cheap, no loader).
 */
export function createWriterByName<T = unknown>(
  name: string,
  options?: T
): IAuditWriter {
  const entry = registry.get(name);
  if (!entry) {
    const e = new Error(`createWriterByName: unknown writer "${name}"`);
    (e as any).code = "WRITER_UNKNOWN";
    (e as any).known = Array.from(registry.keys());
    throw e;
  }
  return entry.factory(options);
}

/**
 * Dynamically import a writer module (path or specifier) and instantiate it.
 * Expected module shapes (either is fine):
 *  - default export: a class with ctor(options) OR a factory function(options) => IAuditWriter
 *  - named export:  createWriter(options) => IAuditWriter
 *
 * This is opt-in; upstream should control/allowlist the module specifier.
 */
export async function createWriterFromModule<T = unknown>(
  moduleSpecifier: string,
  options?: T
): Promise<IAuditWriter> {
  if (!moduleSpecifier || typeof moduleSpecifier !== "string") {
    throw new Error("createWriterFromModule: moduleSpecifier must be a string");
  }
  let mod: any;
  try {
    mod = await import(/* @vite-ignore */ moduleSpecifier);
  } catch (err) {
    const e = new Error(
      `createWriterFromModule: import failed "${moduleSpecifier}": ${
        (err as Error)?.message || String(err)
      }`
    );
    (e as any).code = "WRITER_IMPORT_FAILED";
    throw e;
  }

  // Prefer explicit factory
  if (typeof mod?.createWriter === "function") {
    return mod.createWriter(options);
  }

  // Accept default export as factory or class
  const d = mod?.default;
  if (typeof d === "function") {
    try {
      const instance = d.prototype?.writeBatch
        ? new d(options) // looks like a class
        : d(options); // looks like a factory
      if (instance && typeof instance.writeBatch === "function") {
        return instance as IAuditWriter;
      }
    } catch (err) {
      const e = new Error(
        `createWriterFromModule: default export not constructible: ${
          (err as Error)?.message || String(err)
        }`
      );
      (e as any).code = "WRITER_INSTANTIATE_FAILED";
      throw e;
    }
  }

  const e = new Error(
    `createWriterFromModule: module "${moduleSpecifier}" does not export createWriter() or a usable default`
  );
  (e as any).code = "WRITER_BAD_MODULE_SHAPE";
  throw e;
}

/**
 * Hybrid helper:
 *  - If `nameOrModule` matches a registered writer → instantiate it.
 *  - Else → try dynamic import using `nameOrModule` as a module specifier.
 */
export async function createWriter<T = unknown>(
  nameOrModule: string,
  options?: T
): Promise<IAuditWriter> {
  if (registry.has(nameOrModule)) {
    return createWriterByName<T>(nameOrModule, options);
  }
  return createWriterFromModule<T>(nameOrModule, options);
}

/** Introspection for logs/tests (no mutation). */
export function listRegisteredWriters(): readonly string[] {
  return Object.freeze(Array.from(registry.keys()));
}
