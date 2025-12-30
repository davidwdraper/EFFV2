Principle zero (so we stop bleeding time)

code.pipelineBoot is not a pipeline handler. It’s orchestration preflight.

It must not be inserted into steps[]

It must not be persisted as a “handler-test” record

It must not require a test as a handler, because it isn’t one

If preflight is needed, do it in the orchestrator before steps execute, and record it as:

run-level metadata, or

“preflight failure” stamped onto each real handler record (optional)

That’s your drift concern #1, and you’re right.

Step 1 — Prove SvcRuntime (rt) can be built, by itself

We stop talking about test-runner. We stop talking about pipeline indexes. We prove the rt creation contract in isolation.

Checkpoint 1A: “rt exists” at the exact moment AppBase is constructed

Your error proves the current reality:

new AuthApp -> AppBase throws SVCRUNTIME_MISSING

So the only thing that matters right now is:
Does createApp() pass { rt } into the app constructor?
Not “should,” not “intended,” not “ADR-0080 said.” The code either does or doesn’t.

What we do (no guessing, no refactor):

In backend/services/auth/src/app.ts, add a single debug line right before new AuthApp(...) (or whatever your createApp returns) that logs:

hasRt: !!rt

and if you want: rtCaps or rt.getEnvLabel() if that’s safe/non-throwing

Rebuild auth (npx tsc -p ... whatever you do) and run the exact test-runner scenario again.

Pass condition: that log prints hasRt: true and the AppBase ctor does not throw.

Fail condition: hasRt: false or you never see the log (meaning test-runner is loading a different build artifact than you think).

The only file I need for Step 1

Paste one file (whole thing):

backend/services/auth/src/app.ts

That’s it. Not 6. Not 4. One.

Because until that file is correct, everything else is shadow boxing.

Step 2 — Prove we can build a “virtual server app” with rt injected

Once Step 1 passes, we do the same for the test-runner’s virtual-server loading.

Checkpoint 2A: test-runner creates the target app without inventing handlers

This means:

The virtual-server boot path must do:

build/load rt

call target service createApp({ rt, ... }) (or whatever your signature is)

get back an AppBase instance (or derived)

extract registry/controller/pipeline index information

No code.pipelineBoot in steps[]. Boot is boot.

What we do

If the test-runner currently “seeds rt” by injecting a fake handler, we rip that out.

Replace with a single preflight function like:

preflightLoadTargetAppAndPipeline()

If it fails, fail fast for the run (or mark all scenarios failed) but don’t pretend you ran handler steps.

Pass condition: target app is constructed and we can reach “load pipeline index” without touching real handlers yet.

Step 3 — Prove pipeline index load returns steps array (again, isolated)

You said:

TreeWalker returns a single index.js with 8 steps (good)

It used to work when targeting index.ts

Now steps is undefined and you’re hitting .length on undefined (classic)

So we isolate that.

Checkpoint 3A: “resolved.steps is an array” immediately after load

Right after the loader reads the index module, do:

Array.isArray(resolved.steps) check

If false, throw a contract error that prints:

the keys exported by the module (Object.keys(mod))

what path it loaded

what it expected (steps: HandlerBase[])

Pass condition: steps is an array length 8.
Fail condition: steps undefined → loader and compiled index export shape disagree.

This is not a “test-runner is complex” issue. It’s a contract mismatch.

The only way we finish this quickly

We do exactly what you proposed:

rt construction (auth createApp must pass rt) ✅

virtual server app can be created with injected rt ✅

rails inject rt into scenario ctx and execute real steps ✅

And we do it with one-file-at-a-time evidence, not archaeology.

Next action

Paste this single file (whole thing):

backend/services/auth/src/app.ts

Then I will tell you, concretely:

where rt is being dropped (or mis-threaded),

what the minimal fix is,

and how to verify Step 1 is green before we touch anything else.

No new features. No “helpful improvements.” Just making the damn runtime exist.
