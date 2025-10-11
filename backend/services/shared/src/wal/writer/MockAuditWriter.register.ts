// backend/services/shared/src/writer/MockAuditWriter.register.ts
/**
 * NowVibin (NV)
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADR-0025 — Audit WAL with Opaque Payloads & Writer Injection
 *
 * Purpose:
 * - Register the built-in MockAuditWriter with the dynamic WriterRegistry.
 * - Lets callers do: `import "@nv/shared/writer/MockAuditWriter.register"` once,
 *   then `createWriter("mock", { delayMs: 0 })` anywhere — no switches.
 *
 * Notes:
 * - Zero environment reads here; pure registration.
 * - Keep this tiny so tests can selectively register writers.
 */

import { registerWriter } from "./WriterRegistry";
import {
  MockAuditWriter,
  type MockAuditWriterOptions,
} from "./MockAuditWriter";
import type { IAuditWriter } from "./IAuditWriter";

registerWriter<MockAuditWriterOptions>(
  "mock",
  (opts?: MockAuditWriterOptions): IAuditWriter => new MockAuditWriter(opts),
  { builtin: true }
);
