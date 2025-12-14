# nv-shared-interfaces-reference.md
<!--
Path: docs/dev/nv-shared-interfaces-reference.md

Docs:
- SOP: docs/architecture/backend/SOP.md (Reduced, Clean)
- LDD Working Set: LDD-00..34 (working compression)
- ADRs referenced by the summarized sources:
  - ADR-0013, ADR-0032, ADR-0039, ADR-0040, ADR-0041, ADR-0042, ADR-0043, ADR-0044, ADR-0045, ADR-0047, ADR-0048, ADR-0049, ADR-0050, ADR-0053, ADR-0057, ADR-0059, ADR-0060, ADR-0064, ADR-0069, ADR-0070, ADR-0071, ADR-0072

Purpose:
- Developer-facing “interface map” for the most-used NV shared base classes/helpers.
- Designed to be uploaded at the start of a session so the assistant can reason about
  interfaces without guessing and without needing a dozen file uploads.

Scope (this seed set):
- AppBase
- ControllerBase / ControllerJsonBase + controllerContext helpers
- DtoBag
- DtoBase
- Mongo query coercion helper
- DbWriter facade (+ edge-mode config)
- DbReader facade
-->

## Conventions used in this doc

- “ctx[... ]” refers to keys stored in `HandlerContext`.
- “wire bag” refers to the canonical response envelope produced by controller finalize (JSON):
  `{ ok: true, items: [...], meta: {...}, warnings?, nextCursor? }`
- Errors are Problem+JSON (`application/problem+json`). When errors are surfaced, the controller
  uses `ctx["handlerStatus"]="error"` plus `ctx["response.status"]` and `ctx["response.body"]`.

---

## AppBase
**File:** `backend/services/shared/src/base/app/AppBase.ts`

### Role
Orchestrates Express composition for all services:
- boot + DB ensure (via shared helper)
- health + env reload routes
- standardized middleware layers (pre, policy gate, parsers, post)
- constructs shared clients (SvcClient, PromptsClient)
- holds **EdgeMode** resolved at boot (immutable)

### Constructor
```ts
type AppBaseCtor = {
  service: string;
  version: number;
  envLabel?: string;              // optional; else derived from EnvServiceDto.getEnvLabel()
  envDto: EnvServiceDto;          // required
  envReloader: () => Promise<EnvServiceDto>;  // required (used by env reload route)
  checkDb: boolean;               // if true => performDbBoot() runs ensureIndexes etc.
  edgeMode?: EdgeMode;            // optional; defaults to EdgeMode.Prod
};
```
**Notes**
- Creates internal `Express` instance and disables `"x-powered-by"`.
- Instantiates `SvcClient` via `createSvcClientForApp({ service, version, log })`.
- Instantiates `PromptsClient` via `createPromptsClientForApp({ service, log, svcClient, getEnvLabel, getRequestId? })`.

### Key getters
```ts
public get svcEnv(): EnvServiceDto;     // Env DTO (public accessor)
public getLogger(): IBoundLogger;       // app-owned bound logger
public getPromptsClient(): PromptsClient;
public getSvcClient(): SvcClient;
public getEnvLabel(): string;           // env label (ctor override or envDto.getEnvLabel())
public getEdgeMode(): EdgeMode;         // immutable boot-time decision
public abstract getDtoRegistry(): IDtoRegistry;
public get instance(): Express;         // throws if !booted
```
### Convenience
```ts
public async prompt(language: string, promptKey: string, params?, meta = {}): Promise<string>;
```
Delegates to `PromptsClient.render()`.

### Boot lifecycle
```ts
public async boot(): Promise<void>;
```
Boot sequence (high-level):
1) `await onBoot()` → default calls `performDbBoot({ ..., registry: getDtoRegistry() })`
2) Mount health + env reload routes if `computeHealthBasePath(service, version)` yields base path
3) Mount layers:
   - pre-routing
   - route policy gate (svcconfig resolver hook)
   - `mountSecurity()` (override hook; default no-op)
   - parsers
   - `mountRoutes()` (abstract; service-specific)
   - post-routing (error sink, etc.)
4) Mark `_booted = true` and log `"app booted"`

### Override hooks
```ts
protected async onBoot(): Promise<void>;        // override sparingly
protected readyCheck(): (() => boolean | Promise<boolean>) | undefined;
protected mountSecurity(): void;               // verifyS2S, rate limits, etc.
protected abstract mountRoutes(): void;        // required
protected getSvcconfigResolver(): ISvcconfigResolver | null; // optional, default null
```

### AppBase invariants (operational)
- `instance` is illegal until `await boot()` has completed.
- Env label is a single source of truth for controllers and handlers.
- EdgeMode is resolved once and must not be recomputed per call site.

---

## ControllerBase (abstract)
**File:** `backend/services/shared/src/base/controller/ControllerBase.ts`

### Role
Shared controller orchestrator:
- seeds `HandlerContext`
- enforces preflight (env + registry)
- seeds DTO hydrators into context
- runs handler pipelines
- delegates response materialization to `finalize(ctx)` (abstract)

### Constructor
```ts
constructor(app: AppBase)
```
- Captures AppBase
- Binds a logger (prefers app.log.bind({component:"ControllerBase"}); otherwise shared logger)

### Public surface
```ts
public getApp(): AppBase;
public getDtoRegistry(): IDtoRegistry;    // throws if app does not provide it
public getSvcEnv(): EnvServiceDto;        // via app.getSvcEnv() or app.svcEnv; throws if missing
public getEnvLabel(): string;             // via app.getEnvLabel(); throws if missing/empty
public getLogger(): IBoundLogger;
public needsRegistry(): boolean;          // default true; override if registry not required
```

### Context helpers (protected)
```ts
protected seedHydrator(ctx: HandlerContext, dtoType: string, opts?: { validate?: boolean }): void;
protected makeContext(req: Request, res: Response): HandlerContext;
protected makeDtoOpContext(req: Request, res: Response, op: string, opts?: { resolveCollectionName?: boolean }): HandlerContext;
protected preflight(ctx: HandlerContext, opts?: { requireRegistry?: boolean }): void;
protected async runPipeline(ctx: HandlerContext, handlers: HandlerBase[], opts?: { requireRegistry?: boolean }): Promise<void>;
```

### Finalize hook (required)
```ts
protected abstract finalize(ctx: HandlerContext): Promise<void>;
```
**Invariant**
- Success responses must be built **strictly** from `ctx["bag"]` (DtoBag).

---

## ControllerJsonBase (concrete finalize)
**File:** `backend/services/shared/src/base/controller/ControllerJsonBase.ts`

### Role
Implements JSON + Problem+JSON response semantics:
- Success: `{ ok:true, items, meta, warnings?, nextCursor? }`
- Error: `application/problem+json` using normalized ProblemJson, with prompt support

### Error path triggers
- `ctx["handlerStatus"] === "error"` OR
- `ctx["response.status"] >= 400` OR `ctx["status"] >= 400`

### Error extraction priority
- Prefer `ctx["response.body"]` if it looks like an error shape with `code`
- Else use `ctx["error"]`
- If Mongo duplicate key patterns are detected, normalize `code` into:
  - `DUPLICATE_ID` (index `_id_`)
  - `DUPLICATE_CONTENT` (index name matching `/^ux_.*_business$/i`)
  - `DUPLICATE_KEY` (everything else)

### Prompts behavior on errors (critical)
- If prompts infra fails while rendering an error response:
  - return minimal Problem+JSON with `status=503`, `code="PROMPTS_INFRA_UNAVAILABLE"`
  - single ERROR log, no noisy stacks

### Success path requirements
- Requires `ctx["bag"]` with `toBody()`; otherwise emits:
  - `status=500`, `code="BAG_MISSING"`

### Success meta fields
Derived from context when present:
- `meta.count` (always)
- `meta.dtoType` from `ctx["dtoType"]`
- `meta.op` from `ctx["op"]`
- `meta.idKey` from `ctx["idKey"]`
- `meta.limitUsed` from `ctx["list.limitUsed"]`
- Merge extra `ctx["response.meta"]` into meta (ignoring `undefined` values)

### Cursor + warnings
- `body.nextCursor` from `ctx["list.nextCursor"]` (trimmed)
- `body.warnings` from `ctx["warnings"]` (logs each warning at warn)

### ADR-0071 token surfacing
- `ctx["jwt.userAuth"]` → `meta.tokens.userAuth` (string only)

---

## controllerContext helpers
**File:** `backend/services/shared/src/base/controller/controllerContext.ts`

### `seedHydratorIntoContext(controller, ctx, dtoType, opts?)`
Writes:
- `ctx["hydrate.fromBody"] = registry.hydratorFor(dtoType, { validate })`

### `makeHandlerContext(controller, req, res)`
Seeds standard context:
- `ctx["requestId"]` from header `x-request-id` else random fallback (non-UUID)
- `ctx["headers"]`, `ctx["params"]`, `ctx["query"]`, `ctx["body"]`, `ctx["res"]`
- `ctx["svcEnv"]` from controller.getSvcEnv()

If env dto missing:
- `ctx["handlerStatus"]="error"`
- `ctx["response.status"]=500`
- `ctx["response.body"]={ code:"ENV_DTO_MISSING", ... Ops guidance ... }`

Also attempts to seed env label:
- `ctx["svc.env"]=controller.getEnvLabel()` (if available; failure is ignored here)

### `makeDtoOpHandlerContext(controller, req, res, op, opts?)`
Adds:
- `ctx["dtoType"]` from `req.params.dtoType` (required)
- `ctx["op"]=op`

If `:dtoType` missing:
- sets `handlerStatus=error`, `response.status=400`, `response.body.code="BAD_REQUEST"` with route-shape hint

If `resolveCollectionName=true`:
- resolves via `registry.dbCollectionNameByType(dtoType)`
- writes `ctx["db.collectionName"]=coll`
- on failure sets `handlerStatus=error`, `response.status=400`, `response.body.code="UNKNOWN_DTO_TYPE"`

### `preflightContext(controller, ctx, opts?)`
Ensures:
- `ctx["svcEnv"]` exists else 500 ENV_DTO_MISSING
- registry exists when required else 500 REGISTRY_MISSING

### `runPipelineHandlers(controller, ctx, handlers, opts?)`
- If no prior error: runs `preflightContext`
- If still OK: loops `await h.run()` for each handler

**Important note (for drift avoidance)**
- `makeHandlerContext` currently generates a non-UUID requestId fallback. The platform direction is to have RequestId middleware set a proper id; treat this fallback as “dev-only convenience” and not a durable contract.

---

## controllerTypes
**File:** `backend/services/shared/src/base/controller/controllerTypes.ts`

### ProblemJson shape
```ts
type ProblemJson = {
  type: string;
  title: string;
  detail?: string;
  status?: number;
  code?: string;
  issues?: Array<{ path: string; code: string; message: string }>;
  requestId?: string;
  userMessage?: string;
  userPromptKey?: string;
};
```

### ControllerRuntimeDeps (structural contract for helpers)
```ts
interface ControllerRuntimeDeps {
  getDtoRegistry(): IDtoRegistry;
  getSvcEnv(): EnvServiceDto;
  getLogger(): IBoundLogger;
  getApp(): AppBase;
  needsRegistry(): boolean;
}
```

---

## DtoBag<T>
**File:** `backend/services/shared/src/dto/DtoBag.ts`

### Role
Immutable, ordered DTO container + factory for read-only view lenses (`DtoBagView`):
- no array exposure
- stable iteration
- server-side filtering/sorting/pagination *in memory* (DB-side batching is DbReader’s job)

### Constructor
```ts
constructor(items: ReadonlyArray<T>)
```
Copies input defensively.

### Core methods
```ts
count(): number;  size(): number;
get(i: number): T;
items(): IterableIterator<T>;            // yields DTOs in stable order
[Symbol.iterator](): IterableIterator<T> // for...of support
toBody(): any[];                         // calls dto.toBody() when available
ensureSingleton(throwOnError = true): boolean;
getSingleton(): T;
viewAll(): DtoBagView<T>;
```

### View builders (return NEW views; do not mutate bag)
```ts
viewFilter(predicate, base?)
viewInclude(prop, allowed, opts?, base?)
viewExclude(prop, blocked, opts?, base?)
viewWhere(plan, base?)
viewOrderBy(orderClauseOrArray, base?)
viewPaginate(offset, limit, base?)
viewDistinct(prop, opts?, base?)
viewGroupBy(prop, opts?, base?)
```

### Filtering language (declarative)
- `FilterPlan<T>` supports `and/or/not`
- `DeclarativePredicate` supports:
  - eq/ne/in/notIn
  - gte/lte/gt/lt
  - case-insensitive + string normalizer

### Invariants
- Bag holds DTO instances (normal flow).
- Bag never mutates; views are the only refinements.
- `toBody()` produces wire-safe JSON, not live DTOs.

---

## DtoBase
**File:** `backend/services/shared/src/dto/DtoBase.ts`

### Role
Base class for DTOs, owning:
- instantiation secret (prevents random `new` construction)
- `_id` lifecycle (UUIDv4, set-once; immutable)
- meta: createdAt/updatedAt/updatedByUserId/ownerUserId
- collection name plumbing
- current user type for secure field access
- secure read/write helpers driven by static `access` map
- cloning consistent with id semantics

### Instantiation secret
```ts
static getSecret(): symbol;
```
Concrete DTOs are expected to expose factory methods (`fromBody`, etc.) that use this secret.

### Shared normalizer
```ts
static normalizeRequiredName(value, fieldLabel, opts?: { validate?: boolean }): string;
```
When validate=true:
- requires non-empty
- pattern `/^[A-Za-z][A-Za-z\s'-]*$/`

### ID lifecycle
```ts
setIdOnce(id: string): void;     // validates UUIDv4; rejects overwrite w/ different id
ensureId(): string;              // generates UUIDv4 if missing; validates if present
getId(): string;                 // throws if missing
hasId(): boolean;
```

### Collection name
```ts
getCollectionName(): string | undefined;
setCollectionName(name: string): void;       // requires non-empty
requireCollectionName(): string;             // throws with Ops guidance if missing
```

### Meta stamping
```ts
stampCreatedAt(date?: Date | string): void;  // set-once
stampOwnerUserId(userId?: string): void;     // set-once (if provided)
stampUpdatedAt(userId?: string, date?: Date | string): void;
```
Finalize helper:
```ts
protected _finalizeToJson<TBody extends object>(body: TBody): TBody & DtoMeta;
```

### Access control context
```ts
setCurrentUserType(userType: UserType): void;
getCurrentUserType(): UserType;
```
Secure field helpers require the DTO constructor define a static `access` map:
```ts
protected readField<T>(fieldName: string): T;
protected writeField<T>(fieldName: string, value: T): void;
```
Errors:
- `DTO_ACCESS_MAP_MISSING`
- `DTO_ACCESS_RULE_MISSING`
- `DTO_ACCESS_DENIED_READ`
- `DTO_ACCESS_DENIED_WRITE`

### Clone
```ts
clone(newId?: string): this;   // copies fields; if newId provided => clears _id then setIdOnce(newId)
```

### Abstract expectations
```ts
abstract getType(): string;
abstract toBody(): unknown;
```

### DtoValidationError
```ts
class DtoValidationError extends Error {
  issues: Array<{ path: string; code: string; message: string }>;
}
```

---

## Mongo query coercion helper
**File:** `backend/services/shared/src/dto/persistence/adapters/mongo/queryHelper.ts`

### `coerceForMongoQuery(node: unknown): unknown`
Pure function that:
- recursively walks objects/arrays
- when it sees key `_id`, it coerces:
  - `"24hex..."` → `new ObjectId(...)`
  - `{ $gt: "24hex..." }` operator objects similarly
  - `{ $oid: "24hex..." }` similarly

**Non-goals**
- no logging
- no schema inference
- deterministic, tiny

---

## DbWriter<TDto extends DtoBase>
**File:** `backend/services/shared/src/dto/persistence/dbWriter/DbWriter.ts`

### Role
Facade used by handlers to perform writes/updates using an internal worker.
- default worker: `MongoDbWriterWorker`
- optional mock worker: `DbWriterMockWorker`
- optional explicit injection via `worker` parameter
- edge-mode selection is centralized here (via `resolveDbWriterMode`)

### Constructor
```ts
type DbWriterConstructorParams<TDto> = {
  bag: DtoBag<TDto>;
  mongoUri: string;
  mongoDb: string;
  log?: ILogger;
  userId?: string;

  worker?: IDbWriterWorker<TDto>; // if provided => bypass edge-mode logic

  dbState?: string;               // must be provided together with mockMode if either is used
  mockMode?: boolean;             // derived from DB_MOCKING (bool)
};
```
### Edge-mode config rules (hard)
- If `worker` is provided → use it; do not run edge-mode checks.
- If *either* `dbState` or `mockMode` is provided, **both are required**:
  - logs WARN
  - throws `DbWriterEdgeModeConfigError` with `httpStatus=409`
- If both are provided:
  - `resolveDbWriterMode({ dbState, mockMode })`
  - if decision not ok → throws `DbWriterEdgeModeConfigError` (409) with Ops guidance
  - else chooses worker:
    - `"mock"` → `DbWriterMockWorker`
    - `"real"` → `MongoDbWriterWorker`

### Worker interface
```ts
interface IDbWriterWorker<TDto> {
  targetInfo(): Promise<{ collectionName: string }>;
  write(): Promise<DtoBag<TDto>>;
  writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>>;
  update(): Promise<{ id: string }>;
}
```

### Public methods
```ts
targetInfo(): Promise<{ collectionName: string }>;
write(): Promise<DtoBag<TDto>>;
writeMany(bag?: DtoBag<TDto>): Promise<DtoBag<TDto>>;
update(): Promise<{ id: string }>;
```
Also re-exports `DuplicateKeyError`.

### Key invariants
- Writers accept and return DtoBag only.
- IDs are UUIDv4 strings and must be assigned before wire materialization.
- Edge-mode blocks unsafe configurations via a 409 “configuration conflict” style error.

---

## DbReader<TDto>
**File:** `backend/services/shared/src/dto/persistence/dbReader/DbReader.ts`

### Role
Facade used by handlers to perform reads via an internal worker.
- default worker: `MongoDbReaderWorker`
- supports future mock injection via `worker` param
- all reads return `DtoBag` (size 0..N), never raw docs

### DTO ctor requirement (reader-side)
```ts
type DtoCtorWithCollection<T> = {
  fromBody: (j: unknown, opts?: { validate?: boolean }) => T;
  dbCollectionName: () => string;
  name?: string;
};
```
### Options + read-batch
```ts
type DbReaderOptions<T> = {
  dtoCtor: DtoCtorWithCollection<T>;
  mongoUri: string;
  mongoDb: string;
  validateReads?: boolean; // default false
};

type ReadBatchArgs = {
  filter?: Record<string, unknown>;
  order?: OrderSpec;       // default ORDER_STABLE_ID_ASC
  limit: number;
  cursor?: string | null;
  rev?: boolean;
};

type ReadBatchResult<TDto> = {
  bag: DtoBag<TDto>;
  nextCursor?: string;
};
```

### Worker interface
```ts
interface IDbReaderWorker<TDto> {
  targetInfo(): Promise<{ collectionName: string }>;
  readOneBagById(opts: { id: string }): Promise<DtoBag<TDto>>;
  readOneBag(opts: { filter: Record<string, unknown> }): Promise<DtoBag<TDto>>;
  readManyBag(opts: { filter: Record<string, unknown>; limit?: number; order?: OrderSpec }): Promise<DtoBag<TDto>>;
  readBatch(args: ReadBatchArgs): Promise<ReadBatchResult<TDto>>;
}
```

### Public methods
```ts
targetInfo(): Promise<{ collectionName: string }>;
readOneBagById(opts: { id: string }): Promise<DtoBag<TDto>>;
readOneBag(opts: { filter: Record<string, unknown> }): Promise<DtoBag<TDto>>;
readManyBag(opts: { filter: Record<string, unknown>; limit?: number; order?: OrderSpec }): Promise<DtoBag<TDto>>;
readBatch(args: ReadBatchArgs): Promise<ReadBatchResult<TDto>>;
```
`readBatch()` normalizes default order to `ORDER_STABLE_ID_ASC` for compatibility.

### Invariants
- Wire primary key is `_id` (string) at the service boundary.
- Hydration should default to `validate=false` for DB reads unless explicitly opted in.
- No implicit env fallbacks: missing mongoUri/mongoDb should be treated as fatal at higher layers.

---

## Quick “ctx keys” cheat-sheet

### Common keys set by controllers/helpers
- `ctx["requestId"] : string`
- `ctx["headers"] : Record<string, unknown>`
- `ctx["params"] : Record<string, unknown>`
- `ctx["query"] : Record<string, unknown>`
- `ctx["body"] : unknown`
- `ctx["res"] : express.Response`
- `ctx["svcEnv"] : EnvServiceDto`
- `ctx["svc.env"] : string` (env label)
- `ctx["dtoType"] : string` (when using dtoType routes)
- `ctx["op"] : string` (operation name)
- `ctx["db.collectionName"] : string` (optional; when resolved)
- `ctx["hydrate.fromBody"] : (body) => DTO` (registry hydrator)

### Success materialization keys
- `ctx["bag"] : DtoBag<Dto>` **(required for success)**
- `ctx["response.meta"] : Record<string, unknown>` (optional)
- `ctx["warnings"] : any[]` (optional)
- `ctx["list.nextCursor"] : string` (optional)
- `ctx["list.limitUsed"] : number` (optional)
- `ctx["jwt.userAuth"] : string` (optional; surfaced to meta.tokens.userAuth)

### Error materialization keys (canonical)
- `ctx["handlerStatus"] = "error"`
- `ctx["response.status"] : number`
- `ctx["response.body"] : ProblemJson-like | {code,title,detail,...}`
- `ctx["error"] : any` (fallback)

---

## TODO slots for future expansions (keep this doc growing)
- HandlerBase interface + HandlerContext API + key conventions
- RegistryBase / IDtoRegistry surface (hydratorFor, dbCollectionNameByType, indexHints)
- PromptsClient interface + Missing-Prompt semantics
- RoutePolicyGate interfaces (resolver, required decisions)
- DbDeleter facade
- Env bootstrap helpers (svcenv client) + svcconfig resolver/cache surfaces
