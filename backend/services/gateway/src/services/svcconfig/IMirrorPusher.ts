// backend/services/gateway/src/services/svcconfig/IMirrorPusher.ts
/**
 * Docs:
 * - ADR0001 gateway svcconfig
 * - ADR0003 gateway pushes mirror to svcfacilitator
 *
 * Purpose:
 * - Contract for pushing the in-memory mirror to a downstream.
 */
import type { SvcMirror } from "./types";

export type RefreshReason = "boot" | "poll" | "change";

export interface IMirrorPusher {
  /** Push mirror; return true on success, false on failure (no throw). */
  push(mirror: Readonly<SvcMirror>, reason: RefreshReason): Promise<boolean>;
}
