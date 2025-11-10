# backend/tools/nv_service_clone.py
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NowVibin — Service Cloner

Core rules (simple & explicit):
- Xxx  → PascalCase(slug)    (APPLIES EVERYWHERE, code or strings)
- XXX  → UPPER_CASE(slug)    (dashes -> underscores)
- xxxId / <slug>Id → camelCase(slug) + "Id"
- t_entity_crud → <slug>
- Standalone/identifier 'xxx' → <slug> (dashed)
- DTO template flatten:
  "@nv/shared/dto/xxx.dto" → "@nv/shared/dto/<slug>.dto"

Notes:
- We intentionally do **not** special-case Xxx inside/outside literals. It's a global, blind substitution.
- The Xxx rule runs FIRST as a global pre-pass to avoid any dashed leakage like "env-serviceDto".
"""

import argparse, re, sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

TEXT_EXT = {
    ".ts",".tsx",".js",".jsx",".json",".md",".txt",".yml",".yaml",
    ".sh",".bash",".zsh",".env",".gitignore",".gitattributes",
    ".dockerignore",".Dockerfile",".tsconfig",".eslintrc",".prettierrc",
}
BINARY_EXT = {
    ".png",".jpg",".jpeg",".gif",".webp",".ico",".pdf",".zip",".tar",".gz",".tgz",".7z",
    ".mp3",".mp4",".mov",".wav",".ogg",".woff",".woff2",".ttf",".eot"
}
EXCLUDE_PATTERNS = [
    re.compile(r"(^|/)\.git(/|$)"),
    re.compile(r"(^|/)node_modules(/|$)"),
    re.compile(r"(^|/)dist(/|$)"),
    re.compile(r"(^|/)\.DS_Store$"),
    re.compile(r"(^|/)package-lock\.json$"),
    re.compile(r"(^|/)pnpm-lock\.yaml$"),
    re.compile(r"(^|/)yarn\.lock$"),
]

def is_excluded(path: str) -> bool:
    p = path.replace("\\", "/")
    return any(rx.search(p) for rx in EXCLUDE_PATTERNS)

def is_text_file(path_str: str) -> bool:
    ext = Path(path_str).suffix.lower()
    if ext in TEXT_EXT: return True
    if ext in BINARY_EXT: return False
    if re.search(r"(^|/)(dist|node_modules)(/|$)", path_str): return False
    return True

# ---- casing helpers ----------------------------------------------------------
def to_pascal(slug: str) -> str:
    return "".join(w[:1].upper()+w[1:].lower() for w in re.split(r"[-_\s]+", slug) if w)

def to_camel(slug: str) -> str:
    p = to_pascal(slug)
    return p[:1].lower()+p[1:] if p else p

def to_upper_underscore(slug: str) -> str:
    return slug.replace("-", "_").upper()

# ---- path rewrite (filenames/folders) ---------------------------------------
def rewrite_path(path: str, slug: str) -> str:
    pascal = to_pascal(slug)
    upper  = to_upper_underscore(slug)
    p = path.replace("t_entity_crud", slug)
    p = p.replace("Xxx", pascal).replace("XXX", upper).replace("xxx", slug)
    return p

# ---- content rewrite ---------------------------------------------------------
def rewrite_text(s: str, slug: str, dry_run: bool):
    """Apply simple, explicit transforms with a **global Xxx pre-pass**."""

    pascal = to_pascal(slug)
    camel  = to_camel(slug)
    upper  = to_upper_underscore(slug)
    changed = False

    # 0) Global pre-pass: Xxx → PascalCase(slug) (EVERYWHERE)
    s2 = s.replace("Xxx", pascal)
    if s2 != s:
        changed = True
        s = s2

    # 1) Global: XXX → UPPER_CASE(slug)
    s2 = s.replace("XXX", upper)
    if s2 != s:
        changed = True
        s = s2

    # 2) Global: t_entity_crud → slug
    s2 = s.replace("t_entity_crud", slug)
    if s2 != s:
        changed = True
        s = s2

    # 3) Id rules (regex; both code and strings):
    #    xxxId / <slug>Id → camelCase(slug) + "Id"
    slug_rx = re.escape(slug)
    s2 = re.sub(r'\bxxxId\b', camel + 'Id', s)
    if s2 != s:
        changed = True
        s = s2
    s2 = re.sub(rf'\b{slug_rx}Id\b', camel + 'Id', s)
    if s2 != s:
        changed = True
        s = s2

    # 4) DTO template flatten
    s2 = re.sub(r'@nv/shared/dto/templates/xxx/xxx\.dto',
                f"@nv/shared/dto/{slug}.dto", s)
    if s2 != s:
        changed = True
        s = s2
    s2 = re.sub(rf'@nv/shared/dto/templates/{slug_rx}/{slug_rx}\.dto',
                f"@nv/shared/dto/{slug}.dto", s)
    if s2 != s:
        changed = True
        s = s2

    # 5) Remaining 'xxx' tokens:
    #    - standalone tokens → slug
    #    - identifier-prefixed occurrences → slug (safe; Xxx already handled)
    s2 = re.sub(r'(?<![A-Za-z0-9_])xxx(?![A-Za-z0-9_])', slug, s)
    if s2 != s:
        changed = True
        s = s2
    s2 = re.sub(r'(?<![A-Za-z0-9_])xxx(?=[A-Za-z0-9_])', slug, s)
    if s2 != s:
        changed = True
        s = s2

    sample = None
    if changed and dry_run:
        idx = next((k for k,(a,b) in enumerate(zip(s, s2)) if a!=b), -1)
        if idx < 0: idx = min(len(s), len(s2))
        start = max(0, idx-40); end = min(len(s2), idx+120)
        sample = (s2[start:end]).replace("\n","\\n").replace("\r","\\r").replace("\t","\\t")

    return s, changed, sample

def rewrite_content_bytes(data: bytes, file_path: str, slug: str, dry_run: bool):
    if not is_text_file(file_path):
        return data, False, None
    try:
        s = data.decode("utf-8")
    except UnicodeDecodeError:
        return data, False, None

    new_text, changed, sample = rewrite_text(s, slug, dry_run)
    if changed:
        return new_text.encode("utf-8"), True, sample
    return data, False, None

# ---- main zip plumbing -------------------------------------------------------
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
        print("ERROR: Slug must be lowercase letters, numbers, and dashes only.", file=sys.stderr); sys.exit(1)

    inzip = Path(args.inzip).expanduser().resolve()
    if not inzip.exists():
        print(f"ERROR: Input zip not found: {inzip}", file=sys.stderr); sys.exit(1)

    outdir = Path(args.outdir).expanduser().resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    outzip = outdir / f"nowvibin-{slug}-service.zip"
    if outzip.exists() and not args.force and not args.dry_run:
        print(f"ERROR: Output already exists: {outzip} (use --force to overwrite)", file=sys.stderr); sys.exit(1)

    print("nv-service-clone — simple/global Xxx→Pascal + sane id rules")
    print(f"- input: {inzip}")
    print(f"- slug:  {slug}  (Pascal={to_pascal(slug)}, camel={to_camel(slug)}, UPPER={to_upper_underscore(slug)})")
    print(f"- out:   {outzip}")
    print(f"- mode:  {'DRY RUN' if args.dry_run else 'WRITE'}")

    files = 0; changed = 0; skipped = 0

    with ZipFile(inzip, "r") as zin:
        entries = zin.infolist()
        zout = None if args.dry_run else ZipFile(outzip, "w", compression=ZIP_DEFLATED)

        for info in entries:
            name = info.filename.replace("\\", "/")
            if name.endswith("/"):
                continue
            if is_excluded(name):
                skipped += 1
                continue

            data = zin.read(info)
            new_name = rewrite_path(name, slug)
            new_data, did_change, sample = rewrite_content_bytes(data, new_name, slug, args.dry_run)

            if args.dry_run:
                if new_name != name: print(f"FILE {name}  ->  {new_name}")
                else:                print(f"FILE {name}")
                if did_change and sample: print(f"  ~ content change sample: \"{sample}\"")
                if new_name != name or did_change: changed += 1
            else:
                zout.writestr(new_name, new_data)
                if new_name != name or did_change: changed += 1

            files += 1

        if not args.dry_run and zout: zout.close()

    print("\nSummary:")
    print(f"- files processed: {files}")
    print(f"- changed (renamed/edited): {changed}")
    print(f"- skipped (excluded): {skipped}")
    print("(dry run only, no zip written)" if args.dry_run else f"- wrote: {outzip}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}\nHint: check --in path, slug format, and write permissions.", file=sys.stderr)
        sys.exit(1)
