adr0067-backend-driven-poll-callbacks

ADR-0067 — Backend-Driven Polling Callbacks With UI DataSource IDs

Status

Accepted (temporary number — final ADR number to be assigned in main sequence)

Context

NV’s frontend will be heavily dynamic, with views and widgets rendered from

backend-produced YAML layouts. These layouts define what widgets exist and how

they bind to specific pieces of backend data.

A pure “dirty flag” polling system is insufficient because the backend must

indicate not just that something changed, but exactly which data the frontend needs to re-fetch and where those responses should be applied in

the UI.

Initial designs considered per-channel enumerations (credits, dmWindow,

geofence, …), but this is brittle, forces client-side knowledge of backend

semantics, and does not scale with the flexibility of the YAML-driven UI.

Decision

The backend will use a Backend-Driven Callback Model with the following

invariants:

Each update source is identified by a stable dataSourceId.
Example: "dashboard.creditsGauge", "messages.inbox",

"geofence.summary".
These IDs are not widget IDs; they are pure data sources.
YAML UI definitions map widgets to these dataSourceIds.
Example:
widgets:

- type: CreditsGauge

widgetId: credits1

dataSourceId: dashboard.creditsGauge

Backend change state is tracked per dataSourceId.
Internally: a version counter per user per dataSource.
Writes to relevant systems (credits, messages, GF, etc.) bump versions for

affected dataSourceIds.
The poll endpoint returns a list of backend-defined callback actions.
Each callback action contains:
dataSourceId
method
url
version
Example poll response:
{

"changed": true,

"token": 124,

"actions": [

{

"id": "dashboard.creditsGauge",

"method": "GET",

"url": "/api/ui/v1/dashboard/credits",

"version": 4

},

{

"id": "messages.inbox",

"method": "GET",

"url": "/api/ui/v1/messages/inbox",

"version": 6

}

]

}

Frontend routing of callback results is driven entirely by dataSourceId.
When a callback returns:
{

"dataSourceId": "dashboard.creditsGauge",

"payload": { ... }

}

The rendering engine looks up all widgets bound to that dataSourceId and

updates them accordingly.
The client does not need to understand backend semantics.
Backend can add or remove dataSourceIds at will.
No client changes are required when adding new dashboard components,

messaging windows, or future features.
Gateway remains a pure proxy.
ui-orchestrator service owns:
Update state registry
Poll endpoint
Per-source routes
Consequences

PositiveFull backend control of UI data flows
Zero semantic leakage to the frontend
Simple, declarative widget → data source bindings
Strong compatibility guarantee as the system evolves
No wasted DB reads on poll; only per-source reads on demand
NegativeThe update registry (per-user/per-dataSourceId) must be maintained in memory

or Redis
YAML definitions must remain consistent with dataSourceIds returned by poll
Implementation Notes

A DashboardUpdateRegistry (or generalized UpdateRegistry) is required.
Poll endpoint must compare client versions with server versions and produce

callback actions.
Callback responses must include dataSourceId for frontend routing.
YAML standard must be updated with a dataSourceId field for widgets.
Alternatives Considered

Hardcoded dashboard-channel enums

Rejected for brittleness and inability to scale with YAML-driven UI.
Frontend-defined routing logic

Rejected because NV intentionally centralizes UI logic on the backend.
Polling that returns full updated data

Acceptable for small slices but not scalable for all UI surfaces and not

sufficiently explicit for widget-based rendering.
References

NV SOP (Reduced, Clean)
LDD-00..LDD-34 — Polling, UI orchestration, DTO-first rendering
Upcoming “ui-orchestrator” service design

David Draper
727.580.2908
Sent from my iPhone
