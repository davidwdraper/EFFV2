// backend/services/shared/utils/logMeta.ts

/**
 * Docs:
 * - Design: docs/design/backend/observability/log-callsite-capture.md
 * - Architecture: docs/architecture/backend/OBSERVABILITY.md
 * - ADRs:
 *   - docs/adr/0018-log-callsite-capture-for-audit-and-security.md
 *
 * Why:
 * - Audit/Security events need a **single actionable callsite** (file:line:function),
 *   not a whole stack trace. This keeps logs compact and triage fast.
 * - Stack formats vary and include a ton of noise (node internals, node_modules).
 *   We walk up the stack, skip junk, and return the first frame that looks like
 *   **our repo code**. If we can’t parse anything safely, we return `null`—the
 *   logger’s enrichment path is required to be tolerant.
 *
 * Notes:
 * - Preserves your API exactly: `getCallerInfo(depth): CallerInfo | null`.
 * - We *start* at `depth` but will scan upward to find a usable frame rather
 *   than blindly trusting that index (which often lands on wrappers).
 * - No filesystem or env reads here; keep it cheap and dependency-free.
 */

export interface CallerInfo {
  file: string;
  line: number;
  column: number;
  functionName: string;
}

/** Two common V8 shapes:
 * 1) "at fnName (/abs/path/file.ts:12:34)"
 * 2) "at /abs/path/file.ts:12:34"
 */
const FRAME_RE =
  /^\s*at\s+(?:(?<fn>.+?)\s+\()?(?<file>[/\\].+?):(?<line>\d+):(?<col>\d+)\)?\s*$/;

function isNodeInternal(p: string): boolean {
  return (
    p.startsWith("node:") ||
    p.includes("/internal/") ||
    p.includes("\\internal\\") ||
    p.includes("/node_modules/") ||
    p.includes("\\node_modules\\")
  );
}

/** Skip frames originating from our own logging plumbing. */
function isSelfFrame(p: string): boolean {
  const n = p.replace(/\\/g, "/");
  return n.endsWith("/backend/services/shared/utils/logMeta.ts");
}

/**
 * Capture caller metadata from stack trace.
 * @param depth How many frames up to *start* scanning from (default 2).
 * @returns CallerInfo or null if no safe frame was found.
 */
export function getCallerInfo(depth = 2): CallerInfo | null {
  const err = new Error();
  if (!err.stack) return null;

  const stackLines = err.stack.split("\n");

  // WHY: Start at requested depth, then scan upwards until we find a usable frame.
  for (let i = depth + 1; i < stackLines.length; i++) {
    const line = stackLines[i]?.trim();
    if (!line) continue;

    const m = FRAME_RE.exec(line);
    if (!m) continue;

    const file = m.groups?.file || "";
    if (!file) continue;
    if (isNodeInternal(file)) continue;
    if (isSelfFrame(file)) continue;

    const fn = (m.groups?.fn || "").trim() || "<anonymous>";
    const lineNo = parseInt(m.groups?.line || "0", 10);
    const colNo = parseInt(m.groups?.col || "0", 10);

    if (!Number.isFinite(lineNo) || !Number.isFinite(colNo)) continue;

    return {
      functionName: fn,
      file,
      line: lineNo,
      column: colNo,
    };
  }

  // WHY: Fail-quiet for audit contexts; caller must tolerate null.
  return null;
}
