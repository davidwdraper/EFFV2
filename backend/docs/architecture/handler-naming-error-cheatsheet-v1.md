
# Handler Naming + Error Handling Cheat-Sheet (v1)

## Scope

- Applies to all `HandlerBase` subclasses across services.
- Covers:
  - How to name handlers consistently.
  - How they log.
  - How they report errors without making a mess.
- Grounded in: ADR-0041, ADR-0042, ADR-0043, ADR-0049, ADR-0058, ADR-0066 (where relevant).

## 1. Handler Naming Convention

**Canonical pattern:**

```
<part1>.<part2>.[<part3>...]
```

- `part1` is **always** one of:
  - `s2s`
  - `db`
  - `code`
  - `api`

### Examples

**S2S handlers**
- `s2s.auth.signup`
- `s2s.env-service.load-config`
- `s2s.user.create`

**DB handlers**
```
db.<dbName>.<collectionName>.<op>
```
- Ops are required.

Examples:
- `db.nv.env-service-values.find-one`
- `db.nv.users.insert-one`
- `db.nv.users.update-one`
- `db.nv.users.ensure-indexes`

**Code handlers**
- `code.auth.signup.hydrate-user-bag`
- `code.env-service.config.load-root`
- `code.user.signup.validate`

**API handlers**
- `api.auth.signup`
- `api.gateway.proxy`
- `api.env-service.config.load-root`

### Where the name appears
Used in:
- `handlerName()`
- HandlerBase logs
- PIPELINE logs

## 2. Logging Expectations

Every handler log event carries:
- `service`
- `component`
- `handler`
- `event`
- `handlerStatus`
- `requestId`
- `origin`

## 3. Error Handling Levels

1. **Handler-level**
   - Use try/catch only for *expected* failures.
   - Set `ctx["response.*"]`, mark `handlerStatus="error"`.

2. **Pipeline**
   - Single catch for unexpected throws.
   - Logs once with `rawError` + first frame.
   - Converts into RFC 7807 problem payload.

3. **Controller finalize()**
   - Success: requires one-writer-only `ctx["bag"]`.
   - Error: trusts pipeline handler to have set response.

## 4. Try/Catch Template

```ts
try {
  // work
} catch (rawError) {
  const problem = makeProblem({
    type: "about:blank",
    title: "Internal Error",
    detail: "Unable to hash password.",
    status: 500,
    code: "AUTH_HASH_FAILED",
    requestId: ctx.requestId
  });

  ctx.handlerStatus = "error";
  ctx.set("response.status", 500);
  ctx.set("response.body", problem);
  ctx.set("error", rawError);

  this.logger.error({
    service: this.serviceName,
    component: this.constructor.name,
    handler: this.handlerName(),
    event: "error",
    handlerStatus: ctx.handlerStatus,
    requestId: ctx.requestId,
    rawError,
    firstFrame: this.getFirstFrame(rawError)
  });
}
```

## 5. First-Frame Extraction

- Log first real frame from stack.
- Ops sees the exact failure line.

## 6. Quick Dos and Don’ts

**Do**
- Use the naming convention.
- Respect `handlerStatus`.
- Let only hydrate handler write `ctx["bag"]`.
- Use Problem Details.
- Log errors once.

**Don't**
- Don’t rethrow after shaping an error.
- Don’t mutate ctx["bag"] except hydrate.
- Don’t swallow errors.
