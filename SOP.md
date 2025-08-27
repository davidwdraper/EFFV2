NowVibin Backend — New-Session SOP (Act-style + shared test harness) — v4

Paste this at the start of each session. It keeps all services identical, audit-ready, and test harnesses consistent.

Prime Directives

Never overwrite unseen work. If a file already exists, you must paste the full, current file (with repo path in the first line) before I make changes. No guessing, no partials.

State-of-the-art, fast, scalable, audit-ready.

Single-concern source files; shared logic in services/shared.

Full file drops only. No fragments, no inline edits.

You never give me options. No "Option A / Option B". Decide and deliver.

All services mirror Act structure 1:1.

Routes = one-liners. No logic in routes.

No baked values. Env names only; values come from env files.

Instrumentation everywhere (pino / pino-http).

Audit all mutations. Controllers push → req.audit[], flushed once.

try/catch everywhere that matters. asyncHandler + global error middleware.

Audit-ready: explicit env validation, consistent logging, no silent fallbacks.

Every file begins with repo path in a // comment.

Dev bootstrap may default ENV_FILE to .env.dev; prod must set explicitly.

No shims. If a contract/type isn’t ready, we build the real one in shared.

No barrels. No index.ts re-exports, no export \*. Always import directly.

Canonical Service Layout (Act-style)

(unchanged; omitted here for brevity — still the Act template with scripts, src, test, etc.)

Environment Policy

(unchanged)

Bootstrap & Index

(unchanged)

Logging & Audit

(unchanged)

Performance / Ops Notes

(unchanged)

Test Harness

(unchanged)

Import Discipline (No Barrels)

(unchanged)

Contracts (No Shims)

(unchanged)

Where We Left Off (Act)

(unchanged — still timestamps bug and repo fixes)

Session-start Ritual

Paste this SOP.

Say which service we’re on.

Paste existing files I must merge (full, with repo path).

I deliver full drops, no options.

Quick Sanity Checklist

No logic in routes.

Required envs asserted.

bufferCommands=false; indexes in models.

Request-ID logging.

Audit events flushed.

.env.test present.

Tests green via gateway (4000) + direct (4002).

Coverage ≥90% all metrics.

Seeds idempotent + descriptive.

No shims; no barrels.

Only shared contracts for shared shapes.

All existing files pasted in full before modification.

End SOP v4

We have been having no luck wiping out the test failures.
We are going to refactor, yet again, to remove redundency in data modeling.
The following is an SOP Addendum...
