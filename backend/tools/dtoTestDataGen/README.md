<!-- backend/tools/dtoTestDataGen/README.md -->

# dtoTestDataGen (NV helper tooling)

This folder exists so future-you doesn’t “clean up scripts” and delete core rails.

## What this is

Two tools, by design:

- `nv-dto-scan` — discovers `*.dto.ts` files (pipe-friendly)
- `nv-dto-gen` — generates one adjacent `*.dto.tdata.ts` sidecar for one DTO

Sidecars are **happy-only deterministic fixtures**. Variants are minted downstream by test tooling.

## Default scan root

If you run scan with no args, it scans:

`backend/services/shared/src/dto/**`

## Running (until NV has a first-class runner)

Use:

```bash
cd <repo-root>
backend/tools/dtoTestDataGen/run.sh scan
backend/tools/dtoTestDataGen/run.sh gen --dto backend/services/shared/src/dto/user.dto.ts --write
```
