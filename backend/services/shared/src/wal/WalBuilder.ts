// backend/services/shared/src/wal/WalBuilder.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0022 — Shared WAL & DB Base (generic, shippable)
 * - ADR-0024 — WAL Durability (FS journal, fsync cadence)
 * - ADR-0025 — Writer Injection (DI-first; no registries at runtime)
 *
 * Purpose:
 * - Construct a WAL engine with a File-backed journal and a caller-provided writer.
 *
 * Notes:
 * - No environment reads here. Callers pass absolute dir and writer instance.
 * - Greenfield: DI-only — no { name, options } legacy path.
 */

import * as path from "node:path";
import type { IAuditWriter } from "./writer/IAuditWriter";
import type { IWalEngine } from "./IWalEngine";
import { WalEngine } from "./WalEngine";
import { FileWalJournal } from "./fs/FileWalJournal";

export interface WalBuilderOpts {
  journal: { dir: string };
  writer: { instance: IAuditWriter };
}

export async function buildWal(opts: WalBuilderOpts): Promise<IWalEngine> {
  const dir = opts?.journal?.dir;
  if (!dir || typeof dir !== "string") {
    throw new Error("buildWal: journal.dir is required");
  }
  if (!path.isAbsolute(dir)) {
    throw new Error(`buildWal: journal.dir must be absolute, got "${dir}"`);
  }

  const writer = opts?.writer?.instance;
  if (!writer || typeof (writer as any).writeBatch !== "function") {
    throw new Error("buildWal: writer.instance must implement IAuditWriter");
  }

  const journal = new FileWalJournal({ dir });

  // WalEngine expects positional args: (journal, writer)
  return new WalEngine(journal, writer);
}
