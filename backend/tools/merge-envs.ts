// backend/tools/merge-envs.ts
/**
 * Merge two .env files safely:
 *  - Reports duplicate keys within each file (with last-wins noted).
 *  - Reports keys only-in-A and only-in-B.
 *  - Creates merged.env:
 *      • same values -> KEY=VALUE
 *      • differing values -> commented block + KEY=<<SET ME>>
 *      • only-in-one -> include with its value (annotate source)
 *
 * Usage:
 *   ts-node merge-envs.ts path/to/A.env path/to/B.env
 * or
 *   node merge-envs.js path/to/A.env path/to/B.env
 */
import * as fs from "fs";
import * as path from "path";

type Entry = { key: string; value: string; lineNo: number };
type ParseResult = {
  entries: Entry[];
  map: Map<string, Entry[]>;
  raw: string[];
};

function parseEnv(filePath: string): ParseResult {
  const raw = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const entries: Entry[] = [];
  const map = new Map<string, Entry[]>();

  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    // skip comments/blank
    if (!line || /^\s*#/.test(line)) continue;

    // allow `export KEY=...` or `KEY=...`
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;

    const key = m[1];
    let value = m[2] ?? "";

    // strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    const e: Entry = { key, value, lineNo: i + 1 };
    entries.push(e);
    const arr = map.get(key) ?? [];
    arr.push(e);
    map.set(key, arr);
  }

  return { entries, map, raw };
}

function lastWins(map: Map<string, Entry[]>): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const [k, arr] of map.entries()) {
    out.set(k, arr[arr.length - 1]);
  }
  return out;
}

function generateMerged(
  Apath: string,
  Bpath: string,
  AmapLast: Map<string, Entry>,
  BmapLast: Map<string, Entry>
) {
  const keys = new Set<string>([...AmapLast.keys(), ...BmapLast.keys()]);
  const sorted = [...keys].sort((a, b) => a.localeCompare(b));

  const lines: string[] = [];
  lines.push(`# merged from:`);
  lines.push(`#   A: ${Apath}`);
  lines.push(`#   B: ${Bpath}`);
  lines.push(
    `# NOTE: Keys marked with <<SET ME>> had conflicting values across files.`
  );
  lines.push("");

  for (const key of sorted) {
    const a = AmapLast.get(key);
    const b = BmapLast.get(key);

    if (a && b) {
      if (a.value === b.value) {
        lines.push(`${key}=${escapeValue(a.value)}`);
      } else {
        lines.push(`# ${key} differs between files:`);
        lines.push(`#   A (${path.basename(Apath)}): ${a.value}`);
        lines.push(`#   B (${path.basename(Bpath)}): ${b.value}`);
        lines.push(`${key}=<<SET ME>`);
        lines.push("");
      }
    } else if (a && !b) {
      lines.push(`# from ${path.basename(Apath)}`);
      lines.push(`${key}=${escapeValue(a.value)}`);
      lines.push("");
    } else if (b && !a) {
      lines.push(`# from ${path.basename(Bpath)}`);
      lines.push(`${key}=${escapeValue(b.value)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function escapeValue(v: string): string {
  // Keep it simple: quote only if it contains spaces or # or leading/trailing whitespace
  if (/^\s|\s$/.test(v) || /[#"]/g.test(v)) {
    // escape embedded quotes
    const safe = v.replace(/"/g, '\\"');
    return `"${safe}"`;
  }
  return v;
}

function main() {
  const [Apath, Bpath] = process.argv.slice(2);
  if (!Apath || !Bpath) {
    console.error("Usage: ts-node merge-envs.ts path/to/A.env path/to/B.env");
    process.exit(1);
  }

  const A = parseEnv(Apath);
  const B = parseEnv(Bpath);

  // Duplicates within each file
  const dupA = [...A.map.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => ({
      key,
      lines: arr.map((e) => e.lineNo),
      lastValue: arr[arr.length - 1].value,
    }));
  const dupB = [...B.map.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => ({
      key,
      lines: arr.map((e) => e.lineNo),
      lastValue: arr[arr.length - 1].value,
    }));

  // Last-wins maps for merge
  const ALast = lastWins(A.map);
  const BLast = lastWins(B.map);

  // Missing keys
  const onlyInA = [...ALast.keys()].filter((k) => !BLast.has(k)).sort();
  const onlyInB = [...BLast.keys()].filter((k) => !ALast.has(k)).sort();

  // Conflicts
  const conflicts = [...ALast.keys()]
    .filter((k) => BLast.has(k) && ALast.get(k)!.value !== BLast.get(k)!.value)
    .sort();

  // Write outputs
  const merged = generateMerged(Apath, Bpath, ALast, BLast);
  fs.writeFileSync("merged.env", merged, "utf8");

  const reportTxt = [
    `A file: ${Apath}`,
    `B file: ${Bpath}`,
    "",
    `Duplicates in A (${dupA.length}):`,
    ...dupA.map(
      (d) =>
        `  ${d.key} @ lines ${d.lines.join(", ")} (last-wins="${d.lastValue}")`
    ),
    "",
    `Duplicates in B (${dupB.length}):`,
    ...dupB.map(
      (d) =>
        `  ${d.key} @ lines ${d.lines.join(", ")} (last-wins="${d.lastValue}")`
    ),
    "",
    `Only in A (${onlyInA.length}):`,
    ...onlyInA.map((k) => `  ${k}`),
    "",
    `Only in B (${onlyInB.length}):`,
    ...onlyInB.map((k) => `  ${k}`),
    "",
    `Conflicting keys (${conflicts.length}):`,
    ...conflicts.map(
      (k) => `  ${k}  (A="${ALast.get(k)!.value}", B="${BLast.get(k)!.value}")`
    ),
    "",
    `Merged written to merged.env`,
  ].join("\n");

  fs.writeFileSync("merge-report.txt", reportTxt, "utf8");
  fs.writeFileSync(
    "merge-report.json",
    JSON.stringify(
      {
        Apath,
        Bpath,
        duplicates: { A: dupA, B: dupB },
        onlyInA,
        onlyInB,
        conflicts,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("✔ merge-report.txt");
  console.log("✔ merge-report.json");
  console.log("✔ merged.env");
}

main();
