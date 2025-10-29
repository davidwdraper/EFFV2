adr0045-nv-service-clone-tool

# ADR-0046 — NV Service Clone Tool (zip → rename → zip)

**Status:** Accepted  
**Date:** 2025-10-28

## Context

We frequently need to spin up new CRUD-style services by cloning the `t_entity_crud` template. Manual file/folder renames and content substitutions (e.g., `xxx`/`Xxx`) are error‑prone and slow. We also require strict SOP guarantees:

- Never overwrite unseen work.
- Whole‑file changes only (no in-place edits to existing repos without an explicit target).
- Auditability of what was changed.
- No environment fallbacks or hardcoded secrets.
- Output should be a single archive that can be dropped into the repo.

## Decision

Create a CLI tool (`tools/nv-service-clone.ts`) that:

1. Accepts a template `.zip` file as input.
2. Unzips in memory and performs **case‑aware** renames:
   - `xxx` → `<slug>` (lowercase)
   - `Xxx` → `<SlugPascal>` (derived from slug)
   - `t_entity_crud` → `<slug>` (service folder/package names)
   - `XXX` → `<SLUG_UPPER>` (rare; supported for completeness)
3. Applies replacements in **folder names**, **filenames**, and **file contents** (text files only).
4. Enforces exclusions: `.git/**`, `node_modules/**`, `dist/**`, lockfiles, images/binaries.
5. Provides a **dry‑run** mode that prints a rename plan + content diff samples.
6. Is **idempotent** and refuses to overwrite an existing non‑empty target unless `--force`.
7. Emits a new zip named `nowvibin-<slug>-service.zip` containing the fully renamed tree.

## Consequences

- Faster, repeatable service creation with fewer human errors.
- Clear audit trail via dry‑run output and final summary.
- Minimal dependencies (`adm-zip`), staying within Node/TypeScript ecosystem we already use.

## Implementation Notes

- Word‑boundary aware replacement for contents to avoid changing substrings unintentionally.
- File‑type allowlist for content rewriting (ts, js, json, md, yml, sh, etc.).
- Binary pass‑through (no edits).
- Exit non‑zero on validation errors; print suggestions for Ops triage.
- Dev == Prod invariant: logic behaves the same across environments.

## Alternatives Considered

- Bash v3.2 script using `zip/unzip/sed`: portable, but brittle for content safety and binary handling.
- Python: robust I/O, but adds another language/runtime to our toolbelt.
- Yeoman or Nx generators: overkill and less transparent for our needs.

## References

- SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
- DTO‑first design rules and file discipline (session notes 2025‑10‑28)
