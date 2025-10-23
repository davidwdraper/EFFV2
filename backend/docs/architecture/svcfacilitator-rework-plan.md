You’re right—the “stupid simple” path should’ve been the starting point. Let’s fix that now and lock it in so we don’t slide back.

The stupid-simple target (freeze this)

Entity: ServiceConfig (owns its RoutePolicies)

Container: Mirror = Map<slug@version, ServiceConfig>

One normalization hop: DB → ServiceConfig.fromDb(doc, {edge, s2s}) (throws loudly if bad)

Controllers: only serialize toJSON() (no transforms)

Zod: only at boundaries (ingress/egress) for wire/LKG, not inside domain

One-hour cutover plan (no whack-a-mole)

Create the domain (brand-new files)

shared/domain/ServiceConfig.ts — class + fromDb(), toJSON(), owns policies.

shared/domain/Mirror.ts — map wrapper with get, replaceAll, size, toObject.

Lock the wire contract (single schema)

shared/contracts/serviceConfig.wire.ts

ServiceConfigJSON (the serialization of the entity)

MirrorJSON = z.record(ServiceConfigJSON)

Use z.infer for TS types. That’s your only Zod.

Repo returns entities, not shapes

svcfacilitator/.../SvcConfigWithPoliciesRepo.v2.ts

Build ServiceConfig via ServiceConfig.fromDb(doc, policies).

Return ServiceConfig[] (nothing else).

Mirror store = Mirror aggregate

Replace any {config, policies} tuple logic with a single Mirror.

TTL/LKG remain, but they store/load the MirrorJSON produced by mirror.toObject(). No other transforms.

Controllers do zero logic

/mirror → res.json({ mirror: mirror.toObject() })

/resolve?key → res.json({ result: cfg.toJSON() }) (404 if missing)

Optional: Validate with MirrorJSON.safeParse(...) before send while stabilizing, then remove later.

Gateway validates once and stores

On fetch: const mirror = MirrorJSON.parse(payload.mirror)

Replace local cache from that object or rebuild a Mirror instance (your call). No remapping.

Warm on boot

preStart: await store.getWithTtl() so first /mirror doesn’t 503.

Logging that screams

In ServiceConfig.fromDb: throw with \_id, slug, offending field.

In repo: wrap loads so errors show collection, \_id, and which invariant failed.

In controller: log mirror.size / counts only—no payload dumps.

Tests / smokes that pop failures instantly

Unit: ServiceConfig.fromDb throws on: missing slug, non-int version, enabled!==true.

Unit: Mirror replaceAll + toObject round-trip.

Smoke: /mirror returns >0; /resolve?key=audit@1 returns JSON with slug/baseUrl.

Corrupt LKG file → expect gateway to reject with Zod error listing path(s).

Kill all “helpers” that reshape data

No more mappers in routers, app, or client. If it changes shape, delete it.

What I need from you (SOP-compliant)

Paste current versions (full files, path on first line):

backend/services/svcfacilitator/src/repos/SvcConfigWithPoliciesRepo.v2.ts

backend/services/svcfacilitator/src/services/mirrorStore.v2.ts (we’ll simplify to Mirror)

backend/services/svcfacilitator/src/controllers/MirrorController.v2.ts

backend/services/svcfacilitator/src/controllers/ResolveController.v2.ts

backend/services/gateway/src/services/svcconfig/\* (receiver/cache that consumes the mirror)

I’ll return whole-file drops for the brand-new domain + wire schema (since they don’t exist yet), then surgical drops for those five files to align to the boring model. After that, shape bugs either die in fromDb() with a perfect error… or they never happen. Old-school OO, modern guardrails.
