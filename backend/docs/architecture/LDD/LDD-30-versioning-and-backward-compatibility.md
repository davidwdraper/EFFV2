# LDD‑30 — Versioning & Backward Compatibility  
*(Service Versions, DTO Evolution, Rolling Upgrades, and Zero‑Downtime Rules)*

---

## 1. Purpose

NV ships dozens of microservices, all evolving at different speeds.  
This LDD defines how **versions** work across:

- service APIs  
- DTO contracts  
- database schemas  
- gateway routing  
- pipeline logic  
- client compatibility  

The goals:

- deploy new versions without downtime,  
- avoid breaking mobile/web clients,  
- roll out changes gradually,  
- and keep the entire mesh coherent.

---

## 2. Versioning Surfaces

There are **five** surfaces where versioning matters:

1. **Service Version (v1, v2, …)**  
2. **DTO Contract Version**  
3. **DB Schema / Index Hints**  
4. **Gateway Route Shape**  
5. **Clients & SDKs**  

Every change must be assigned to the correct layer.

---

## 3. Service Versioning  
*(API Major Versions — `/api/<slug>/v<major>/…`)*

### 3.1 When to Bump Service Version
Bump from v1 → v2 only if:

- breaking DTO changes,  
- breaking route patterns,  
- removing fields,  
- changing semantic meaning of fields,  
- removing/renaming endpoints.

**Adding** new fields, routes, or safe optional behavior → still v1.

### 3.2 Version Contract
`v1` and `v2` run **side‑by‑side** until v1 can be retired.

### 3.3 Migration Strategy
1. Implement v2 inside service.  
2. Register v2 in svcconfig (`slug@2`).  
3. Gateway exposes both.  
4. Clients begin upgrading.  
5. Drop v1 only when no active clients depend on it.

---

## 4. DTO Versioning  
*(Contract‑First Validation)*

DTOs evolve more frequently than the service version.

### 4.1 Allowed Changes Without Bumping Service Version
- Add fields (optional or with safe defaults).  
- Add indexHints.  
- Add DTO types to a service.  
- Add Zod refinements that do not break existing payloads.  

### 4.2 Changes Requiring Service Version Bump
- Remove fields.  
- Rename fields.  
- Tighten validation to reject previously valid data.  
- Change ID strategy.  
- Change business-unique constraints.

DTO versioning is enforced at the *contract layer*, backed by smoke tests.

---

## 5. DB Schema & Index Versioning

### 5.1 Safe Changes
- adding new indexes  
- widening types (string → union)  
- adding optional fields in documents  

### 5.2 Unsafe Changes (Require v2)
- removing indexes  
- renaming indexes  
- changing `_id` semantics  
- changing business-unique index keys  
- restructuring document trees  

Indexes are ensured on boot via registry-based `ensureIndexesForDtos`.

---

## 6. Backward Compatibility Rules

### 6.1 Adding Fields
Always safe **if**:
- default is provided OR  
- field is optional with `z.optional()`  
- DTO → JSON → DTO round‑trip remains stable

### 6.2 Removing Fields
Never safe. Requires:
- service v2,
- new DTO version,
- migration plan for DB documents.

### 6.3 Tightening Validation
Only safe if existing DB + client payloads are unaffected.  
Otherwise → v2.

### 6.4 Renaming Fields
Never safe — forces v2.

### 6.5 Behavior Changes
If semantic meaning of an operation changes:  
→ treat as breaking → v2.

---

## 7. Rolling Upgrades (Zero‑Downtime)

### 7.1 Multi‑Version Strategy
Steps:

```
Deploy v2 → register in svcconfig → gateway exposes both → migrate clients → retire v1.
```

### 7.2 Gateway Behavior
Gateway proxies according to route version (`v1`, `v2`).  
It does not coerce or translate requests; each service version lives independently.

### 7.3 Smoke Requirement
You must maintain:
- full v1 smoke suite  
- full v2 smoke suite  
until retirement.

---

## 8. Pipeline & Handler Compatibility

### 8.1 Adding Handlers
Safe if inserted before DB write or after bag creation.  
Test to ensure no behavioral regression.

### 8.2 Removing or Reordering Handlers
Potentially unsafe; treat as breaking unless guaranteed idempotent.

### 8.3 Handler Behavior Changes
If logic changes meaningfully → v2.

---

## 9. Gateway & SvcConfig Interactions

### 9.1 svcconfig Responsibilities
For every version:

```
(env, slug, version)
→ host/port/protocol
```

Removing a version from svcconfig immediately breaks clients.  
Must be coordinated via rollout.

### 9.2 Gateway Route Resolution
Gateway uses both v1 and v2 entries from svcconfig.  
It rejects requests to non-existent versions.

---

## 10. Client Compatibility

### 10.1 Mobile/Web Clients
Clients must:

- specify version in their API calls,  
- gracefully handle Problem+JSON,  
- adopt new DTO fields only when present.

### 10.2 Deprecation Strategy
- Warn via logs when v1 is near sunset.  
- Provide explicit dates in docs.  
- Use feature flags (optional).

---

## 11. Versioning Anti‑Patterns

- ❌ “Silent breaking changes”  
- ❌ removing fields from DTOs  
- ❌ route rewrites without version bump  
- ❌ shifting business rules without signaling  
- ❌ reusing v1 with incompatible DB schema changes  
- ❌ modifying indexHints in a breaking way  

---

## 12. Versioning Checklist

Before cutting a new service version:

- [ ] Any fields removed?  
- [ ] Any validation tightened?  
- [ ] Any route semantics changed?  
- [ ] Any index changed?  
- [ ] Any business logic meaning changed?  
- [ ] Gateway routes updated?  
- [ ] svcconfig record added?  
- [ ] smoke tests duplicated for v2?  

If yes → **v2 required**.

---

## 13. Future Enhancements

### v2
- schema diff tool  
- automatic smoke generation  
- incremental migration warnings  

### v3
- DTO migration framework  
- DB auto‑migration hooks  
- live traffic analytics for version usage  

### v4
- compatibility layer for smart client negotiation  
- cross‑service version matrix dashboards  

---

End of LDD‑30.
