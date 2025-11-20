# NowVibin Backend — Core SOP (Reduced, Clean) [Concise Version]

## Prime Directives

- Never overwrite unseen work — always start from the current file.
- Single-concern files; shared logic lives only in `backend/services/shared`.
- Full file drops only; no partials, no options.
- No barrels or shims.
- Env names only — not hard coded values or fallbacks
- Routes are one-liners; controllers orchestrate pipeline of handers.
- Instrumentation everywhere; global error middleware via `problem.ts`.
- Audit-ready: explicit env validation, no silent fallbacks. Dev ≈ Prod (URLs/ports aside).
- Canonical truth = DTO
- Always TypeScript OO; base classes shared where appropriate.

---

## Route & Service Rules

- URL: `http(s)://<host>:<port>/api/<slug>/v<major>/<dtoType>/<rest>`
  - Health is versioned: `/api/<slug>/v1/health`
- CRUD (versioned paths):
  - `PUT` create
  - `PATCH` update
  - `GET` read
  - `DELETE` idempotent delete
- No `PUT /:id` full replaces.
- Gateway strips `<slug>` and proxies via svcconfig replacement port value.
- Mount health before auth/middleware.

---

## Template Service Blueprint

Flow: \*\*route -> controller -> pipeline -> handlers -> DtoBag(DTO) -> service API

- Model: `bufferCommands=false`; indexes defined.
- Repo: comprises shared DbReader and DbWriter helpers that work with DTOs
- DTOs never leave a module boundary outside a DtoBag wrapper

---

## Safe Field Add SOP

1. update DTO → done.
2. Add 2 tests: DTO round-trip + minimal controller.

---

## Logging & Audit

- Shared logger; propagate `x-request-id`.
- WAL audit flushes once per request.
- SECURITY logs ≠ WAL logs. WAL not complete yet.
- Every meaningful operation should be logged at `info` level.
- Heavy instrumentation with `debug` logs for traceability.
- When the Logger service is complete, log levels will be runtime-adjustable and can optionally forward to the log DB for production triage.

---

## Security & S2S

- Only gateway is public; all others require valid S2S JWT (JWT not in place yet)
- `verifyS2S` runs after health, before body parsers/routes. (Not in place yet)
- Gateway never forwards client `Authorization`.
- All S2S calls via shared `SvcClient` (`callBySlug`).

---

## Deployment

- Dev/local: HTTP allowed on 127.0.0.1.
- Staging/prod: HTTPS only, `FORCE_HTTPS=true`, HTTP→308.

---

## Session Ritual

Paste SOP → declare active service → paste full current files → merge drops only.
Be pro-active. Warn if session is getting too bloated for your efficient processing

---

## File Discipline

- Repo Path/Filename on 1st line
- ADR refs.
- Inline “why,” not “how.”
- Always ensure wiring is complete.
- Never drift; ask if logic exists before adding.
- All returned files in a code block

---

## Process Notes

- Design discussion → file drop → test → next file.
- One file at a time unless requested.
- Reuse in shared; use DI where logical.
- Baby steps — correctness over speed.
- Never take a fast path over long-term correct path
- Never provide options, always take best long-term commerical path
- Project is new and greenfield with no clients. All internal interface to be explicit.
- Never leave code incomplete with "come back later" comments. All code 100% before moving on.

---

## Environment Invariance

- No literals or defaults tied to env.
- All config from env or svcconfig.
- Fail-fast if missing config.
- Dev == Prod behavior.
- No backward compatibility; greenfield only.
- “Could this line ship to prod unchanged?” If not, fix it.

---

## App.ts = Orchestration Only

- Defines **what** happens, not **how**.
- Wires base classes, middleware, and routes.
- No business logic — that lives in `services`, or `handlers`.
- Think of `app.ts` as a “runtime table of contents.”

---

## Single-Concern Classes

- One reason to change.
- No mixing validation/persistence/routing/mapping.
- Classes >200 lines or multi-purpose → split.
- Each class must be describable in one sentence.
- Shared base classes only for true cross-service concerns.

---

## Best-in-Class > Minimal Diffs

- Correctness > smallest edit.
- Fix plumbing, don’t bend it.
- Bugs fixed at edges, not middle layers.
- Delete cleverness; prefer boring, explicit code.

---

## DTO-First Development

- DTOs are canonical; domain data lives only in DTOs.
- DTO data is used via getters but never lives outside the DTO.
- Each DTO inherits from `DtoBase` and implements `IDto`.
- DTO validates and authorizes its own data (getters/setters).
- Multiple DTOs for same entity service only with clear justification (e.g., internal vs. public view).
- If a DTO leaves the service boundary, it must be defined under `services/shared/src/dto/<slug>.<purpose>.dto.ts`.

---

## Template Service Types

- `t_entity-crud`: DB-backed CRUD template (with live test DB).

The following are templates yet to be built

- `micro-orchestrator (MOS)`: cross-service coordination. Multiple DTO types expected.
- `api-adapter`: interfaces external APIs.
- `daemon`: cron/background task.  
  Each is fully runnable by cloning and assigning a port.

---

## Crud Template File Hierarchy

```
backend/services/t_entity_crud/
└─ src/
   ├─ index.ts              → bootstrap only
   ├─ app.ts                → orchestration only (extends AppBase)
   ├─ routes/
   │   ├─ <route>.route.ts
   ├─ controllers/
   │   ├─ <route>.controller/
   │   │     └─ pipelines
   │   │           ├─ <op>.pipeline1
   │   │           │    ├─handlers/
   │   │           │    │   ├─ <purpose>.handler1.ts
   │   │           │    │   └─ <purpose>.handler2.ts
   │   │           │    └─ index.ts
   │   │           ├─ <op>.pipeline2
```

Handlers with common functionality are located in:
backend/services/shared/src/http/handlers

**Rules:**

- Handlers = single-purpose (think: could be resused)
- Services = cross-handler logic. Shared if cross service.
- DTOs = data authority.
- Peristence within handlers via DbWriter, DbReader and DbDeleter
- Controllers = orchestrators only.
  If data lives outside a DTO - it's drift

---

## UserType Enum

```ts
export const enum UserType {
  Anon = 0,
  Viber = 1,    (no fee)
  Prem-Viber = 2,   (monthly fee)
  NotUsedYet = 3,
  AdminDomain = 4,
  AdminSystem = 5,
  AdminRoot = 6,
}
```

shared files can be accessed at:
@nv/shared/
rather then ../../../shared/src/
Files within shared, do not use @nv/shared/

When throwing errors, ensure the message includes guidance and suggestions for Ops
to triage the situation.

No models, no schemas, no mappers, no leaked shapes. The DTO is the only source of truth, and persistence just moves opaque JSON in/out via dto.toJson() / DtoClass.fromJson().

Always provide ADR docs as downloadable .md files. Ask for next # at start of session.

As we work our way through building out the backend, there may be time that refactoring is required. We never build shims, or fallbacks, or worry about back-combat. We're greenfield and in total control of all interfaces - everything needs to tight. If entity A needs a function in B that doesn't exist, we don't add it to A, we put it in B where it belongs.

No helper methods to narrow TS type guards. All typing must be designed and implemented correctly. There must be a good valid reason for the type 'any'.

When fixing issues or bugs, never offer two or more solutions when one is clearly the preferred. We are never doing quick fixes and always require the best long term production solution. dev == prod.

Be pro-active on when its time for a new session, when we're diverging from the ADRs, or when I'm suggesting something that screams "not best practice".

Living Design Doc (LDD) Compression:

# LDD Compression (Structural Overview of All LDD Files)

Each LDD is represented by its primary headings only.
This is the canonical “compressed form” for architectural grounding.

---

## LDD-00 — Shared CRUD Rails

- 1. Purpose
- 2. CRUD Guarantees
- 3. Routing Rails
- 4. Pipeline & Controller Contracts
- 5. DTO Rules
- 6. Bag Semantics
- 7. Duplicate-Key and Problem+JSON

## LDD-01 — DTO-First Principles

- Purpose
- High-Level Flow
- Rules
- Contract Structure

## LDD-02 — Handler & Pipeline Architecture

- Purpose
- HandlerContext Rules
- Pipeline Assembly
- Error/Success Flow

## LDD-03 — Repo Architecture

- Purpose
- Writer Rules
- Reader Rules
- Query & List Determinism

## LDD-04 — Health System

- Purpose
- Health Route Behavior
- Boot Interaction

## LDD-05 — Mongo Persistence Model

- Collections
- Index Rules
- Deterministic Naming

## LDD-06 — SvcEnvClient & Env Loading

- Purpose
- Boot Sequence
- Required Variables
- Failure Modes

## LDD-07 — Routing Model

- Path Structure
- Versioning Rules
- DTO Type Segment

## LDD-08 — Request Lifecycle

- Meta
- Audit
- Validation
- Error Strategy

## LDD-09 — Validation Architecture

- Zod Contracts
- Patch Rules
- Reject Conditions

## LDD-10 — Create Flow

- Request Shape
- Bag Semantics
- Duplicate Behavior

## LDD-11 — Read Flow

- By-ID
- Error Cases
- Deterministic Output

## LDD-12 — Patch Flow

- Merge Rules
- Conflict Behavior
- DTO Mutation Validations

## LDD-13 — Delete Flow

- Idempotency
- Response Norms

## LDD-14 — List Flow

- Cursor Rules
- Sort Rules
- Last-Page Behavior

## LDD-15 — Query Flow

- Filter Rules
- Optional Operator Set

## LDD-16 — Service Boot Architecture

- Boot Order
- Environment Requirements
- Index Bootstrap

## LDD-17 — Error Architecture & Problem+JSON

- Purpose
- Error Classes
- DTO/Validation Errors
- Persistence Errors
- Error Flow
- Problem+JSON Mapping
- finalize() Rules
- HandlerContext Error Semantics

## LDD-18 — Duplicate-Key Behavior

- UUID Provided
- UUID Missing
- Duplicate-by-Content Definition

## LDD-19 — Cursor Architecture

- Cursor Encoding
- Deterministic Sorting
- Last-Page Guarantees

## LDD-20 — Audit & WAL Integration

- WAL Overview
- Audit Service Expectations
- Mutation Logging Rules

## LDD-21 — DTO Round-Trip Model

- toJson()
- fromJson()
- Contract Binding

## LDD-22 — Type/DTO Registry

- Registry Structure
- Lookup Rules
- Error Modes

## LDD-23 — Handler & Pipeline (Extended)

- Validate → DTO → Repo → Response
- Pipeline Safety Rails

## LDD-24 — Repo Rules (Extended)

- Reader/Writer Safety
- Deterministic Behavior

## LDD-25 — CRUD Summary

- Combined CRUD Lifecycle
- Required Guarantees

## LDD-26 — Index Rails

- Index Hints
- Runtime Enforcement
- Boot Validation

## LDD-27 — Bag Semantics & Multi-Write Behavior

- Bag Structure
- Multi-Create Semantics
- Ordering Guarantees

## LDD-28 — Auth Service Architecture

- Token Minting
- Token Verification
- Password Rules
- Credential Store
- S2S Rules
- Threat Model

## LDD-29 — Collection Naming Architecture

- Env-Service Driven
- DTO-to-Collection Mapping

## LDD-30 — SvcConfig Architecture

- Purpose
- Routing
- Env Versioning

## LDD-31 — Route Policy Gates

- Request Filtering
- ADR-31/32/29 Integration

## LDD-32 — DtoBag & Multi-DTO Behavior

- Bag Lifecycle
- DTO Merging Rules

## LDD-33 — Logging Architecture

- Request-Level Logging
- Pipeline Logging
- Error Logging
- Boot Logging

## LDD-34 — Shared S2S Gate & Authorization Flow

- S2S Token Rules
- Required Headers
- verifyS2S Placement
- Worker Behavior
- Error Modes

App Ideas and Features Compression:

# ideas-and-features.md (Compression)

This doc represents the evolving user-facing + UX + engagement feature set.

---

## Abbreviations

- GF (geofence)
- TBT
- WPA
- - (MVP)
- # (future)

---

## APP DISPLAY

### Display Constraints

- Portrait only (MVP)
- Three regions: Dashboard, Content, Footer
- Desktop = centered mobile portrait

---

## DASHBOARD

### Dashboard Variants

1. Anonymous user
2. Signed-in w/ GF on
3. Signed-in w/ GF off

### Dashboard Elements (MVP + Future)

- Global active users
- County active users
- Live events near user
- Credit balance (tachometer)
- Remaining credits for fee offset
- Venue count (if inside venue)
- Mail icon w/ unread
- GF trip counter
- # Newsfeed marquee
- Reliability score
- # Dashboard skins & animation

### Hamburger Menu

- Add Event
- Invite
- Acts
- Places
- Users
- Settings
- About
- Contact
- FAQs

---

## USERS

### 1. Anonymous Users (MVP)

- No login required
- Ads shown
- Limited filters
- No GF
- No credits
- Menu disabled

### 2. Viber (signed-in)

- No fee
- Ads in footer only
- Earn credits
- Join groups (but not create)
- GF enabled

### 3. Prem Viber

- Full functionality
- No ads
- Credits can offset fees
- Can become lifetime free
- Reliability index initialized to zero
- Invite system w/ credit rewards

---

## PLACES (Venues)

- Must exist before Events
- Employees can be linked
- # Web portal in future

---

## GEOFENCING (GF)

### Core

- Foundational feature
- Requires device location
- Many UI behaviors gated on GF
- GF trips are persisted (eventId, timestamp, optional userId)

### Aggregation

- Monthly + lifetime trip counts

### UX

- # Splash screens per trip
- # Time-in-venue tracking
- # Travel notifications
- # Badges, credits
- # Group attendance notifications
- # Act → attendee messaging
- # Attendee → act messages
- # Merch credits

---

## CREDITS

### Earning Credits

- Engagement time
- UI clicks
- Invites accepted
- Act added → event created
- GF trips
- Group GF bonus
- Verifications
- Doubts
- Photo adds & votes

### Credit Lifecycle

- Each credit logged as a record
- Batched send
- 60-day lifespan (rounded up)
- Can offset subscription fees
- Can gift to Acts

### Credit Economics

- Dollar value floats with revenue
- Users cannot redeem for cash

---

## CROWD SOURCING (Data Reliability)

### Seedable Entities

- Acts
- Places
- Events

### Reliability System

- Data starts as “not verified”
- Buttons: Verify / Doubt
- Scores: +1 / -1 / thresholds
- Auto-hide with low score
- Act members can auto-verify
- Reliability rewards/punishments
- Profanity & tone filtering

---

## DATA VIEWING

### Purpose

- Show events that matter to user

### Display Modes

- List
- Map

### Radius Rules

- Default 5 miles
- Prem Vibers can change radius
- Act/Place selector overrides radius

### Filters

- Event type
- Subtype
- Act
- Place

### Event Cards

- RSVP system with reliability influence

---

## MESSAGING

### Channels

1. Push notifications
2. DM (user ↔ user, groups WPA)
3. Footer messages
4. Dashboard marquee

### Message List View

- 30-day retention
- Bold unread
- Popup detail

---

## CREDIT GIFTING

- Used to:

  1. Pay subscription
  2. Gift Acts

- Lifetime rules for credits
- Monthly payout to Acts (TBT provider)

---

## MILESTONES

- Achievements displayed
- Act ranking (top 5 gifting)
- Dashboard marquee announcements

---

## STARTUP PLAN

- Region scraping (Burbank first)
- Parallel scraping + MVP dev
- Venue sponsorship pre-launch
- Prem Lite for early adopters
- Early users can earn lifetime Prem
- Act onboarding after scraping phase

** IMPORTANT **

## Proactively tell me when it's time to start a new session.

## Proactively suggest alternatives and better ways to solve problems if you disagree with my approach.
