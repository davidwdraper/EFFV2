Thought for a few seconds

Here’s the straight, portable record you asked for—what’s live now, and the plan to kill all “A.x = B.y” shape shuffles going forward.

Session Notes — svcfacilitator (runtime green, design next)
Where we are (today, 100% reproducible)

Entrypoint: src/index.ts → bootstrap.v2.ts (default export) → SvcFacilitatorApp v2 constructed in bootstrap and exposed via expressApp().

Routing: All v1 endpoints are mounted; health and svcconfig/count return JSON; /resolve returns canonical JSON.

Mirror: In-memory snapshot entries are flattened ({ ...serviceConfigFields, policies }), not { serviceConfig, policies }.

Controller: ResolveController.v2 normalizes either flattened or canonical to canonical before returning.

Shim (temporary, explicit): If updatedBy is missing, controller sets updatedBy: "**shim**". This is a diagnostic unblocker, tagged for removal.

Result:

GET /api/svcfacilitator/v1/resolve?key=audit@1 -> 200 JSON (canonical)

JSON only, no HTML fall-through anywhere under V1 base.

Your standard (locking this as the invariant)

Data contracts are 1st-class DTO objects that inherit from DtoBase.

DTOs carry their own validation and (de)serialization.

Once hydrated from DB → DTO, the object never changes shape.

Anything not allowed across a boundary is nulled by the DTO’s toJson().

Zod only validates incoming edge JSON (request bodies). Outbound trust is enforced by DTO class invariants.

What we’re about to do (removing “A.x = B.y” forever)

We’re migrating from ad-hoc shape normalization to OO DTOs. The goal: no more field promotion/renaming in controllers/loaders; no cross-layer mapping. One object, one shape.

Step 0 — Keep runtime green

Leave the controller shim in place until the DTO is in and the loader populates DTOs.

This keeps /resolve and smoke tests green during the swap.

Step 1 — Introduce DTO backbone (shared, contract-first)

Create a minimal DtoBase and one concrete DTO to prove the pattern.

// services/shared/dto/DtoBase.ts
export abstract class DtoBase<TJson extends object> {
/\*_ Serialize for wire/cache; must be pure JSON (no Dates, no ObjectId). _/
abstract toJson(): TJson;

/\*_ Construct from JSON (edge or cache) into a DTO instance. _/
static fromJson<TDto>(this: new (...args: any[]) => TDto, json: any): TDto {
return new this(json);
}

/\*_ Optional: internal validation hook (throws on invariant break). _/
protected validate?(): void;
}

// services/shared/dto/ServiceConfig.dto.ts
import { DtoBase } from "./DtoBase";

export type ServiceConfigJson = {
\_id: string;
slug: string;
version: number;
enabled: boolean;
internalOnly: boolean;
baseUrl: string;
outboundApiPrefix: string;
exposeHealth: boolean;
updatedAt: string; // ISO
updatedBy: string; // REQUIRED
// ...any optional fields
};

export class ServiceConfig extends DtoBase<ServiceConfigJson> {
constructor(private readonly props: ServiceConfigJson) {
super();
// Minimal internal validation (throw on bad invariant)
if (!this.props.updatedBy) throw new Error("updatedBy required");
if (!this.props.slug) throw new Error("slug required");
// … add only invariants we truly own internally
}

toJson(): ServiceConfigJson {
// Null or omit anything not allowed to leave the edge (policy)
// Example: none right now; but if something is internal, set it null here.
return { ...this.props };
}

static override fromJson(json: ServiceConfigJson): ServiceConfig {
// Coerce inbound weirdness here (e.g., Date → ISO), NOT in controllers
return new ServiceConfig({
...json,
updatedAt: new Date(json.updatedAt).toISOString(),
updatedBy: String(json.updatedBy ?? ""),
});
}

// Selectors (used throughout instead of raw props)
id() { return this.props.\_id; }
slug() { return this.props.slug; }
version() { return this.props.version; }
enabled() { return this.props.enabled; }
}

Step 2 — Repos hydrate DTOs, not raw objects

ServiceConfigsRepo.findVisibleParents() returns ServiceConfig instances (not plain records).

Promote any source fields there (e.g., changedByUserId → updatedBy) once, right at hydration, then pass the DTO along.

No other layer renames fields again.

Net effect: the only place that knows DB quirks is the repo.

Step 3 — Mirror stores DTO JSON, not raw DB shapes

In MirrorDbLoader.v2.loadFullMirror():

Take each ServiceConfig DTO and call toJson() once.

Build the snapshot entry with that JSON and the policies (policies later get their own DTO if needed).

Store either the canonical wrapped form or keep flattened (controller already supports both). Pick one and freeze it; I recommend canonical { serviceConfig, policies }.

Step 4 — Controller consumes DTO JSON or rehydrates as needed

Controller does not rename fields. It either:

Uses the JSON directly, or

Rehydrates DTO via ServiceConfig.fromJson(json) for logic, then toJson() on return.

Remove the updatedBy="**shim**" block once repos populate it.

Step 5 — Zod only at the edge

Keep Zod for request validation (incoming payloads).

Remove incidental Zod parses of outbound data; rely on DTO invariants and tests.

Concrete cleanup list (things to delete/change)

ResolveController.v2.ts

Delete: alias list + DIAGNOSTIC SHIM (updatedBy="**shim**").

Keep: canonical response envelope. Use DTO if needed for svcKey(slug, version) checks.

MirrorDbLoader.v2.ts

Delete: any promotion like parent.updatedBy = parent.changedByUserId.

Replace with: const scDto = ServiceConfig.fromJson(parentJson); then serviceConfig: scDto.toJson().

Pick one snapshot shape and stick to it (recommend canonical).

ServiceConfigsRepo.ts

Add: DTO hydration & single-source normalization of DB fields:

\_id to string

updatedAt to ISO

changedByUserId → updatedBy

Return: ServiceConfig instances.

RoutePolicies (later)

Introduce RoutePolicy DTOs when/if you need behavior; until then, plain JSON is fine.

Contracts folder

Migrate current “record classes” to DTOs under services/shared/dto/\*.

Keep names stable (ServiceConfig) and provide a ServiceConfigJson type.

How we’ll find and kill “A.x = B.y” shuffles

Search queries to run in the repo (macOS/Linux):

# obvious field promotion/brittle mapping

rg -n --no-ignore --hidden '\.\w+\s*=\s*[^;]\*\.\w+' backend | rg -v 'const|let|var'

# updatedBy shims/aliases

rg -n --no-ignore --hidden 'updatedBy|changedByUserId|lastModifiedBy|updated_by|actorId' backend

# controller/loader hotspots

rg -n --no-ignore --hidden 'normalize\(|toJSON\(|toJson\(|fromJson\(' backend

We’ll replace those with:

Repo hydration → DTO constructor arg shaping once.

Everywhere else: dto.toJson() or, if behavior needed, dto.method().

Acceptance criteria (merge gate)

✅ /resolve 200 with canonical body, no controller aliases, no shim.

✅ Repo unit test: changedByUserId becomes updatedBy in DTO only.

✅ Loader unit test: mirror holds DTO JSON; no DB-only fields present.

✅ Grep shows zero assignments that rename cross-layer fields in controllers or loaders.

✅ Docs: “DTO Standard” added to SOP (what you wrote above, verbatim).

Tiny, final notes (practicalities)

DTOs are not god-classes. Keep them <200 LOC, behavior tightly scoped to serialization/validation/selectors.

Nulling fields: do it in toJson() only; never mutate the DTO instance.

Environment invariance is untouched—DTOs don’t read env.

Audit: continue logging at edges; include x-request-id as before.

If you want, I can drop the exact diffs for:

ServiceConfig.dto.ts

ServiceConfigsRepo.ts (hydrating DTOs)

DTO design is completely micro-service agnostic. Service components: index, app, routes, controllers, instantiate and use DTO baseclass interfaces, and never respond directly with DTO domain specific data properties. Were possible, different domain specific DTOs in a CRUD entity service should be replaceable within a service framework with almost no change.

MirrorDbLoader.v2.ts (using toJson() + canonical snapshot)

and the controller with the shim removed. Your call.
