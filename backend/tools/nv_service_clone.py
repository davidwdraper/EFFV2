#!/usr/bin/env python3
"""
nv_service_clone.py — Dependency-free Python 3 CLI
Zip in → case-aware rename (folders, files, contents) → zip out.

Usage:
  python3 nv_service_clone.py --in template.zip --slug user [--out ./out] [--dry-run] [--force]

Behavior:
  - Replaces: xxx→<slug>, Xxx→<SlugPascal>, XXX→<SLUG_UPPER>, t_entity_crud→<slug>
  - Skips: .git/**, node_modules/**, dist/**, lockfiles, common binaries
  - Rewrites text files only; passes binaries through untouched
  - Outputs: nowvibin-<slug>-service.zip
"""

import argparse
import io
import os
import re
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

TEXT_EXT = {
    ".ts",".tsx",".js",".jsx",".json",".md",".txt",".yml",".yaml",".sh",".bash",".zsh",
    ".env",".gitignore",".gitattributes",".dockerignore",".Dockerfile",".tsconfig",".eslintrc",".prettierrc"
}

BINARY_EXT = {
    ".png",".jpg",".jpeg",".gif",".webp",".ico",".pdf",".zip",".tar",".gz",".tgz",".7z",
    ".mp3",".mp4",".mov",".wav",".ogg",".woff",".woff2",".ttf",".eot"
}

EXCLUDE_PATTERNS = [
    re.compile(r"(^|/)\.git(/.|$)"),
    re.compile(r"(^|/)node_modules(/.|$)"),
    re.compile(r"(^|/)dist(/.|$)"),
    re.compile(r"(^|/)\.DS_Store$"),
    re.compile(r"(^|/)package-lock\.json$"),
    re.compile(r"(^|/)pnpm-lock\.yaml$"),
    re.compile(r"(^|/)yarn\.lock$"),
]

def is_excluded(p: str) -> bool:
    p = p.replace("\\", "/")
    return any(rx.search(p) for rx in EXCLUDE_PATTERNS)

def is_text_file(path_str: str) -> bool:
    ext = Path(path_str).suffix.lower()
    if ext in TEXT_EXT: return True
    if ext in BINARY_EXT: return False
    # Unknown: treat as text unless under dist/node_modules
    if re.search(r"(^|/)(dist|node_modules)(/|$)", path_str): return False
    return True

def to_pascal(slug: str) -> str:
    return "".join(w[:1].upper() + w[1:].lower() for w in re.split(r"[-_\s]+", slug) if w)

def to_upper_underscore(slug: str) -> str:
    return slug.replace("-", "_").upper()

def build_rules(slug: str):
    pascal = to_pascal(slug)
    upper = to_upper_underscore(slug)
    # Content rules with custom word-boundaries (no letters/digits/_ around the tokens)
    content_rules = [
        (re.compile(r"(?<![A-Za-z0-9_])xxx(?![A-Za-z0-9_])"), slug),
        (re.compile(r"(?<![A-Za-z0-9_])Xxx(?![A-Za-z0-9_])"), pascal),
        (re.compile(r"(?<![A-Za-z0-9_])XXX(?![A-Za-z0-9_])"), upper),
        (re.compile(r"t_entity_crud"), slug),
    ]
    # Path rules (looser)
    path_rules = [
        (re.compile(r"t_entity_crud"), slug),
        (re.compile(r"\bxxx\b"), slug),
        (re.compile(r"\bXxx\b"), pascal),
        (re.compile(r"\bXXX\b"), upper),
    ]
    return content_rules, path_rules

def rewrite_path(p: str, path_rules):
    new = p
    for rx, rep in path_rules:
        new = rx.sub(rep, new)
    return new

def rewrite_content(data: bytes, file_path: str, content_rules, dry_run: bool):
    if not is_text_file(file_path):
        return data, False, None
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data, False, None
    new_text = text
    for rx, rep in content_rules:
        new_text = rx.sub(rep, new_text)
    if new_text != text:
        sample = None
        if dry_run:
            # produce a tiny sample window around first diff
            idx = next((i for i,(a,b) in enumerate(zip(text, new_text)) if a!=b), -1)
            if idx < 0:
                idx = min(len(text), len(new_text))
            start = max(0, idx-40); end = min(len(new_text), idx+120)
            sample = new_text[start:end].replace("\n","\\n").replace("\r","\\r").replace("\t","\\t")
        return new_text.encode("utf-8"), True, sample
    return data, False, None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inzip", required=True, help="Path to template .zip")
    ap.add_argument("--slug", required=True, help="New slug (lowercase letters, numbers, dashes)")
    ap.add_argument("--out", dest="outdir", default=".", help="Output directory")
    ap.add_argument("--dry-run", action="store_true", help="Show plan, make no changes")
    ap.add_argument("--force", action="store_true", help="Overwrite output zip if exists")
    args = ap.parse_args()

    slug = args.slug
    if not re.fullmatch(r"[a-z0-9-]+", slug):
        print("ERROR: Slug must be lowercase letters, numbers, and dashes only.", file=sys.stderr)
        sys.exit(1)

    inzip = Path(args.inzip).expanduser().resolve()
    if not inzip.exists():
        print(f"ERROR: Input zip not found: {inzip}", file=sys.stderr)
        sys.exit(1)

    outdir = Path(args.outdir).expanduser().resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    outzip = outdir / f"nowvibin-{slug}-service.zip"
    if outzip.exists() and not args.force and not args.dry_run:
        print(f"ERROR: Output already exists: {outzip} (use --force to overwrite)", file=sys.stderr)
        sys.exit(1)

    content_rules, path_rules = build_rules(slug)

    print("nv-service-clone (python)")
    print(f"- input: {inzip}")
    print(f"- slug:  {slug}")
    print(f"- out:   {outzip}")
    print(f"- mode:  {'DRY RUN' if args.dry_run else 'WRITE'}")

    files = 0
    changed = 0
    skipped = 0

    with ZipFile(inzip, "r") as zin:
        # Collect entries to process
        entries = zin.infolist()
        # Output zip only if writing
        out_buf = io.BytesIO() if args.dry_run else None
        zout = None if args.dry_run else ZipFile(outzip, "w", compression=ZIP_DEFLATED)

        for info in entries:
            name = info.filename.replace("\\", "/")
            if name.endswith("/"):
                # directory — skip explicit write (Zip will create as needed)
                if is_excluded(name):
                    skipped += 1
                continue

            if is_excluded(name):
                skipped += 1
                continue

            data = zin.read(info)

            # Path rewrite
            new_name = rewrite_path(name, path_rules)

            # Content rewrite (text files only)
            new_data, did_change, sample = rewrite_content(data, new_name, content_rules, args.dry_run)

            if args.dry_run:
                if new_name != name:
                    print(f"FILE {name}  ->  {new_name}")
                else:
                    print(f"FILE {name}")
                if did_change:
                    changed += 1
                    if sample:
                        print(f"  ~ content change sample: \"{sample}\"")
            else:
                zi = info
                # Create a fresh ZipInfo to avoid path/perm weirdness
                zout.writestr(new_name, new_data)
                if new_name != name or did_change:
                    changed += 1
            files += 1

        if not args.dry_run and zout:
            zout.close()

    print("\nSummary:")
    print(f"- files processed: {files}")
    print(f"- changed (renamed/edited): {changed}")
    print(f"- skipped (excluded): {skipped}")
    if args.dry_run:
        print("- no files written (dry run)")
    else:
        print(f"- wrote: {outzip}")

    print("\nNext steps:")
    print(f"1) Unzip into backend/services/<{slug}> or keep as zip for drop-in.")
    print(f"2) Create/adjust DTO under @nv/shared/dto/{slug}/...dto.ts.")
    print(f"3) Add svcconfig entry (slug, version, port).")
    print(f"4) Run smokes: ./backend/tests/smoke/run-smokes.sh --slug {slug} --port <PORT>")

if __name__ == "__main__":
    main()
