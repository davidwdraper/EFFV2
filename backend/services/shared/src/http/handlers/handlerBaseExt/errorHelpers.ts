// backend/services/shared/src/http/handlers/handlerBaseExt/errorHelpers.ts
/**
 * Docs:
 * - ADR-0041 (Per-route controllers; single-purpose handlers)
 * - ADR-0042 (HandlerContext Bus — KISS)
 * - ADR-0043 (Hydration + Failure Propagation)
 * - ADR-0049 (DTO Registry & Wire Discrimination)
 * - ADR-0073 (Test-Runner Service — Handler-Level Test Execution)
 *
 * Purpose:
 * - Centralize NvHandlerError construction, logging, and stack parsing.
 * - Keep HandlerBase lean by moving error plumbing to focused helpers.
 *
 * Test behavior:
 * - When requestScope OR ctx indicates expected negative-test errors, downgrade
 *   ERROR logging to INFO (no pager-noise; still visible in trace logs).
 */

import type { HandlerContext } from "../HandlerContext";
import type { IBoundLogger } from "../../../logger/Logger";
import { isExpectedErrorContext } from "../../requestScope";

export type NvHandlerError = {
  httpStatus: number;
  title: string;
  detail: string;
  requestId?: string;
  promptKey?: string;
  issues?: unknown[];
  origin?: {
    service?: string;
    controller?: string;
    handler?: string;
    pipeline?: string;
    file?: string;
    method?: string;
    stage?: string;
    purpose?: string;
    dtoType?: string;
    collection?: string;
    slug?: string;
    version?: string | number;
    line?: number;
    column?: number;
  };
};

export type FailWithErrorInput = {
  httpStatus: number;
  title: string;
  detail: string;
  stage?: string;
  requestId?: string;
  promptKey?: string;
  issues?: unknown[];
  origin?: Partial<NvHandlerError["origin"]>;
  rawError?: unknown;
  logMessage?: string;
  logLevel?: "error" | "warn" | "info" | "debug";
};

type FirstFrame = {
  frame: string;
  file?: string;
  line?: number;
  column?: number;
  functionName?: string;
};

function extractFirstStackFrame(rawError: unknown): FirstFrame | undefined {
  if (!(rawError instanceof Error)) return undefined;
  const stack = rawError.stack;
  if (!stack || typeof stack !== "string") return undefined;

  const lines = stack.split("\n").map((l) => l.trim());
  const frameLine = lines.find((l) => l.startsWith("at "));
  if (!frameLine) return undefined;

  const withFunc =
    /^at\s+(?<fn>.+?)\s+\((?<file>.+):(?<line>\d+):(?<col>\d+)\)$/;
  const noFunc = /^at\s+(?<file>.+):(?<line>\d+):(?<col>\d+)$/;

  let match = frameLine.match(withFunc);
  if (match && match.groups) {
    const { fn, file, line, col } = match.groups;
    return {
      frame: frameLine,
      functionName: fn,
      file,
      line: Number(line),
      column: Number(col),
    };
  }

  match = frameLine.match(noFunc);
  if (match && match.groups) {
    const { file, line, col } = match.groups;
    return {
      frame: frameLine,
      file,
      line: Number(line),
      column: Number(col),
    };
  }

  return { frame: frameLine };
}

function isExpectedErrorFromCtx(ctx: HandlerContext): boolean {
  try {
    return ctx.get<boolean | undefined>("test.expectErrors") === true;
  } catch {
    return false;
  }
}

export function buildHandlerError(opts: {
  input: FailWithErrorInput;
  handlerName: string;
  handlerPurpose: string;
  requestId?: string;
  contextOrigin: {
    pipeline?: string;
    dtoType?: string;
    slug?: string;
  };
  firstFrame?: FirstFrame;
}): NvHandlerError {
  const { input, handlerName, handlerPurpose, requestId, contextOrigin } = opts;

  const origin: NvHandlerError["origin"] = {
    handler: handlerName,
    purpose: handlerPurpose,
    ...(input.origin ?? {}),
    stage: input.stage ?? input.origin?.stage,
  };

  if (!origin.pipeline && contextOrigin.pipeline) {
    origin.pipeline = contextOrigin.pipeline;
  }
  if (!origin.dtoType && contextOrigin.dtoType) {
    origin.dtoType = contextOrigin.dtoType;
  }
  if (!origin.slug && contextOrigin.slug) {
    origin.slug = contextOrigin.slug;
  }
  if (!origin.service && origin.slug) {
    origin.service = origin.slug;
  }

  if (opts.firstFrame) {
    const { file, line, column, functionName } = opts.firstFrame;
    if (!origin.file && file) origin.file = file;
    if (!origin.method && functionName) origin.method = functionName;
    if (origin.line === undefined && line !== undefined) origin.line = line;
    if (origin.column === undefined && column !== undefined) {
      origin.column = column;
    }
  }

  return {
    httpStatus: input.httpStatus,
    title: input.title,
    detail: input.detail,
    requestId,
    promptKey: input.promptKey,
    issues: input.issues,
    origin,
  };
}

export function logAndAttachHandlerError(opts: {
  ctx: HandlerContext;
  log: IBoundLogger;
  handlerName: string;
  handlerPurpose: string;
  requestId?: string;
  input: FailWithErrorInput;
  safe: {
    pipeline: () => string | undefined;
    dtoType: () => string | undefined;
    slug: () => string | undefined;
  };
}): NvHandlerError {
  const { ctx, log, handlerName, handlerPurpose, requestId, input, safe } =
    opts;

  const firstFrame = extractFirstStackFrame(input.rawError);

  const error = buildHandlerError({
    input,
    handlerName,
    handlerPurpose,
    requestId,
    contextOrigin: {
      pipeline: safe.pipeline(),
      dtoType: safe.dtoType(),
      slug: safe.slug(),
    },
    firstFrame,
  });

  const expected = isExpectedErrorContext() || isExpectedErrorFromCtx(ctx);

  const logPayload: Record<string, unknown> = {
    event: "handler_fail",
    handler: handlerName,
    requestId,
    httpStatus: error.httpStatus,
    origin: error.origin,
    expectedError: expected,
  };

  if (firstFrame) logPayload.firstFrame = firstFrame;

  if (input.rawError) {
    if (input.rawError instanceof Error) {
      logPayload.rawError = {
        name: input.rawError.name,
        message: input.rawError.message,
      };
    } else {
      logPayload.rawError = input.rawError;
    }
  }

  const msg =
    input.logMessage ??
    `Handler failure in ${error.origin?.handler ?? "unknown handler"}`;

  // Downgrade: expected negative-test errors must not be logged as ERROR.
  // Per rails: ERROR → INFO (not WARN).
  let level = input.logLevel ?? "error";
  if (expected && level === "error") {
    level = "info";
  }

  if (level === "debug") {
    log.debug(logPayload, msg);
  } else if (level === "info") {
    log.info(logPayload, msg);
  } else if (level === "warn") {
    log.warn(logPayload, msg);
  } else {
    log.error(logPayload, msg);
  }

  ctx.set("error", error);
  ctx.set("handlerStatus", "error");
  ctx.set("status", error.httpStatus);

  return error;
}
