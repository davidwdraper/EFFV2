adr0100-skeleton-first-ui-with-backend-driven-callbacks

ADR-0100 — Skeleton-First UI Rendering With Backend-Directed Callback Fetching

(Extends ADR‑0099)

Status

Accepted (temporary number pending insertion into the main sequence)

Context

ADR‑0099 introduced the Backend‑Driven Poll Callback Model using stable

dataSourceIds, version counters, and backend-specified callback URLs.

This ADR extends that design to cover initial UI page loads and

skeleton‑first rendering, ensuring:

Fast first-paint with skeleton widgets.
Uniform behavior for first load and subsequent updates.
No duplicated “initial data load” logic.
Backend retains total control of data shapes, DTOs, and flow.
Gateway remains a pure proxy.
This solves the problem where the frontend previously needed different logic for:

Page load → fetch data
Poll callback → update widgets
Under this ADR, they are the same thing.

⸻

Decision

1. UI Renders Immediately Using Skeletons

The frontend:

Requests YAML for a page (layout + widget → dataSourceId bindings).
Instantiates widgets in skeleton mode.
Sends a poll request indicating “all data is stale” using version=0 for all dataSourceIds. 2. Initial Data Fetch Uses the Same Mechanism as Updates

The poll endpoint returns a list of callback actions:

{

"changed": true,

"actions": [

{ "id": "dashboard.creditsGauge", "method": "GET", "url": "/api/ui/v1/dashboard/credits", "version": 1 },

{ "id": "messages.inbox", "method": "GET", "url": "/api/ui/v1/messages/inbox", "version": 1 }

]

}

3. Frontend Fires All Actions Asynchronously

Each callback response returns:

{

"dataSourceId": "dashboard.creditsGauge",

"payload": { ... }

}

The frontend updates all widgets bound to that dataSourceId, replacing skeletons with real content.

4. Polling Afterward Uses the Same Flow

When something changes (credits added, new DM message, geofence event fired),

the backend increments the version for the corresponding dataSourceId.

Next poll returns only the changed data sources.

No special case for “first load.”No special case for “update.”

One mechanism, forever.

⸻

Detailed Flow

Step 1 — UI Loads YAML

Backend returns:

widgets:

- type: CreditsGauge

widgetId: wg1

dataSourceId: dashboard.creditsGauge

- type: MessagesList

widgetId: wg2

dataSourceId: messages.inbox

Frontend renders both widgets as skeletons.

⸻Step 2 — UI Polls With Version=0

Frontend sends:

GET /api/ui/v1/poll?ds[dashboard.creditsGauge]=0&ds[messages.inbox]=0

Backend sees version=0 → treat as stale → return actions.

⸻Step 3 — Backend Returns Callback Actions

(Same as updates)

⸻Step 4 — UI Executes Callbacks

As each callback resolves, the widgets bound to that dataSourceId update and stop being skeletons.

Widgets load in whatever order data arrives.

This gives the desired “progressively filled” UX.

⸻

Consequences

PositiveIdentical rails for cold loads and incremental updates
Zero duplication between “initial load” and “poll update” logic
UI remains extremely simple: it only understands skeleton → hydrated transitions
Backend can add data sources without a client update
Gateway continues to proxy without business logic
NegativeFirst poll may generate many callback actions if a page has many widgets
Requires careful handling of parallel requests on the client (rate limiting recommended)
⸻

Implementation Notes

Update registry remains the source of truth (per-user / per-dataSourceId versioning).
YAML must always include dataSourceIds for widgets.
Poll must:
Compare client versions to registry versions
Treat version=0 as “client wants initial fill”
Callback endpoints must return the dataSourceId inside their response bodies.
⸻

Extends / References

Extends: ADR‑0099 (Backend‑Driven Polling Callback Model)
SOP: Backend DTO-first architecture
LDD-XX: UI orchestration, YAML-driven rendering
Future “ui-orchestrator” service implementation

David Draper
727.580.2908
Sent from my iPhone
