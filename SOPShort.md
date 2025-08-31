✅ NowVibin Backend — Pocket SOP v4 (Checklist)

🔗 Routes (No Exceptions)

API: http(s)://<host><port>/api/<serverName>/<rest>

Health: http(s)://<host><port>/<healthRoute>

<serverName> = env config key.

📐 Service Pipeline (Template Clone)

Contract → Zod in shared/contracts/<entity>.contract.ts (truth)

DTOs → .pick/.omit/.partial from contract

Mappers → domainToDb, dbToDomain

Model → persistence only, indexes, bufferCommands=false

Repo → return domain objects only

Controller → validate → DTO → repo → return domain, push audits

Routes → one-liners, import handlers only

⚖️ Prime Directives

No splicing. Full file drops, repo path on line 1.

No barrels, no shims, no hacks.

Env names only.

Debug logs (enter/exit) w/ requestId.

Controllers push → req.audit[], flush once.

Global error middleware only.

📋 Session Ritual

Paste this Pocket SOP.

State service name.

Paste full files.

I return full drops, no options.

✅ Quick Checklist Before Merge

Required envs asserted

No logic in routes

RequestId logs on entry/exit

Audit flushed once

.env.test present

Tests green via gateway and direct

Coverage ≥90%

Seeds idempotent + descriptive

No barrels/shims/console logs

Authority: Long SOP v4 (Amended). This sheet = working memory.
