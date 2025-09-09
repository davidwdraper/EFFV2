# NowVibin — Architecture (Front Door)

This folder is the **buyer/auditor-facing** truth. Keep it terse; link out to Design for how.

- Backend: `./backend/`
- Frontend: `./frontend/` (stub for now)
- Shared (cross-cutting): `./shared/`
- Line items (append-only facts): `./LINE_ITEMS.md`
- ADRs live in `/docs/adr`

Conventions:

- Tag facts in `LINE_ITEMS.md` like `[BE-AUDIT]`, `[XCUT-SEC]`, `[ROUTE]`, `[BUILD]`.
- Prefer links to Design docs rather than long prose here.
