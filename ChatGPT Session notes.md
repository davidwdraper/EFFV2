# nowvibin-session-notes-2025-10-08

> Snapshot for next session. Plain, tight, and copy/paste-able.

## Smoke focus

- **Smoke #8 flow**: test → **gateway** → **auth** → **user** → **delete (by \_id)**.
- Current: health checks pass (`003 auth`, `004 user`). #8 was failing due to gateway proxy body handling + route drift in auth. We fixed both.

---

## Decisions (locked)

1. **Create = PUT** (SOP). `POST /create` is **not** supported once stabilized.
2. **User stores an opaque hash**. User service **doesn’t care** if it’s mock or real (ADR **adr0021-user-opaque-password-hash**).
3. **Deletes are `_id` only.** No delete-by-email. Idempotent 200 on missing.
4. **App shape for all services**: `<Slug>App extends AppBase`; launcher uses shared `Bootstrap.run(() => new <Slug>App().app|instance)`.
5. **Gateway is a dumb pipe for bodies**. No parsing/rewrites. Headers only (see Proxy Rules below).
6. **Versioned health** everywhere: `/api/<slug>/v<major>/health/{live,ready}`.
7. **Dev bind**: `127.0.0.1` by default (MODE=dev/local/test). Stg/Prod bind `0.0.0.0`. Overridable via `HOST`.

---

## Code/state as of end of session

### Auth

- **Routes** (relative; no `/v1` inside router):
  - `PUT /create` → handled by `AuthCreateController.create()` (thin; returns 200 ACK for stabilization).
- **App**: `AuthApp extends AppBase` mounts:
  1. versioned health
  2. `express.json({ limit: "1mb" })`
  3. `responseErrorLogger(this.service)`
  4. `app.use(baseV1, authRouter)`
  5. `problem` sink
- **Launcher**: `index.ts` uses `Bootstrap({service:"auth"})` and `new AuthApp().instance`.
- **Fixed drift**: earlier router mounted `/v1/create` (double `/v1` → 404) and tried to call a Promise instead of mounting a `RequestHandler` (hang). Both corrected.

### User

- **Controllers present** (7):
  - `user.base.controller.ts` (⚠ _contains old mock-hash enforcement messages_).
  - `user.create.controller.ts` (S2S-only PUT `/create`).
  - `user.signon.controller.ts` (S2S stub).
  - `user.changepassword.controller.ts` (S2S stub).
  - `user.read.controller.ts` (GET `/users/:id` stub).
  - `user.update.controller.ts` (PATCH `/users/:id` stub).
  - `user.delete.controller.ts`:
    - CRUD: `DELETE /users/:id` → **remove()**
    - S2S: `DELETE /delete/:id` → **s2sDeleteById()** (ACK idempotent for #8)
- **Routers**:
  - `UserS2SRouter` (guards via `verifyTrustedCaller`; expects `x-service-name` in **S2S_ALLOWED_CALLERS**).
  - `UsersCrudRouter` (read/update/delete).
- **App**: `UserApp extends AppBase` with health → error logger → S2S + CRUD → final error sink.

### Gateway

- **Proxy rules (finalized for stabilization)**:
  - Do **not** parse or serialize the request body on proxy paths.
  - Strip hop-by-hop headers:
    - `connection, keep-alive, proxy-authenticate, proxy-authorization, te, trailer, transfer-encoding, upgrade, host, content-length, accept-encoding`
  - Add/preserve only:
    - `x-service-name: gateway`
    - `x-request-id` (preserve or mint)
    - `x-api-version` (preserve)
  - Forward **raw stream** (`body: req`); **never** set `content-length`.
  - Mirror upstream status; forward safe response headers.
- **Mount order** in `GatewayApp`:
  1. versioned health for gateway
  2. `edgeHitLogger()`
  3. `responseErrorLogger("gateway")`
  4. `app.use("/api", makeProxy(svcConfig))`
  5. final error handler  
     (_No `express.json()` on proxy path_)

### Bootstrap (shared)

- Uses EnvLoader; emits `env_loaded` with `{ HOST_SELECTED }`.
- Mode-based default host: dev/local/test → `127.0.0.1`; staging/prod → `0.0.0.0`. Can override with `HOST` env or `options.host`.
- Structured error logs with `name/message/stack` for `preStart`, `build_handler_failed`, `server_error`.

---

## Outstanding FIXMEs / follow-ups (ranked)

1. **Remove mock-hash enforcement from User base**:

   - In `user.base.controller.ts`, drop `isMockHash` checks & the `"hashedPassword must be a mock hash"` messages.
   - Keep only: presence/shape validation. User does not validate hash **type**—that’s Auth’s business.
   - Update tests accordingly.

2. **Finish #8 fully**:

   - Wire `AuthCreateController` → call `User` via gateway:
     - Construct envelope: `{ user: { email }, hashedPassword: <opaque string> }`
     - For now, you can keep a **mock** KDF in Auth (`mock-hash::${password}`) but **don’t** make User care.
     - Expect 202/200 from user.create once persistence lands; currently ACKs 202 (stub).

3. **S2S allowlist**:

   - Set `S2S_ALLOWED_CALLERS=gateway` in **user** (and in auth if/when guarded).
   - Gateway always sends `x-service-name: gateway`.

4. **Ports/hosts**:

   - Dev expected defaults:
     - gateway: `127.0.0.1:4000`
     - auth: `127.0.0.1:4010`
     - user: `127.0.0.1:4020`
   - Ensure `.env.dev` contains `HOST=127.0.0.1` if you don’t keep the MODE-based default.

5. **`run.sh`** robustness (optional next):

   - Kill **process groups** and/or ports before start to prevent EADDRINUSE by orphans.

6. **Refactor idea (after #8 green)**:
   - Pull common `AppBase.configure()` bits into **AppBase** with overridable hooks (health mount prefix, whether to include response logger, etc.) so new services are 1-file clones.

---

## Commands we used / will use

### Direct checks

```bash
# Auth health
curl -sS http://127.0.0.1:4010/api/auth/v1/health/live | jq .

# User health
curl -sS http://127.0.0.1:4020/api/user/v1/health/live | jq .
```
