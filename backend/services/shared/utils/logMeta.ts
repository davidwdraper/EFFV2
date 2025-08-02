// shared/utils/logMeta.ts

export interface CallerInfo {
  file: string;
  line: number;
  column: number;
  functionName: string;
}

export function getCallerInfo(depth = 2): CallerInfo | null {
  const err = new Error();
  if (!err.stack) return null;

  const stackLines = err.stack.split("\n");
  const callerLine = stackLines[depth + 1]?.trim();
  if (!callerLine) return null;

  const fnMatch =
    callerLine.match(/^at\s+(.*?)\s+\((.*):(\d+):(\d+)\)$/) ||
    callerLine.match(/^at\s+(.*):(\d+):(\d+)$/);

  if (!fnMatch) return null;

  if (fnMatch.length === 5) {
    return {
      functionName: fnMatch[1],
      file: fnMatch[2],
      line: parseInt(fnMatch[3], 10),
      column: parseInt(fnMatch[4], 10),
    };
  } else if (fnMatch.length === 4) {
    return {
      functionName: "<anonymous>",
      file: fnMatch[1],
      line: parseInt(fnMatch[2], 10),
      column: parseInt(fnMatch[3], 10),
    };
  }

  return null;
}
