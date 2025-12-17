// backend/services/test-runner/src/svc/TestRunWriter.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - LDD-38 (Test Runner vNext Design)
 * - LDD-39 (StepIterator Micro-Contract — Revised, KISS)
 *
 * Purpose:
 * - Minimal writer abstraction for handler-test persistence via S2S to test-log.
 *
 * Notes:
 * - StepIterator depends ONLY on this interface.
 * - Concrete implementation can wrap SvcClient (preferred) but StepIterator never knows.
 */

import type { HandlerTestResult } from "@nv/shared/http/handlers/testing/HandlerTestBase";

export type TestHandlerTerminalStatus =
  | "Passed"
  | "Failed"
  | "TestError"
  | "RailError";

export type TestHandlerStartInput = {
  testRunId: string;
  indexRelativePath: string;
  stepIndex: number;
  stepCount: number;
  handlerName: string;
  targetServiceSlug: string;
  targetServiceVersion: number;
};

export type TestHandlerFinalizeInput = {
  testHandlerId: string;
  status: TestHandlerTerminalStatus;
  durationMs: number;
  result?: HandlerTestResult;
  errorMessage?: string;
  errorStack?: string;
};

export interface TestRunWriter {
  startHandlerTest(input: TestHandlerStartInput): Promise<string>;
  finalizeHandlerTest(input: TestHandlerFinalizeInput): Promise<void>;
}
