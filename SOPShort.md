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

Route Semantics — Create / Replace / Update

Non-negotiable rules for entity endpoints:

Create

Always PUT to the collection root (e.g. PUT /api/user, PUT /api/act).

No :id in the path; the service generates \_id (Mongo).

Response must include the \_id so clients/tests can chain GET/DELETE.

Mirrors our Act service contract.

Replace

PUT /api/<entity>/:id is not supported in our system.

We never PUT with a known id (Mongo owns \_id).

Any “replace” semantics happen as a PATCH-like flow (not full object replace).

Update / Patch

PATCH /api/<entity>/:id for partial updates.

Must validate against z<Entity>Patch.

Read

GET /api/<entity>/:id returns the domain object.

Delete

DELETE /api/<entity>/:id removes the entity.

DELETE must be idempotent: return 200/202/204 if deleted, 404 if already gone.
