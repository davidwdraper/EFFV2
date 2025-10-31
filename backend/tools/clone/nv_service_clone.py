# backend/tools/nv_service_clone.py
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NowVibin — Service Cloner (dash-aware, identifier-aware, quote-aware)

Replacement rules (per user spec):

- For `xxx`:
    - If it precedes "Id" (i.e., `xxxId`), replace with camelCase(slug) + "Id".
    - Otherwise, replace with slug as-is (dashed).

- For `Xxx`: replace with PascalCase(slug).

- For `XXX`: replace with UPPER_CASE(slug) where dashes → underscores.

String handling:
- Inside quotes/imports/URLs/messages, `xxx`/`Xxx`/`XXX` become dashed slug,
  **except** when the exact pattern is `xxxId` or `<slug>Id`, which must become `<camel>Id`.

Also flatten "@nv/shared/dto/templates/xxx/xxx.dto" → "@nv/shared/dto/<slug>.dto".
"""

import argparse, re, sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

TEXT_EXT = {
    ".ts",".tsx",".js",".jsx",".json",".md",".txt",".yml",".yaml",
    ".sh",".bash",".zsh",".env",".gitignore",".gitattributes",
    ".dockerignore",".Dockerfile",".tsconfig",".eslintrc",".prettierrc",
    ".dto",
}
BINARY_EXT = {".png",".jpg",".jpeg",".gif",".webp",".ico",".pdf",".zip",".tar",".gz",".tgz",".7z",
              ".mp3",".mp4",".mov",".wav",".ogg",".woff",".woff2",".ttf",".eot"}
EXCLUDE_PATTERNS = [
    re.compile(r"(^|/)\.git(/|$)"),
    re.compile(r"(^|/)node_modules(/|$)"),
    re.compile(r"(^|/)dist(/|$)"),
    re.compile(r"(^|/)\.DS_Store$"),
    re.compile(r"(^|/)package-lock\.json$"),
    re.compile(r"(^|/)pnpm-lock\.yaml$"),
    re.compile(r"(^|/)yarn\.lock$"),
]
DEFAULT_DTO_TEMPLATES = [
    "backend/services/shared/src/dto/templates/xxx.dto",
    "backend/services/shared/src/dto/templates/xxx.dto.ts",
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

# --- case helpers per spec ---
def to_pascal(slug: str) -> str:
    # PascalCase: upper first char of each dash-separated part; remove dashes
    return "".join(w[:1].upper()+w[1:].lower() for w in re.split(r"[-_\s]+", slug) if w)

def to_camel(slug: str) -> str:
    # camelCase: lower first char, upper after dashes; remove dashes
    p = to_pascal(slug)
    return p[:1].lower()+p[1:] if p else p

def to_upper_underscore(slug: str) -> str:
    # UPPER: dashes → underscores, all upper
    return slug.replace("-", "_").upper()

def rewrite_path(path: str, slug: str) -> str:
    pascal = to_pascal(slug); upper = to_upper_underscore(slug)
    p = path.replace("t_entity_crud", slug)
    p = p.replace("Xxx", pascal).replace("XXX", upper).replace("xxx", slug)
    return p

def apply_string_rules(text: str, slug: str) -> str:
    """
    In strings/imports/URLs/messages:
      - Default: Xxx/XXX/xxx → dashed slug
      - BUT: exact xxxId or <slug>Id → <camel>Id (because these are identifier names passed as strings)
    """
    camel = to_camel(slug)
    slug_rx = re.escape(slug)

    # First, the hard Id rule (so "xxxId" doesn't get turned into "<slug>Id" first)
    text = re.sub(r'xxxId\b', camel + 'Id', text)
    text = re.sub(rf'{slug_rx}Id\b', camel + 'Id', text)

    # Then the general string replacements
    text = text.replace("t_entity_crud", slug)
    text = text.replace("Xxx", slug).replace("XXX", slug).replace("xxx", slug)

    # Flatten dto template paths:
    # "@nv/shared/dto/templates/xxx/xxx.dto" → "@nv/shared/dto/<slug>.dto"
    dto_pattern = re.compile(r'@nv/shared/dto/templates/xxx/xxx\.dto')
    text = dto_pattern.sub(f"@nv/shared/dto/{slug}.dto", text)

    # Also handle already-substituted slug form just in case:
    dto_pattern_slug = re.compile(rf'@nv/shared/dto/templates/{re.escape(slug)}/{re.escape(slug)}\.dto')
    text = dto_pattern_slug.sub(f"@nv/shared/dto/{slug}.dto", text)

    return text

def apply_code_rules(text: str, slug: str) -> str:
    """
    Code (outside quotes), implement *exact* user rules:

    - Xxx   → PascalCase(slug)
    - XXX   → UPPER_CASE(slug) (dashes→underscores)
    - xxxId → camelCase(slug) + "Id"
    - <slug>Id → camelCase(slug) + "Id"
    - All other `xxx` (token or identifier prefix/whole) → raw slug (dashed)
    - t_entity_crud → slug
    """
    pascal = to_pascal(slug)
    upper  = to_upper_underscore(slug)
    camel  = to_camel(slug)
    slug_rx = re.escape(slug)

    # 1) t_entity_crud → slug
    text = text.replace("t_entity_crud", slug)

    # 2) XXX / Xxx
    text = text.replace("XXX", upper)
    text = text.replace("Xxx", pascal)

    # 3) Hard rule: exact `xxxId` / `<slug>Id` → <camel>Id
    text = re.sub(r'(?<![A-Za-z0-9_])xxxId\b', camel + 'Id', text)
    text = re.sub(rf'(?<![A-Za-z0-9_]){slug_rx}Id\b', camel + 'Id', text)

    # 4) All other `xxx` occurrences in code → raw slug (as-is, dashed)
    text = re.sub(r'(?<![A-Za-z0-9_])xxx(?=[A-Za-z0-9_])', slug, text)  # identifier prefix
    text = re.sub(r'(?<![A-Za-z0-9_])xxx(?![A-Za-z0-9_])', slug, text)  # whole token

    return text

def rewrite_content_bytes(data: bytes, file_path: str, slug: str, dry_run: bool):
    if not is_text_file(file_path):
        return data, False, None
    try:
        s = data.decode("utf-8")
    except UnicodeDecodeError:
        return data, False, None

    out_parts = []; i = 0; n = len(s); changed = False
    while i < n:
        ch = s[i]
        if ch in ('"', "'", '`'):
            q = ch; j = i + 1; esc = False
            while j < n:
                cj = s[j]
                if esc: esc = False
                elif cj == '\\': esc = True
                elif cj == q: j += 1; break
                j += 1
            seg = s[i:j]; inner = seg[1:-1]
            new_inner = apply_string_rules(inner, slug)
            if new_inner != inner: changed = True; seg = q + new_inner + q
            out_parts.append(seg); i = j
        else:
            j = i
            while j < n and s[j] not in ('"', "'", '`'): j += 1
            seg = s[i:j]; new_seg = apply_code_rules(seg, slug)
            if new_seg != seg: changed = True
            out_parts.append(new_seg); i = j

    new_text = "".join(out_parts)
    if new_text != s:
        sample = None
        if dry_run:
            idx = next((k for k,(a,b) in enumerate(zip(s, new_text)) if a!=b), -1)
            if idx < 0: idx = min(len(s), len(new_text))
            start = max(0, idx-40); end = min(len(new_text), idx+120)
            sample = new_text[start:end].replace("\n","\\n").replace("\r","\\r").replace("\t","\\t")
        return new_text.encode("utf-8"), True, sample
    return data, False, None

def detect_dto_templates(zip_entries):
    names = [e.filename.replace("\\","/") for e in zip_entries]
    found = []
    for cand in DEFAULT_DTO_TEMPLATES:
        if any(n.strip("/") == cand.strip("/") for n in names):
            found.append(cand)
    if not found:
        for n in names:
            if n.endswith("/"): continue
            if n.endswith("/xxx.dto") or n.endswith("/xxx.dto.ts"):
                found.append(n)
    return found

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inzip", required=True, help="Path to template .zip")
    ap.add_argument("--slug", required=True, help="New slug (lowercase letters, numbers, dashes)")
    ap.add_argument("--out", dest="outdir", default=".", help="Output directory")
    ap.add_argument("--dry-run", action="store_true", help="Show plan, make no changes")
    ap.add_argument("--force", action="store_true", help="Overwrite output zip if exists")
    ap.add_argument("--dto-fs", dest="dto_fs", default="", help="Optional: path to xxx.dto or xxx.dto.ts on disk")
    ap.add_argument("--dto-fs-outdir", dest="dto_fs_outdir", default="", help="Optional: output dir for filesystem DTO (defaults to source dir)")
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

    print("nv-service-clone — dash/identifier/quote aware")
    print(f"- input: {inzip}")
    print(f"- slug:  {slug}  (Pascal={to_pascal(slug)}, camel={to_camel(slug)}, UPPER={to_upper_underscore(slug)})")
    print(f"- out:   {outzip}")
    print(f"- mode:  {'DRY RUN' if args.dry_run else 'WRITE'}")

    files = 0; changed = 0; skipped = 0; dto_inzip = []

    with ZipFile(inzip, "r") as zin:
        entries = zin.infolist()
        dto_inzip = detect_dto_templates(entries)

        zout = None if args.dry_run else ZipFile(outzip, "w", compression=ZIP_DEFLATED)

        for info in entries:
            name = info.filename.replace("\\", "/")
            if name.endswith("/"):
                if is_excluded(name): skipped += 1
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

        if dto_inzip:
            for src in dto_inzip:
                parent = str(Path(src).parent).replace("\\","/")
                dest = f"{parent}/{slug}.dto.ts" if src.endswith(".dto.ts") else f"{parent}/{slug}.dto"
                src_bytes = zin.read(src)
                rewritten, _, _ = rewrite_content_bytes(src_bytes, dest, slug, args.dry_run)
                if args.dry_run:
                    print(f"CLONE DTO {src}  ->  {dest}"); changed += 1
                else:
                    zout.writestr(dest, rewritten); changed += 1

        if not args.dry_run and zout: zout.close()

    print("\nSummary:")
    print(f"- files processed: {files}")
    print(f"- changed (renamed/edited): {changed}")
    print(f"- skipped (excluded): {skipped}")
    if dto_inzip:
        print("- dto templates cloned (in-zip):")
        for p in dto_inzip: print(f"  - {p}")
    else:
        print("- dto templates cloned (in-zip): none found (OK if using --dto-fs)")
    print("(dry run only, no zip written)" if args.dry_run else f"- wrote: {outzip}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}\nHint: check --in path, slug format, and write permissions.", file=sys.stderr)
        sys.exit(1)
