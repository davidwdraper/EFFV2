// backend/services/shared/utils/logMeta.ts

export interface CallerInfo {
  file: string;
  line: number;
  column: number;
  functionName: string;
}

/**
 * Capture caller metadata from stack trace.
 * depth = how many frames up the stack we walk
 */
export function getCallerInfo(depth = 2): CallerInfo | null {
  const err = new Error();
  if (!err.stack) return null;

  const stackLines = err.stack.split("\n");
  const callerLine = stackLines[depth + 1]?.trim();
  if (!callerLine) return null;

  // Two possible formats:
  // 1) "at functionName (file:line:column)"
  // 2) "at file:line:column"
  const fnMatch =
    callerLine.match(/^at\s+(.*?)\s+\((.*):(\d+):(\d+)\)$/) ||
    callerLine.match(/^at\s+(.*):(\d+):(\d+)$/);

  if (!fnMatch) {
    // Fail quiet for audit contexts; don't crash logger
    return null;
  }

  if (fnMatch.length === 5) {
    return {
      functionName: fnMatch[1] || "<anonymous>",
      file: fnMatch[2],
      line: parseInt(fnMatch[3], 10),
      column: parseInt(fnMatch[4], 10),
    };
  }

  if (fnMatch.length === 4) {
    return {
      functionName: "<anonymous>",
      file: fnMatch[1],
      line: parseInt(fnMatch[2], 10),
      column: parseInt(fnMatch[3], 10),
    };
  }

  return null;
}
