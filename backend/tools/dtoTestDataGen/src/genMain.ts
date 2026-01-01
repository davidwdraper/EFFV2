// backend/tools/dtoTestDataGen/src/genMain.ts
/**
 * Docs:
 * - SOP: Deterministic generation; sidecars are happy-only fixtures.
 * - ADRs:
 *   - ADR-0088
 *   - ADR-0089
 *   - ADR-0090
 *   - ADR-0091
 *
 * Purpose:
 * - Implementation for nv-dto-gen (attachments: generator + renderer).
 *
 * Invariants:
 * - This module is a library. It MUST NOT auto-run on import.
 * - The CLI entrypoint is `backend/tools/dtoTestDataGen/nv-dto-gen.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildHappyJson,
  buildHints,
  classNameForSidecar,
  pickDtoClassExport,
  pickFieldsExport,
  renderSidecarTs,
  sidecarPathForDto,
} from "./tdataGen";

type GenOpts = {
  dtoAbs: string;
  write: boolean;
  verify: boolean;
  force: boolean;
  print: boolean;
  skipNoFields: boolean;
  uiHints: boolean;
};

function normalizeToPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function fail(msg: string, exitCode = 2): never {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(exitCode);
}

function printHelpAndExit(): never {
  // eslint-disable-next-line no-console
  console.log(
    [
      "nv-dto-gen",
      "",
      "Generates a single `*.dto.tdata.ts` sidecar adjacent to a given `*.dto.ts`.",
      "",
      "DTO path input (either):",
      "  --dto <path>           Explicit flag form (recommended).",
      "  <path-to-*.dto.ts>     Positional form (pipe/xargs friendly).",
      "",
      "Options:",
      "  --write                Write the sidecar file. Default is stdout (dry-run).",
      "  --print                Print generated content even if --write.",
      "  --no-verify            Skip Dto.fromBody(happyJson, { validate:true }) verification.",
      "  --force                Overwrite existing *.dto.tdata.ts if present.",
      "  --skip-no-fields       Exit 0 if no exported *Fields exists (otherwise fail).",
      "  --ui-hints             Include UI metadata in getHints() output (default: off).",
      "  -h, --help             Show help.",
      "",
      "Examples:",
      "  ./run.sh gen --dto backend/services/shared/src/dto/user.dto.ts --write",
      "  ./run.sh gen backend/services/shared/src/dto/user.dto.ts --write",
      "  ./run.sh scan | xargs -n 1 ./run.sh gen --write --skip-no-fields",
      "",
    ].join("\n")
  );
  process.exit(0);
}

function parseArgs(argv: string[], cwd: string): GenOpts {
  let dtoAbs = "";
  let write = false;
  let verify = true;
  let force = false;
  let print = false;
  let skipNoFields = false;
  let uiHints = false;

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (!a.startsWith("-")) {
      positional.push(a);
      continue;
    }

    if (a === "--dto") {
      dtoAbs = path.resolve(cwd, argv[i + 1] ?? "");
      i++;
      continue;
    }
    if (a === "--write") {
      write = true;
      continue;
    }
    if (a === "--no-verify") {
      verify = false;
      continue;
    }
    if (a === "--force") {
      force = true;
      continue;
    }
    if (a === "--print") {
      print = true;
      continue;
    }
    if (a === "--skip-no-fields") {
      skipNoFields = true;
      continue;
    }
    if (a === "--ui-hints") {
      uiHints = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelpAndExit();
    }
  }

  // Pipe-friendly support: allow a positional *.dto.ts if --dto wasn't provided.
  if (!dtoAbs && positional.length) {
    const candidate = positional.find((p) => p.endsWith(".dto.ts"));
    if (candidate) {
      dtoAbs = path.resolve(cwd, candidate);
    }
  }

  if (!dtoAbs) {
    fail(
      "nv-dto-gen: missing DTO path. Use --dto <path> or pass <path-to-*.dto.ts> positionally."
    );
  }

  return { dtoAbs, write, verify, force, print, skipNoFields, uiHints };
}

async function importDtoModule(
  dtoAbs: string
): Promise<Record<string, unknown>> {
  const url = pathToFileURL(dtoAbs).href;
  return (await import(url)) as any;
}

function maybeVerify(dtoClass: any, happyJson: unknown): void {
  try {
    dtoClass.fromBody(happyJson, { validate: true });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : String(e);
    fail(`nv-dto-gen: verification failed: ${msg}`);
  }
}

export async function genMain(argv: string[]): Promise<void> {
  const cwd = process.cwd();
  const opts = parseArgs(argv, cwd);

  if (!isFile(opts.dtoAbs)) {
    fail(`nv-dto-gen: dto file not found: ${normalizeToPosix(opts.dtoAbs)}`);
  }

  const tdataAbs = sidecarPathForDto(opts.dtoAbs);
  if (fs.existsSync(tdataAbs) && opts.write && !opts.force) {
    fail(
      `nv-dto-gen: sidecar already exists (use --force to overwrite): ${normalizeToPosix(
        path.relative(cwd, tdataAbs)
      )}`
    );
  }

  const mod = await importDtoModule(opts.dtoAbs);

  const fieldsPick = pickFieldsExport(mod);
  if (!fieldsPick) {
    if (opts.skipNoFields) process.exit(0);
    fail(
      `nv-dto-gen: no exported *Fields found in DTO module: ${normalizeToPosix(
        path.relative(cwd, opts.dtoAbs)
      )}`
    );
  }

  const dtoPick = pickDtoClassExport(mod);

  const happyJson = buildHappyJson(fieldsPick.fields);
  const hints = buildHints(fieldsPick.fields, { uiHints: opts.uiHints });

  if (opts.verify && dtoPick) {
    maybeVerify(dtoPick.dtoClass, happyJson);
  }

  const relDto = normalizeToPosix(path.relative(cwd, opts.dtoAbs));
  const tdataClassName = classNameForSidecar(opts.dtoAbs, dtoPick?.exportName);
  const content = renderSidecarTs({
    dtoRelFromCwd: relDto,
    dtoAbs: opts.dtoAbs,
    tdataClassName,
    happyJson,
    hints,
  });

  if (!opts.write) {
    // eslint-disable-next-line no-console
    console.log(content);
    return;
  }

  fs.writeFileSync(tdataAbs, content, "utf8");

  if (opts.print) {
    // eslint-disable-next-line no-console
    console.log(content);
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `nv-dto-gen: wrote ${normalizeToPosix(
        path.relative(cwd, tdataAbs)
      )} (fields export: ${fieldsPick.exportName}${
        dtoPick
          ? `; verified via ${dtoPick.exportName}.fromBody()`
          : "; verify skipped (no *Dto export found)"
      })`
    );
  }
}
