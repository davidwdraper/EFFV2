// backend/services/shared/src/wal/test/FileWalTestHarness.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Test helper that ALWAYS uses the real filesystem journal.
 * - Creates an isolated temp WAL dir → returns FileWalJournal + path + cleanup().
 *
 * Notes:
 * - No environment reads; caller decides lifecyle.
 * - Safe for smoke/integration: dev == prod code path (FS, fsync cadence, etc).
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  FileWalJournal,
  type FileWalJournalOptions,
} from "../fs/FileWalJournal";

export type FileWalHarness = {
  /** Absolute path to the temp WAL directory. */
  dir: string;
  /** Real FS-backed journal under `dir`. */
  journal: FileWalJournal;
  /** Remove all created files/directories. */
  cleanup: () => Promise<void>;
};

/**
 * Create a real FS-backed WAL journal in a temp directory.
 * @param opts Optional fsync/name overrides; dir is ignored (always temp).
 */
export async function createFileWalTestHarness(
  opts: Omit<FileWalJournalOptions, "dir"> = {}
): Promise<FileWalHarness> {
  const base = path.join(os.tmpdir(), "nv-wal-");
  const dir = await fsp.mkdtemp(base);

  const journal = new FileWalJournal({
    dir,
    nameFn: opts.nameFn ?? (() => `wal-${Date.now()}.ldjson`),
    fsyncIntervalMs: opts.fsyncIntervalMs ?? 0, // fsync each append for deterministic tests
  });

  async function cleanup(): Promise<void> {
    try {
      const entries = await fsp.readdir(dir);
      await Promise.allSettled(
        entries.map((n) =>
          fsp.rm(path.join(dir, n), { force: true, recursive: true })
        )
      );
      await fsp.rmdir(dir).catch(() => void 0);
    } catch {
      /* best effort */
    }
  }

  return { dir, journal, cleanup };
}
