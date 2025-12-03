Memo: Logger Refactor + Auth Signup Fix
A. Logger Refactor (PIPELINE + EDGE + sane ownership)

Refactor Logger levels to include PIPELINE and EDGE

Current state: DEBUG/INFO/WARN/ERROR (and maybe TRACE-ish behavior), but EDGE existed in v2 and isn’t wired in v3 yet. PIPELINE doesn’t exist at all.

Target level ordering (lowest → highest):

debug

pipeline ← NEW

edge ← RESTORED

info

warn

error

Semantics:

debug: noisy internals, per-line trace, dev-only deep dives.

pipeline: “follow the controller pipeline” view; handler start/end, pipeline begin/end, minimal but structured.

edge: HTTP edges — inbound/outbound requests (gateway + S2S); helps see traffic and S2S behavior even when debug is off.

info+: business-level events, ops-relevant data.

Implementation note:

Extend the shared logger interface in @nv/shared/logger/Logger to support .pipeline() and .edge() alongside the others.

Internally, it can still delegate to console/pino, but the public ILogger type must expose all methods consistently.

Make logger ready for multiple sinks later (but only one sink now)

Short-term: still a single sink (console or pino), no extra complexity.

Design goal: logger must be able to:

Route messages to different sinks later (console, log-service client, maybe file/WAL) via a simple internal fan-out.

Use envService configuration to control:

Minimum log level

Which levels persist to the DB

For now:

Keep a single backing “core logger” (e.g., pino/console).

Introduce a small, internal abstraction layer (e.g., ILogSink or similar) so we’re not locked into console.

Do not over-engineer routing yet; just ensure we don’t make it painful to add a log-service sink later.

Logger must be a first-class singleton on AppBase

AppBase must own a single ILogger instance, created at boot, and:

Expose getLogger(): ILogger (or getBoundLogger(ctx) variants if needed).

Optionally expose convenience getters on controllers/handlers (e.g., controller.getLogger() delegating to app).

No more ad-hoc getLogger() imports per file. The logger is part of the rails, not a static global utility.

Lifecycle:

Constructed once at AppBase boot.

Injected into handlers/controllers via the existing rails (ControllerBase/HandlerBase already carry a log—align that with the AppBase logger).

Kill all the bespoke/narrow logger aliases as we go

We currently have places where the logger type is narrowed or redefined locally (e.g., custom { debug: () => void } shape instead of ILogger).

Policy going forward:

Every time we touch a file that does logger work, normalize it to the shared ILogger interface from @nv/shared/logger/Logger.

No custom local logger types. No narrowing.

If something only uses .info(), that’s fine, but the variable should still be typed as ILogger.

This will be incremental: don’t go hunting across the entire repo right now, but any file we modify should be brought into alignment.

B. Pipeline Logging for Auth Signup

Add PIPELINE-level logging to the auth signup controller

Target: auth.signup MOS pipeline.

Controller side:

At pipeline selection (inside AuthSignupController.put / getSteps), log at PIPELINE:

Pipeline name: e.g., "auth.signup.signupPipeline"

Purpose: "user signup: create User + UserAuth credentials"

Handler order, by name, in the order they’ll execute.

To keep it less brittle, derive names from the handler instances returned by getSteps():

e.g., handler.constructor.name → ["HydrateUserBagHandler", "ExtractPasswordHandler", "GeneratePasswordHashHandler", "CallUserCreateHandler", "CallUserAuthCreateHandler"]

At pipeline completion (in finalize()):

Log at PIPELINE:

status: "success" or "error"

dtoType, op, requestId

Whether ctx["bag"] is present and correctly typed (for success).

Handler side:

Each handler in the signup pipeline logs at PIPELINE:

On entry: pipeline_enter with { handler: "<name>", requestId, dtoType, op }.

On exit:

For success: pipeline_exit with { handler: "<name>", status: "ok", keyState… } (e.g., bag size, presence of ctx keys).

For error: still pipeline_exit but with status: "error" and maybe an errorMessage field.

Don’t spam DEBUG for these; keep them at PIPELINE specifically so we can turn them on/off independently.

C. Finish Debugging Auth Signup (User + UserAuth + explicit ids)

Finish the auth signup pipeline logic, including explicit \_id creation

Current state (rough mental model):

Pipeline: HydrateUserBagHandler → ExtractPasswordHandler → CallUserCreateHandler → GeneratePasswordHashHandler → CallUserAuthCreateHandler (or similar).

HydrateUserBagHandler:

Hydrates ctx["bag"] with a singleton DtoBag<UserDto> from the inbound wire bag.

ExtractPasswordHandler:

Reads x-nv-password header.

Validates presence / basic rules.

Stores cleartext on ctx["signup.passwordClear"].

CallUserCreateHandler:

Uses ctx["bag"] (UserDto bag) to call user.create via SvcClient.

On success, must hydrate ctx["bag"] from the returned wire bag (DtoBag<UserDto>) so upstream id and meta are present.

That allows us to read the canonical userId (either \_id or a dedicated field depending on the UserDto contract).

What’s left to do / fix:

User id source of truth

Decide & enforce:

userId (foreign key for UserAuth) should come from UserDto.

Likely pattern: userId = dto.getId() from the user DTO after create returns.

After CallUserCreateHandler succeeds:

Ensure ctx["signup.userId"] is set from the UserDto created.

Do not rely on Mongo-side id generation without capturing it; we either:

Let DbWriter.generate id via ensureId() then persist and keep it on DTO, OR

Id was already set on DTO before persistence.

Password hash generation

Implement GeneratePasswordHashHandler (name can be adjusted, but purpose must be crystal clear):

Input:

ctx["signup.passwordClear"] (cleartext password)

ctx["signup.userId"]

Output:

ctx["signup.hash"]

ctx["signup.hashAlgo"]

Optionally ctx["signup.hashParamsJson"]

For now: use a simple, deterministic algo placeholder (e.g., bcrypt/argon2 with fixed params or even a mock hash string) but structure it exactly as we’d plug in the real hasher later.

This handler should not write to DB. It strictly transforms cleartext → hash materials and stamps them on ctx.

UserAuth DTO creation via registry (no fromJson)

In CallUserAuthCreateHandler:

Use the Registry to get a proper UserAuthDto instance, no manual new or fromJson from ctx:

e.g., const dto = registry.newDto<UserAuthDto>("user-auth") or the current equivalent factory.

Set the DTO’s fields via setters or direct fields, but aligned with validation rules:

dto.userId = ctx["signup.userId"] (foreign key to user)

dto.hash = ctx["signup.hash"]

dto.hashAlgo = ctx["signup.hashAlgo"]

dto.hashParamsJson = ctx["signup.hashParamsJson"] ?? undefined

dto.failedAttemptCount = 0

dto.passwordCreatedAt = new Date().toISOString()

Wrap that in a DtoBag<UserAuthDto> and call SvcClient.call():

slug: "user-auth"

dtoType: "user-auth"

op: "create"

method: "PUT"

The auth pipeline must leave ctx["bag"] as the original UserDto bag so the HTTP edge returns user profile JSON, not auth credentials.

Explicit \_id creation for UserAuth

Apply the new id rules:

DbWriter will call dto.ensureId() before toBody().

For MOS flows where we want full transparency, we can optionally:

Call dto.ensureId() in the pipeline before calling the writer, if we want to guarantee a \_id exists as part of DTO state early.

For UserAuthDto, we’re fine with:

Letting DbWriter call ensureId() (using the new uuid helper).

Or calling it explicitly in the pipeline if we want the id available for logs / correlation downstream.

Fix the current error: missing ctx fields

That error from earlier:

auth_signup_missing_auth_fields complaining about ctx["signup.userId"], ctx["signup.hash"], ctx["signup.hashAlgo"].

Fix path:

After CallUserCreateHandler, set ctx["signup.userId"].

After GeneratePasswordHashHandler, set ctx["signup.hash"] and ctx["signup.hashAlgo"] (and optional params).

Only then should CallUserAuthCreateHandler run.

Update the signup pipeline index.ts to include:

GeneratePasswordHashHandler

CallUserAuthCreateHandler

Ensure the order is correct and that getSteps() returns the full list.

Next Session Starter Line

When we start the new session, expect to begin with something like:

“We’re resuming the auth signup work. Let’s first wire PIPELINE/EDGE into the logger and then instrument the auth.signup pipeline with pipeline-level logs. After that, we’ll finish the signup MOS: user.create → user-auth.create with explicit ids, and clean up any logger aliasing we touch along the way.”
