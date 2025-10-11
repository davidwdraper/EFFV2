// backend/services/shared/src/wal/WalBuilder.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - One-stop builder for a fully wired WAL engine:
 *   File-backed journal + registry-driven writer → `WalEngine`.
 *
 * Design:
 * - **No environment reads**; caller supplies all config.
 * - Lean, composable, and destination-agnostic.
 * - Throws with contextual errors (no silent fallbacks).
 */

import { WalEngine } from "./WalEngine";
import {
  FileWalJournal,
  type FileWalJournalOptions,
} from "./fs/FileWalJournal";
import {
  AuditWriterFactory,
  type AuditWriterConfig,
} from "./writer/AuditWriterFactory";
import type { IWalEngine } from "./IWalEngine";
import type { IAuditWriter } from "./writer/IAuditWriter";

export type WalJournalConfig = FileWalJournalOptions;

export type WalBuildOptions<TWriterOpts = unknown> = {
  /** File journal configuration (dir required). */
  journal: WalJournalConfig;

  /** Writer selection (registered name or module) + options. */
  writer: AuditWriterConfig<TWriterOpts>;
};

/**
 * Build a `WalEngine` with a file-backed journal and a factory-created writer.
 * Caller is responsible for importing/registering desired writers beforehand.
 */
export async function buildWal<T = unknown>(
  opts: WalBuildOptions<T>
): Promise<IWalEngine> {
  if (!opts?.journal?.dir) {
    const e = new Error("buildWal: journal.dir is required");
    (e as any).code = "WAL_BUILD_BAD_CONFIG";
    throw e;
  }

  // Create journal (fail-fast with context)
  let journal: FileWalJournal;
  try {
    journal = new FileWalJournal({
      dir: opts.journal.dir,
      nameFn: opts.journal.nameFn,
      fsyncIntervalMs: opts.journal.fsyncIntervalMs,
    });
  } catch (err) {
    const e = new Error(
      `buildWal: journal init failed — ${
        (err as Error)?.message || String(err)
      }`
    );
    (e as any).code = "WAL_BUILD_JOURNAL_FAILED";
    (e as any).cause = err;
    throw e;
  }

  // Create writer via registry-driven factory
  let writer: IAuditWriter;
  try {
    writer = await AuditWriterFactory.create<T>(opts.writer);
  } catch (err) {
    const e = new Error(
      `buildWal: writer init failed — ${(err as Error)?.message || String(err)}`
    );
    (e as any).code = "WAL_BUILD_WRITER_FAILED";
    (e as any).cause = err;
    throw e;
  }

  // Wire engine
  try {
    return new WalEngine(journal, writer);
  } catch (err) {
    const e = new Error(
      `buildWal: engine construction failed — ${
        (err as Error)?.message || String(err)
      }`
    );
    (e as any).code = "WAL_BUILD_ENGINE_FAILED";
    (e as any).cause = err;
    throw e;
  }
}
