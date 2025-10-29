// tools/nv-service-clone.ts
/**
 * Docs:
 * - SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
 * - ADRs:
 *   - ADR-0045 (NV Service Clone Tool — zip → rename → zip)
 *
 * Purpose:
 * - Clone a zipped template service, replacing identifiers and names to a new slug.
 * - Outputs a ready-to-drop zip archive for the repo.
 *
 * Invariants:
 * - No overwriting non-empty targets unless --force
 * - Dry-run supported (no writes)
 * - Case-aware replacements: xxx, Xxx, XXX, and t_entity_crud → <slug>
 *
 * Usage:
 *   npx ts-node tools/nv-service-clone.ts --in template.zip --slug user [--out ./out] [--dry-run] [--force]
 *
 * Output:
 *   nowvibin-<slug>-service.zip written to --out (default: cwd)
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

type Options = {
  inZip: string;
  slug: string;
  outDir: string;
  dryRun: boolean;
  force: boolean;
};

function parseArgs(argv: string[]): Options {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.split('=');
      if (typeof v === 'string') args[k.slice(2)] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[k.slice(2)] = argv[++i];
      } else {
        args[k.slice(2)] = true;
      }
    }
  }
  const inZip = String(args['in'] || '');
  const slug = String(args['slug'] || '');
  const outDir = String(args['out'] || process.cwd());
  const dryRun = Boolean(args['dry-run'] || false);
  const force = Boolean(args['force'] || false);

  if (!inZip) fail('Missing --in <path/to/template.zip>');
  if (!fs.existsSync(inZip)) fail(`Input zip not found: ${inZip}`);
  if (!slug) fail('Missing --slug <new-slug>');
  if (!/^[a-z0-9-]+$/.test(slug)) fail('Slug must be lowercase letters, numbers, and dashes only.');

  return { inZip, slug, outDir, dryRun, force };
}

function fail(msg: string): never {
  console.error(`ERROR: ${msg}\nSuggestion: Re-run with --dry-run to inspect actions.`);
  process.exit(1);
}

function toPascal(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function toUpperUnderscore(s: string): string {
  return s.replace(/-/g, '_').toUpperCase();
}

const TEXT_EXT = new Set([
  '.ts','.tsx','.js','.jsx','.json','.md','.txt','.yml','.yaml','.sh','.bash','.zsh','.env','.gitignore','.gitattributes','.dockerignore','.dockerfile','.tsconfig','.eslintrc','.prettierrc'
]);

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  // Allow dotfiles and no-ext files to pass through content replacement cautiously
  if (!ext && !/\/(dist|node_modules)\//.test(filePath)) return true;
  return false;
}

function shouldExclude(p: string): boolean {
  return (
    /(^|\/)\.git(\/.|$)/.test(p) ||
    /(^|\/)node_modules(\/.|$)/.test(p) ||
    /(^|\/)dist(\/.|$)/.test(p) ||
    /(^|\/)\.DS_Store$/.test(p) ||
    /(^|\/)package-lock\.json$/.test(p) ||
    /(^|\/)pnpm-lock\.yaml$/.test(p) ||
    /(^|\/)yarn\.lock$/.test(p)
  );
}

function buildReplacers(slug: string) {
  const pascal = toPascal(slug);
  const upper = toUpperUnderscore(slug);

  // Content word-boundary aware for 'xxx' and 'Xxx' and 'XXX'
  const contentRules: { re: RegExp; rep: string; label: string }[] = [
    { re: new RegExp(`(?<![A-Za-z0-9_])xxx(?![A-Za-z0-9_])`, 'g'), rep: slug, label: 'xxx→slug' },
    { re: new RegExp(`(?<![A-Za-z0-9_])Xxx(?![A-Za-z0-9_])`, 'g'), rep: pascal, label: 'Xxx→Pascal' },
    { re: new RegExp(`(?<![A-Za-z0-9_])XXX(?![A-Za-z0-9_])`, 'g'), rep: upper, label: 'XXX→UPPER' },
    // Template service name
    { re: /t_entity_crud/g, rep: slug, label: 't_entity_crud→slug' },
  ];

  // Filename/dir replace (looser; OK to hit substrings)
  const pathRules: { re: RegExp; rep: string }[] = [
    { re: /t_entity_crud/g, rep: slug },
    { re: /\bxxx\b/g, rep: slug },
    { re: /\bXxx\b/g, rep: pascal },
    { re: /\bXXX\b/g, rep: upper },
  ];

  return { contentRules, pathRules, pascal, upper };
}

function rewritePath(origPath: string, pathRules: { re: RegExp; rep: string }[]): string {
  let p = origPath;
  for (const r of pathRules) {
    p = p.replace(r.re, r.rep);
  }
  return p;
}

function rewriteContent(data: Buffer, filePath: string, contentRules: { re: RegExp; rep: string; label: string }[], dryRun: boolean, log: (s:string)=>void): Buffer {
  if (!isTextFile(filePath)) return data;
  const text = data.toString('utf8');
  let changed = text;
  for (const r of contentRules) {
    changed = changed.replace(r.re, r.rep);
  }
  if (changed !== text && dryRun) {
    // Show a tiny sample diff window
    const idx = firstDiffIndex(text, changed);
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(changed.length, idx + 120);
      log(`  ~ content change sample: "${sanitize(changed.slice(start, end))}"`);
    }
  }
  return Buffer.from(changed, 'utf8');
}

function firstDiffIndex(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : len;
}

function sanitize(s: string): string {
  return s.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

function main() {
  const opts = parseArgs(process.argv);
  const { inZip, slug, outDir, dryRun, force } = opts;
  const { contentRules, pathRules } = buildReplacers(slug);

  const inZipAbs = path.resolve(inZip);
  const outDirAbs = path.resolve(outDir);
  const outZipName = `nowvibin-${slug}-service.zip`;
  const outZipPath = path.join(outDirAbs, outZipName);

  if (!dryRun && fs.existsSync(outZipPath) && !force) {
    fail(`Output already exists: ${outZipPath} (use --force to overwrite)`);
  }

  console.log(`nv-service-clone`);
  console.log(`- input: ${inZipAbs}`);
  console.log(`- slug:  ${slug}`);
  console.log(`- out:   ${outZipPath}`);
  console.log(dryRun ? `- mode:  DRY RUN (no writes)` : `- mode:  WRITE`);
  if (force) console.log(`- note:  --force enabled`);

  const zip = new AdmZip(inZipAbs);
  const entries = zip.getEntries();

  const outZip = new AdmZip();
  let changedCount = 0;
  let skippedCount = 0;
  let fileCount = 0;

  for (const e of entries) {
    const origPath = e.entryName.replace(/\\/g, '/'); // normalize
    if (origPath.endsWith('/')) {
      // Directory — apply rename unless excluded
      if (shouldExclude(origPath)) {
        skippedCount++;
        continue;
      }
      const newPath = rewritePath(origPath, pathRules);
      if (dryRun && newPath !== origPath) {
        console.log(`DIR  ${origPath}  ->  ${newPath}`);
      }
      // AdmZip auto-creates dirs as needed when adding files, so no op here.
      continue;
    }

    // File
    if (shouldExclude(origPath)) {
      skippedCount++;
      continue;
    }

    const newPath = rewritePath(origPath, pathRules);
    const data = e.getData();

    const finalData = rewriteContent(data, newPath, contentRules, dryRun, (s)=>console.log(s));
    if (dryRun) {
      if (newPath !== origPath) {
        console.log(`FILE ${origPath}  ->  ${newPath}`);
      } else {
        console.log(`FILE ${origPath}`);
      }
      if (!data.equals(finalData)) {
        changedCount++;
      }
    } else {
      outZip.addFile(newPath, finalData);
      if (newPath !== origPath || !data.equals(finalData)) changedCount++;
    }
    fileCount++;
  }

  if (!dryRun) {
    fs.mkdirSync(outDirAbs, { recursive: true });
    outZip.writeZip(outZipPath);
  }

  console.log(`\nSummary:`);
  console.log(`- files processed: ${fileCount}`);
  console.log(`- changed (renamed/edited): ${changedCount}`);
  console.log(`- skipped (excluded): ${skippedCount}`);
  if (!dryRun) console.log(`- wrote: ${outZipPath}`);
  else console.log(`- no files written (dry run)`);

  console.log(`\nNext steps:`);
  console.log(`1) Unzip into backend/services/<${slug}> or keep as zip for drop-in.`);
  console.log(`2) Create/adjust the real DTO under @nv/shared/dto/<${slug}/...>.dto.ts.`);
  console.log(`3) Add svcconfig entry (slug, version, port).`);
  console.log(`4) Run generic smokes: ./backend/tests/smoke/run-smokes.sh --slug ${slug} --port <PORT>`);
}

main();
