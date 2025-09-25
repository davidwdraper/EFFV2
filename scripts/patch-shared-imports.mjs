#!/usr/bin/env node
/**
 * NowVibin — Shared Import Rewriter v2
 * -----------------------------------------------------------------------------
 * Default: rewrite ONLY dynamic relative imports inside shared → @eff/shared/src/...
 * Optional: --include-static also rewrites static relative imports/exports.
 * Safety: dry-run by default, .bak per modified file on --write.
 *
 * Usage:
 *   node scripts/patch-shared-imports.mjs                # dry-run (dynamic only)
 *   node scripts/patch-shared-imports.mjs --write        # apply (dynamic only)
 *   node scripts/patch-shared-imports.mjs --include-static
 *   node scripts/patch-shared-imports.mjs --write --include-static
 *   node scripts/patch-shared-imports.mjs --write --no-src
 *
 * Flags:
 *   --write            Apply changes (otherwise dry-run)
 *   --no-src           Emit '@eff/shared/<subpath>' instead of '@eff/shared/src/<subpath>'
 *   --include-static   Also rewrite static relative imports/exports
 *   --verbose          Print every replacement line
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "..");
const SHARED_SRC = path.join(REPO_ROOT, "backend", "services", "shared", "src");

const WRITE = process.argv.includes("--write");
const NO_SRC = process.argv.includes("--no-src");
const INCLUDE_STATIC = process.argv.includes("--include-static");
const VERBOSE = process.argv.includes("--verbose");

const VALID_EXTS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
];

const DYN_IMPORT_RE = /(?:await\s+)?import\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;
const REQUIRE_RE = /require\(\s*(['"])(\.\.?\/[^'"]+)\1\s*\)/g;

// Static forms (ESM)
const STATIC_IMPORT_RE =
  /(^|\s)import\s+(?:[^'"]+?\s+from\s+)?(['"])(\.\.?\/[^'"]+)\2/gm;
const STATIC_EXPORT_RE =
  /(^|\s)export\s+(?:\*\s+from\s+|{[^}]*}\s+from\s+)(['"])(\.\.?\/[^'"]+)\2/gm;

async function listFiles(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else if (/\.(c|m)?(t|j)sx?$/.test(p)) out.push(p);
  }
  return out;
}

async function resolveSharedTarget(fromFile, relImport) {
  const fromDir = path.dirname(fromFile);
  const abs = path.resolve(fromDir, relImport);
  const candidates = [abs];

  for (const ext of VALID_EXTS) candidates.push(abs + ext);
  for (const ext of VALID_EXTS) candidates.push(path.join(abs, "index" + ext));

  for (const cand of candidates) {
    try {
      const st = await fs.stat(cand);
      if (st.isFile() && cand.startsWith(SHARED_SRC + path.sep)) return cand;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function toPackageSubpath(absFile) {
  const relFromSrc = path.relative(SHARED_SRC, absFile).replace(/\\/g, "/");
  const noExt = relFromSrc.replace(/\.[^.]+$/, "");
  const prefix = NO_SRC ? "@eff/shared" : "@eff/shared/src";
  return `${prefix}/${noExt}`;
}

async function replaceAsync(str, regex, replacer) {
  const parts = [];
  let lastIndex = 0,
    m;
  while ((m = regex.exec(str))) {
    parts.push(str.slice(lastIndex, m.index));
    parts.push(await replacer(m));
    lastIndex = m.index + m[0].length;
  }
  parts.push(str.slice(lastIndex));
  return parts.join("");
}

async function rewriteRelatives(fpath, text) {
  let changed = false;
  const replacements = [];

  async function subst(regex, label) {
    text = await replaceAsync(text, regex, async (m) => {
      const full = m[0];
      const quote = m[1] ?? '"';
      const rel = m[2] ?? m[3];
      if (!rel?.startsWith("./") && !rel?.startsWith("../")) return full;

      const resolved = await resolveSharedTarget(fpath, rel);
      if (!resolved) return full;

      const pkgPath = toPackageSubpath(resolved);
      const newer = full.replace(rel, pkgPath);
      if (newer !== full) {
        changed = true;
        replacements.push({ label, from: rel, to: pkgPath });
        if (VERBOSE) console.log(`    ${label}: ${rel} → ${pkgPath}`);
      }
      return newer;
    });
  }

  await subst(DYN_IMPORT_RE, "dynamic import()");
  await subst(REQUIRE_RE, "require()");
  if (INCLUDE_STATIC) {
    await subst(STATIC_IMPORT_RE, "static import");
    await subst(STATIC_EXPORT_RE, "static export");
  }
  return { changed, text, replacements };
}

async function main() {
  try {
    const st = await fs.stat(SHARED_SRC);
    if (!st.isDirectory()) throw new Error();
  } catch {
    console.error(`Shared src not found: ${SHARED_SRC}`);
    process.exit(2);
  }

  const files = await listFiles(SHARED_SRC);
  let modified = 0;

  for (const f of files) {
    const before = await fs.readFile(f, "utf8");
    const { changed, text, replacements } = await rewriteRelatives(f, before);
    if (!changed) continue;

    const rel = path.relative(REPO_ROOT, f);
    console.log(`--- ${rel} ---`);
    for (const r of replacements.slice(0, 5)) {
      console.log(`  ${r.label}: ${r.from}  →  ${r.to}`);
    }
    if (replacements.length > 5) {
      console.log(`  … and ${replacements.length - 5} more`);
    }

    if (WRITE) {
      try {
        await fs.copyFile(f, f + ".bak");
      } catch {}
      await fs.writeFile(f, text, "utf8");
    }
    modified++;
  }

  console.log(
    `${WRITE ? "APPLIED" : "DRY-RUN"}: ${modified} file(s) ${
      WRITE ? "updated" : "would be updated"
    }`
  );

  if (NO_SRC) {
    console.log(
      "\nNOTE: --no-src used. Ensure shared/package.json has wildcard export, e.g.:\n" +
        `  "exports": {\n` +
        `    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },\n` +
        `    "./*": "./dist/*.js",\n` +
        `    "./package.json": "./package.json"\n` +
        `  },\n` +
        `  "typesVersions": { "*": { "*": ["dist/*.d.ts"] } }\n`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
