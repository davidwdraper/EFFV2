#!/usr/bin/env node
/**
 * aliasify-shared.mjs
 * Convert relative imports in backend/services/shared/src/** to "@eff/shared/src/<path>"
 *
 * Example:
 *   src/app/createServiceApp.ts
 *     "../middleware/requestId"  ->  "@eff/shared/src/middleware/requestId"
 *
 * Why:
 *   - Node16/ESM requires .js for *relative* specifiers. We avoid that by using a bare specifier.
 *   - TS resolves "@eff/shared/src/*" → "src/*" (paths), runtime resolves via package.json "imports".
 *
 * Usage:
 *   node scripts/codemods/aliasify-shared.mjs backend/services/shared/src
 */

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const argvRoot = process.argv[2] || "backend/services/shared/src";
const SRC_ROOT = path.resolve(process.cwd(), argvRoot);

const EXTS = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js"]; // strip these when building alias
const isTestFile = (p) =>
  /\.test\.(ts|tsx|mts|cts|js)$/.test(p) || p.includes("__tests__/");

async function* walk(dir) {
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      yield* walk(p);
    } else {
      yield p;
    }
  }
}

function toAlias(fileAbs, spec) {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return spec;
  const fromDir = path.dirname(fileAbs);
  const targetAbs = path.resolve(fromDir, spec);

  // derive path relative to src root
  let rel = path.relative(SRC_ROOT, targetAbs).split(path.sep).join("/");

  // drop known extensions and trailing /index
  for (const ext of EXTS) {
    if (rel.endsWith(ext)) rel = rel.slice(0, -ext.length);
  }
  if (rel.endsWith("/index")) rel = rel.slice(0, -"/index".length);

  // if it points outside src, bail out (don't rewrite)
  if (rel.startsWith("../")) return spec;

  return `@eff/shared/src/${rel}`;
}

function rewrite(content, fileAbs) {
  // Static imports with `from "..."` and re-exports
  content = content.replace(
    /(\bfrom\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
    (_, a, spec, z) => a + toAlias(fileAbs, spec) + z
  );

  // Side-effect imports: import "..."
  content = content.replace(
    /(\bimport\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,
    (_, a, spec, z) => a + toAlias(fileAbs, spec) + z
  );

  // Dynamic imports: import("...")
  content = content.replace(
    /(\bimport\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g,
    (_, a, spec, z) => a + toAlias(fileAbs, spec) + z
  );

  return content;
}

async function main() {
  const files = [];
  for await (const p of walk(SRC_ROOT)) {
    if (!/\.(ts|tsx|mts|cts|js)$/.test(p)) continue;
    if (p.endsWith(".d.ts")) continue;
    if (isTestFile(p)) continue;
    files.push(p);
  }

  let changed = 0;
  for (const file of files) {
    const before = await fs.readFile(file, "utf8");
    const after = rewrite(before, file);
    if (after !== before) {
      await fs.writeFile(file, after, "utf8");
      changed++;
      console.log("rewrote:", path.relative(SRC_ROOT, file));
    }
  }

  console.log(`done. ${changed} file(s) updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
