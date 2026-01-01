// backend/tools/dtoTestDataGen/src/scanMain.ts
/**
 * Docs:
 * - SOP: Helper tooling; pipe-friendly; no TS parsing.
 * - ADRs:
 *   - ADR-0088
 *   - ADR-0091
 *
 * Purpose:
 * - Implementation for nv-dto-scan.
 */

import fs from "node:fs";
import path from "node:path";

type ScanOpts = {
  rootAbs: string;
};

function normalizeToPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function defaultRootAbs(cwd: string): string {
  // Requested default: rigid NV shared DTO root.
  return path.resolve(cwd, "backend/services/shared/src/dto");
}

function printHelpAndExit(): never {
  // eslint-disable-next-line no-console
  console.log(
    [
      "nv-dto-scan",
      "",
      "Scans for `**/*.dto.ts` and prints newline-delimited paths (pipe-friendly).",
      "",
      "Defaults:",
      "  root = backend/services/shared/src/dto",
      "",
      "Options:",
      "  --root <path>   Override scan root (absolute or relative).",
      "  -h, --help      Show help.",
      "",
      "Example:",
      "  ./run.sh scan | xargs -n 1 ./run.sh gen --write",
      "",
    ].join("\n")
  );
  process.exit(0);
}

function parseArgs(argv: string[], cwd: string): ScanOpts {
  let rootAbs = "";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      rootAbs = path.resolve(cwd, argv[i + 1] ?? "");
      i++;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelpAndExit();
    }
  }

  return { rootAbs: rootAbs || defaultRootAbs(cwd) };
}

function shouldExclude(fullAbsPath: string): boolean {
  // Always ignore junk + generated sidecars.
  return (
    fullAbsPath.includes(`${path.sep}node_modules${path.sep}`) ||
    fullAbsPath.includes(`${path.sep}dist${path.sep}`) ||
    fullAbsPath.includes(`${path.sep}__tests__${path.sep}`) ||
    fullAbsPath.endsWith(".dto.tdata.ts")
  );
}

function scanDir(dirAbs: string, outAbs: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    const full = path.join(dirAbs, e.name);

    if (shouldExclude(full)) continue;

    if (e.isDirectory()) {
      scanDir(full, outAbs);
      continue;
    }

    if (
      e.isFile() &&
      full.endsWith(".dto.ts") &&
      !full.endsWith(".dto.tdata.ts")
    ) {
      outAbs.push(full);
    }
  }
}

export function scanMain(argv: string[]): void {
  const cwd = process.cwd();
  const opts = parseArgs(argv, cwd);

  if (!isDirectory(opts.rootAbs)) {
    // eslint-disable-next-line no-console
    console.error(
      `nv-dto-scan: root is not a directory: ${normalizeToPosix(opts.rootAbs)}`
    );
    process.exit(2);
  }

  const hitsAbs: string[] = [];
  scanDir(opts.rootAbs, hitsAbs);

  hitsAbs.sort((a, b) =>
    normalizeToPosix(a).localeCompare(normalizeToPosix(b))
  );

  for (const abs of hitsAbs) {
    const rel = path.relative(cwd, abs);
    const out = rel && !rel.startsWith("..") ? rel : abs;
    // eslint-disable-next-line no-console
    console.log(normalizeToPosix(out));
  }
}
